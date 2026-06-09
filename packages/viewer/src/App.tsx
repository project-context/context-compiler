import { useEffect, useMemo, useRef, useState } from 'react'
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import {
  ArrowLeft,
  Braces,
  ChevronRight,
  Compass,
  FileSearch,
  Filter,
  GitBranch,
  Layers3,
  Network,
  PanelRight,
  RefreshCw,
  Search,
  Waypoints
} from 'lucide-react'

type ViewerElementKind = 'node' | 'edge'

interface SourceRef {
  sourceId: string
  uri: string
  location?: {
    path?: string
    lineStart?: number
    lineEnd?: number
  }
}

interface ViewerElement {
  id: string
  kind: ViewerElementKind
  type: string
  label: string
  scopeId?: string
  status?: string
  source?: string
  target?: string
  metrics: Record<string, number>
  childScopes?: GraphScope[]
  styleHints: {
    color: string
    shape: string
    size: number
    lineStyle?: string
  }
  rawRef: {
    factKind: 'node' | 'edge' | 'scope' | 'directory'
    factId: string
    scopeId?: string
  }
  data?: Record<string, unknown>
}

interface ViewerOverview {
  schemaVersion: string
  scopeId?: string
  elements: {
    nodes: ViewerElement[]
    edges: ViewerElement[]
  }
  stats: Record<string, number>
  omitted: Record<string, number>
  diagnostics: Diagnostic[]
}

interface Diagnostic {
  severity?: string
  code?: string
  message: string
}

interface ContextNode {
  id: string
  type: string
  name?: string
  scopeId?: string
  status?: string
  sourceRefs?: SourceRef[]
  properties?: Record<string, unknown>
}

interface ContextEdge {
  id: string
  type: string
  from: string
  to: string
  scopeId?: string
  status?: string
  evidence?: Array<Record<string, unknown>>
  linker?: string
  properties?: Record<string, unknown>
}

interface GraphScope {
  id: string
  kind: string
  title?: string
  summary?: string
  parentScopeId?: string
  rootNodeId?: string
  sourceGroupId?: string
  path?: string
  boundaryMode?: string
  adapterRefs?: Array<Record<string, unknown>>
  stats?: {
    nodes: number
    edges: number
    diagnostics: number
    files: number
    groups: number
  }
  freshness?: {
    status?: string
    checkedAt?: string
  }
}

interface GraphScopeView {
  schemaVersion: string
  scope: GraphScope
  rootNode?: ContextNode
  nodes: ContextNode[]
  edges: ContextEdge[]
  childScopes: GraphScope[]
  relatedScopes: GraphScope[]
  entrypoints: ContextNode[]
  nextActions: NextAction[]
  omitted: Record<string, number>
  diagnostics: Diagnostic[]
}

interface NextAction {
  type: 'open_scope' | 'expand_target' | 'trace_source' | 'search_scope'
  targetId: string
  label: string
  reason: string
  scopeId?: string
}

interface GraphExpansion {
  target: {
    id: string
    kind: string
    node?: ContextNode
    edge?: ContextEdge
    scope?: GraphScope
  }
  scopePath: GraphScope[]
  facts: ContextNode[]
  edges: ContextEdge[]
  sourceTrace?: LayeredSourceTrace
  nextActions: NextAction[]
  omitted: Record<string, number>
  diagnostics: Diagnostic[]
}

interface LayeredSourceTrace {
  factId: string
  fact?: ContextNode
  edge?: ContextEdge
  sourceGroups: ContextNode[]
  scopes: GraphScope[]
  files: ContextNode[]
  contentNodes: ContextNode[]
  sourceRefs: SourceRef[]
  evidence: Array<Record<string, unknown>>
  omitted: Record<string, number>
  diagnostics: Diagnostic[]
}

interface GraphExplanation {
  factId: string
  factKind: string
  node?: ContextNode
  edge?: ContextEdge
  relatedEdges: ContextEdge[]
  relatedNodes: ContextNode[]
  provenance: Array<Record<string, unknown>>
  patches: Array<Record<string, unknown>>
  evidenceReports: Array<Record<string, unknown>>
  sourceRefs: SourceRef[]
  omitted: Record<string, number>
  diagnostics: Diagnostic[]
}

interface InspectResult {
  targetId: string
  targetKind: string
  target?: ViewerElement
  expansion?: GraphExpansion
  trace?: LayeredSourceTrace
  explanation?: GraphExplanation
  diagnostics: Diagnostic[]
}

interface SearchResult {
  engine: string
  indexPath?: string
  results: ViewerElement[]
  diagnostics: Diagnostic[]
}

interface GraphModel {
  title: string
  scopeId?: string
  nodes: ViewerElement[]
  edges: ViewerElement[]
  childScopes: GraphScope[]
  relatedScopes: GraphScope[]
  nextActions: NextAction[]
  omitted: Record<string, number>
  diagnostics: Diagnostic[]
}

const NODE_FILTERS = [
  'ProjectGraph',
  'PackageGraph',
  'SourceGroupGraph',
  'DirectoryGraph',
  'FileGraph',
  'FileGraphLayer',
  'ContentGraph',
  'ContentGraphLayer',
  'FactGraphLayer',
  'RuntimeGraphLayer',
  'Requirement',
  'Document',
  'CodeSymbol',
  'APIEndpoint',
  'File'
]
const EDGE_FILTERS = ['contains_package', 'contains_source_group', 'has_child_scope', 'contains_directory', 'materializes_runtime', 'contains', 'contains_group', 'derived_from', 'calls', 'imports', 'references']
const DIRECTORY_BUCKET_THRESHOLD = 80

export function App(): JSX.Element {
  const [graph, setGraph] = useState<GraphModel | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [inspection, setInspection] = useState<InspectResult | undefined>()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<SearchResult | undefined>()
  const [highlightedIds, setHighlightedIds] = useState<string[]>([])
  const [nodeFilters, setNodeFilters] = useState(() => new Set(NODE_FILTERS))
  const [edgeFilters, setEdgeFilters] = useState(() => new Set(EDGE_FILTERS))
  const [breadcrumb, setBreadcrumb] = useState<Array<{ id: string; title: string }>>([{ id: 'overview', title: 'Project' }])

  useEffect(() => {
    void loadOverview()
  }, [])

  const visibleGraph = useMemo(() => {
    if (!graph) return undefined
    const nodes = graph.nodes.filter((node) => nodeFilters.has(node.type) || !NODE_FILTERS.includes(node.type))
    const nodeIds = new Set(nodes.map((node) => node.id))
    const edges = graph.edges.filter((edge) => (edgeFilters.has(edge.type) || !EDGE_FILTERS.includes(edge.type)) && edge.source && edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target))
    return { ...graph, nodes, edges }
  }, [edgeFilters, graph, nodeFilters])
  const availableNodeTypes = useMemo(() => orderedTypes(graph?.nodes.map((node) => node.type) ?? [], NODE_FILTERS), [graph])
  const availableEdgeTypes = useMemo(() => orderedTypes(graph?.edges.map((edge) => edge.type) ?? [], EDGE_FILTERS), [graph])

  async function loadOverview(): Promise<void> {
    setLoading(true)
    setError(undefined)
    try {
      const overview = await fetchJson<ViewerOverview>('/api/graph/overview')
      setGraph({
        title: 'Project Overview',
        scopeId: overview.scopeId,
        nodes: overview.elements.nodes,
        edges: overview.elements.edges,
        childScopes: [],
        relatedScopes: [],
        nextActions: [],
        omitted: overview.omitted,
        diagnostics: overview.diagnostics
      })
      setBreadcrumb([{ id: 'overview', title: 'Project' }])
      setSelectedId(undefined)
      setInspection(undefined)
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }

  async function openScope(scopeId: string, label?: string): Promise<void> {
    setLoading(true)
    setError(undefined)
    try {
      const view = await fetchJson<GraphScopeView>(`/api/scopes/${encodeURIComponent(scopeId)}?limitChildScopes=140&limitNodes=80&limitEdges=140`)
      setGraph(scopeViewToModel(view))
      setBreadcrumb((items) => {
        const existing = items.findIndex((item) => item.id === scopeId)
        if (existing !== -1) return items.slice(0, existing + 1)
        return [...items, { id: scopeId, title: view.scope.title ?? label ?? scopeId }]
      })
      setSelectedId(view.rootNode?.id)
      setInspection(undefined)
    } catch (scopeError) {
      setError(errorMessage(scopeError))
    } finally {
      setLoading(false)
    }
  }

  function openDirectory(directoryId: string): void {
    if (!graph) return
    const directory = graph.nodes.find((node) => node.id === directoryId)
    const childScopes = directory?.childScopes ?? graphScopesFromUnknown(directory?.data?.childScopes)
    if (!directory || childScopes.length === 0) {
      setSelectedId(directoryId)
      return
    }
    const childScopeNodes = childScopes.map(scopeToViewerElement)
    setGraph({
      ...graph,
      title: `${graph.title} / ${String(directory.data?.directory ?? directory.label)}`,
      nodes: uniqueById([directory, ...childScopeNodes]),
      edges: childScopeNodes.map((node) => viewerEdge(`VIEWER-${directory.id}-has-child-${node.id}`, 'has_child_scope', directory.id, node.id)),
      childScopes,
      relatedScopes: [],
      nextActions: childScopes.slice(0, 8).map(scopeToOpenAction),
      omitted: {
        ...graph.omitted,
        childScopes: Math.max(0, childScopes.length - 8)
      }
    })
    setSelectedId(directory.id)
    setInspection(undefined)
  }

  async function expandTarget(targetId: string): Promise<void> {
    setLoading(true)
    setError(undefined)
    try {
      const expansion = await fetchJson<GraphExpansion>(`/api/expand/${encodeURIComponent(targetId)}`)
      const nodes = uniqueById(expansion.facts.map(contextNodeToViewerElement))
      const edges = uniqueById(expansion.edges.map(contextEdgeToViewerElement))
      setGraph({
        title: `Expansion: ${targetId}`,
        scopeId: expansion.scopePath.at(-1)?.id,
        nodes,
        edges,
        childScopes: [],
        relatedScopes: [],
        nextActions: expansion.nextActions,
        omitted: expansion.omitted,
        diagnostics: expansion.diagnostics
      })
      setSelectedId(targetId)
      setInspection(undefined)
    } catch (expandError) {
      setError(errorMessage(expandError))
    } finally {
      setLoading(false)
    }
  }

  async function inspectTarget(targetId: string): Promise<void> {
    setSelectedId(targetId)
    setInspection(undefined)
    try {
      const result = await fetchJson<InspectResult>(`/api/inspect/${encodeURIComponent(targetId)}`)
      setInspection(result)
    } catch (inspectError) {
      setError(errorMessage(inspectError))
    }
  }

  async function runSearch(): Promise<void> {
    const query = searchQuery.trim()
    if (!query) return
    try {
      const result = await fetchJson<SearchResult>(`/api/search?q=${encodeURIComponent(query)}&limit=12`)
      setSearchResult(result)
      setHighlightedIds(result.results.map((node) => node.id))
      if (result.results.length > 0) {
        setGraph((current) => current ? mergeSearchResults(current, result.results) : current)
        await inspectTarget(result.results[0].id)
      }
    } catch (searchError) {
      setError(errorMessage(searchError))
    }
  }

  const selectedElement = graph?.nodes.find((node) => node.id === selectedId) ?? graph?.edges.find((edge) => edge.id === selectedId)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark"><Network size={20} /></div>
          <div>
            <h1>Graph Inspector</h1>
            <p>{graph?.title ?? 'Loading context'}</p>
          </div>
        </div>

        <div className="search-box">
          <Search size={16} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runSearch()
            }}
            placeholder="Search nodes"
          />
          <button type="button" title="Search" onClick={() => void runSearch()}>
            <ChevronRight size={16} />
          </button>
        </div>

        <nav className="breadcrumb" aria-label="Breadcrumb">
          {breadcrumb.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => item.id === 'overview' ? void loadOverview() : void openScope(item.id, item.title)}
              title={item.id}
            >
              {index > 0 && <ChevronRight size={13} />}
              <span>{item.title}</span>
            </button>
          ))}
        </nav>

        <FilterGroup
          title="Node Types"
          icon={<Filter size={15} />}
          values={availableNodeTypes}
          selected={nodeFilters}
          onChange={setNodeFilters}
        />
        <FilterGroup
          title="Edge Types"
          icon={<GitBranch size={15} />}
          values={availableEdgeTypes}
          selected={edgeFilters}
          onChange={setEdgeFilters}
        />

        <section className="sidebar-section">
          <header>
            <Search size={15} />
            <span>Results</span>
          </header>
          <div className="result-list">
            {searchResult?.results.map((result) => (
              <button key={result.id} type="button" onClick={() => void inspectTarget(result.id)}>
                <span className="type-dot" style={{ background: result.styleHints.color }} />
                <span>{result.label}</span>
                <small>{result.type}</small>
              </button>
            ))}
            {searchResult && searchResult.results.length === 0 && <p className="muted">No matches</p>}
          </div>
        </section>
      </aside>

      <main className="graph-panel">
        <div className="graph-toolbar">
          <div className="graph-title">
            <Layers3 size={18} />
            <span>{visibleGraph?.title ?? 'Context Graph'}</span>
          </div>
          <div className="toolbar-actions">
            <button type="button" title="Back to overview" onClick={() => void loadOverview()}>
              <ArrowLeft size={16} />
              Overview
            </button>
            <button type="button" title="Reload graph" onClick={() => graph?.scopeId ? void openScope(graph.scopeId, graph.title) : void loadOverview()}>
              <RefreshCw size={16} />
              Reload
            </button>
          </div>
        </div>
        <GraphCanvas
          graph={visibleGraph}
          selectedId={selectedId}
          highlightedIds={highlightedIds}
          onSelect={(id) => void inspectTarget(id)}
          onOpenScope={(scopeId, label) => void openScope(scopeId, label)}
          onOpenDirectory={(id) => openDirectory(id)}
          onExpand={(id) => void expandTarget(id)}
        />
        {loading && <div className="loading-overlay">Loading graph</div>}
        {error && <div className="error-banner">{error}</div>}
      </main>

      <InspectorPanel
        element={selectedElement}
        inspection={inspection}
        onOpenScope={(scopeId, label) => void openScope(scopeId, label)}
        onOpenDirectory={(id) => openDirectory(id)}
        onExpand={(id) => void expandTarget(id)}
      />

      <EvidenceDrawer
        graph={graph}
        inspection={inspection}
        onOpenScope={(scopeId, label) => void openScope(scopeId, label)}
        onExpand={(id) => void expandTarget(id)}
      />
    </div>
  )
}

function GraphCanvas(props: {
  graph?: GraphModel
  selectedId?: string
  highlightedIds: string[]
  onSelect(id: string): void
  onOpenScope(scopeId: string, label?: string): void
  onOpenDirectory(id: string): void
  onExpand(id: string): void
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cyRef = useRef<Core | undefined>()

  useEffect(() => {
    if (!containerRef.current || !props.graph) return
    cyRef.current?.destroy()
    const cy = cytoscape({
      container: containerRef.current,
      elements: toCytoscapeElements(props.graph),
      layout: layoutForGraph(props.graph),
      style: cytoscapeStyle()
    })
    cy.on('tap', 'node', (event) => {
      const node = event.target
      const scopeId = node.data('scopeId') as string | undefined
      const type = node.data('type') as string | undefined
      if (scopeId && type && isGraphLayerType(type)) {
        props.onOpenScope(scopeId, node.data('label') as string | undefined)
        return
      }
      props.onSelect(node.id())
    })
    cy.on('tap', 'edge', (event) => props.onSelect(event.target.id()))
    cy.on('dbltap', 'node', (event) => {
      const node = event.target
      const scopeId = node.data('scopeId') as string | undefined
      const factKind = node.data('factKind') as string | undefined
      if (factKind === 'directory') {
        props.onOpenDirectory(node.id())
        return
      }
      if (scopeId) {
        props.onOpenScope(scopeId, node.data('label') as string | undefined)
      } else {
        props.onExpand(node.id())
      }
    })
    cyRef.current = cy
    window.setTimeout(() => {
      cy.fit(cy.elements(), props.graph && props.graph.nodes.length <= 30 ? 24 : 52)
      if (props.graph && props.graph.nodes.length <= 30) {
        if (cy.zoom() < 0.72) {
          cy.zoom(0.72)
          cy.center()
        }
      }
    }, 120)
    return () => cy.destroy()
  }, [props.graph])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.elements().removeClass('selected highlighted')
    if (props.selectedId) {
      cy.getElementById(props.selectedId).addClass('selected')
    }
    for (const id of props.highlightedIds) {
      cy.getElementById(id).addClass('highlighted')
    }
    const target = props.selectedId ? cy.getElementById(props.selectedId) : props.highlightedIds[0] ? cy.getElementById(props.highlightedIds[0]) : undefined
    if (target && target.length > 0) {
      cy.animate({ center: { eles: target }, zoom: Math.max(cy.zoom(), 1.1) }, { duration: 220 })
    }
  }, [props.highlightedIds, props.selectedId])

  return <div ref={containerRef} className="graph-canvas" />
}

function InspectorPanel(props: {
  element?: ViewerElement
  inspection?: InspectResult
  onOpenScope(scopeId: string, label?: string): void
  onOpenDirectory(id: string): void
  onExpand(id: string): void
}): JSX.Element {
  const element = props.inspection?.target ?? props.element
  const scopeId = element?.rawRef.scopeId ?? element?.scopeId
  const canExpand = element && element.rawRef.factKind !== 'directory'
  return (
    <aside className="inspector">
      <header>
        <PanelRight size={17} />
        <span>Inspector</span>
      </header>
      {!element && <p className="muted">Select a node or edge</p>}
      {element && (
        <>
          <div className="fact-heading">
            <span className="type-dot large" style={{ background: element.styleHints.color }} />
            <div>
              <h2>{element.label}</h2>
              <p>{element.type} · {element.id}</p>
            </div>
          </div>
          <div className="action-row">
            {scopeId && (
              <button type="button" title="Open scope" onClick={() => props.onOpenScope(scopeId, element.label)}>
                <Layers3 size={15} />
                Open scope
              </button>
            )}
            {element.rawRef.factKind === 'directory' && (
              <button type="button" title="Open directory" onClick={() => props.onOpenDirectory(element.id)}>
                <Layers3 size={15} />
                Open directory
              </button>
            )}
            {canExpand && (
              <button type="button" title="Expand target" onClick={() => props.onExpand(element.id)}>
                <Waypoints size={15} />
                Expand
              </button>
            )}
          </div>
          <KeyValue title="Metrics" value={element.metrics} />
          <KeyValue title="Data" value={element.data ?? {}} />
          {props.inspection?.explanation && (
            <section className="inspector-section">
              <h3>Why It Exists</h3>
              <p>{props.inspection.explanation.provenance.length} provenance records · {props.inspection.explanation.patches.length} patches · {props.inspection.explanation.evidenceReports.length} evidence reports</p>
              <SourceRefList refs={props.inspection.explanation.sourceRefs} />
            </section>
          )}
          {props.inspection?.diagnostics.length ? <Diagnostics diagnostics={props.inspection.diagnostics} /> : null}
        </>
      )}
    </aside>
  )
}

function EvidenceDrawer(props: {
  graph?: GraphModel
  inspection?: InspectResult
  onOpenScope(scopeId: string, label?: string): void
  onExpand(id: string): void
}): JSX.Element {
  const trace = props.inspection?.trace
  const expansion = props.inspection?.expansion
  const nodeLabels = new Map((props.graph?.nodes ?? []).map((node) => [node.id, node.label]))
  return (
    <footer className="evidence-drawer">
      <section>
        <header>
          <Compass size={15} />
          <span>Next Actions</span>
        </header>
        <div className="action-list">
          {(expansion?.nextActions ?? props.graph?.nextActions ?? []).slice(0, 8).map((action) => (
            <button
              key={`${action.type}:${action.targetId}:${action.scopeId ?? ''}`}
              type="button"
              onClick={() => action.type === 'open_scope' && action.scopeId ? props.onOpenScope(action.scopeId, action.label) : props.onExpand(action.targetId)}
              title={action.reason}
            >
              <ChevronRight size={14} />
              <span>{formatNextActionLabel(action, nodeLabels)}</span>
            </button>
          ))}
        </div>
      </section>
      <section>
        <header>
          <FileSearch size={15} />
          <span>Source Trace</span>
        </header>
        {trace ? (
          <div className="trace-grid">
            <TraceColumn title="Groups" items={trace.sourceGroups.map((node) => node.name ?? node.id)} />
            <TraceColumn title="Files" items={trace.files.map((node) => node.name ?? node.id)} />
            <TraceColumn title="Content" items={trace.contentNodes.map((node) => node.name ?? node.id)} />
            <TraceColumn title="Refs" items={trace.sourceRefs.map(formatSourceRef)} />
          </div>
        ) : (
          <p className="muted">Select a fact to load trace</p>
        )}
      </section>
      <section>
        <header>
          <Braces size={15} />
          <span>Omitted</span>
        </header>
        <pre>{JSON.stringify(props.inspection?.trace?.omitted ?? props.graph?.omitted ?? {}, null, 2)}</pre>
      </section>
    </footer>
  )
}

function FilterGroup(props: {
  title: string
  icon: JSX.Element
  values: string[]
  selected: Set<string>
  onChange(next: Set<string>): void
}): JSX.Element {
  return (
    <section className="sidebar-section">
      <header>
        {props.icon}
        <span>{props.title}</span>
      </header>
      <div className="filter-grid">
        {props.values.map((value) => (
          <label key={value}>
            <input
              type="checkbox"
              checked={props.selected.has(value)}
              onChange={(event) => {
                const next = new Set(props.selected)
                if (event.target.checked) next.add(value)
                else next.delete(value)
                props.onChange(next)
              }}
            />
            <span>{value}</span>
          </label>
        ))}
      </div>
    </section>
  )
}

function KeyValue(props: { title: string; value: unknown }): JSX.Element {
  return (
    <section className="inspector-section">
      <h3>{props.title}</h3>
      <pre>{JSON.stringify(props.value, null, 2)}</pre>
    </section>
  )
}

function Diagnostics(props: { diagnostics: Diagnostic[] }): JSX.Element {
  return (
    <section className="inspector-section diagnostics">
      <h3>Diagnostics</h3>
      {props.diagnostics.map((diagnostic, index) => (
        <p key={`${diagnostic.code ?? 'diagnostic'}:${index}`}>{diagnostic.code ?? diagnostic.severity}: {diagnostic.message}</p>
      ))}
    </section>
  )
}

function SourceRefList(props: { refs: SourceRef[] }): JSX.Element {
  if (props.refs.length === 0) return <p className="muted">No source refs</p>
  return (
    <ul className="source-list">
      {props.refs.slice(0, 8).map((ref) => (
        <li key={`${ref.uri}:${ref.location?.lineStart ?? 0}`}>{formatSourceRef(ref)}</li>
      ))}
    </ul>
  )
}

function TraceColumn(props: { title: string; items: string[] }): JSX.Element {
  return (
    <div>
      <h4>{props.title}</h4>
      {props.items.slice(0, 6).map((item) => <p key={item}>{item}</p>)}
      {props.items.length > 6 && <small>+{props.items.length - 6} more</small>}
    </div>
  )
}

function toCytoscapeElements(graph: GraphModel): ElementDefinition[] {
  const nodes: ElementDefinition[] = graph.nodes.map((node) => ({
    data: {
      id: node.id,
      label: node.label,
      displayLabel: displayLabelForNode(node, graph.nodes.length),
      type: node.type,
      color: node.styleHints.color,
      shape: node.styleHints.shape,
      size: node.styleHints.size,
      scopeId: node.rawRef.scopeId ?? node.scopeId,
      factKind: node.rawRef.factKind
    }
  }))
  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  const edges: ElementDefinition[] = graph.edges
    .filter((edge) => edge.source && edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.type,
        displayLabel: graph.nodes.length <= 80 ? edge.type : '',
        color: edge.styleHints.color,
        width: edge.styleHints.size,
        lineStyle: edge.styleHints.lineStyle ?? 'solid'
      }
    }))
  return [...nodes, ...edges]
}

function layoutForGraph(graph: GraphModel): cytoscape.LayoutOptions {
  if (graph.nodes.length <= 80 && graph.nodes.some((node) => isGraphLayerType(node.type))) {
    return {
      name: 'breadthfirst',
      directed: true,
      animate: false,
      fit: true,
      padding: 70,
      spacingFactor: graph.nodes.length <= 30 ? 1.45 : 1.1,
      avoidOverlap: true
    } as cytoscape.LayoutOptions
  }
  return {
    name: 'cose',
    animate: false,
    fit: true,
    padding: 52,
    nodeRepulsion: 12000,
    idealEdgeLength: 145,
    nodeOverlap: 36,
    componentSpacing: 88
  } as cytoscape.LayoutOptions
}

function cytoscapeStyle() {
  return [
    {
      selector: 'node',
      style: {
        'background-color': 'data(color)',
        width: 'data(size)',
        height: 'data(size)',
        shape: 'data(shape)',
        label: 'data(displayLabel)',
        color: '#0f172a',
        'font-size': 11,
        'text-wrap': 'wrap',
        'text-max-width': 118,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 8,
        'text-background-color': '#f8fafc',
        'text-background-opacity': 0.84,
        'text-background-padding': 2,
        'border-color': '#ffffff',
        'border-width': 2,
        'overlay-opacity': 0
      }
    },
    {
      selector: 'edge',
      style: {
        width: 'data(width)',
        'line-color': 'data(color)',
        'target-arrow-color': 'data(color)',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'line-style': 'data(lineStyle)',
        label: 'data(displayLabel)',
        'font-size': 9,
        color: '#475569',
        'text-background-color': '#ffffff',
        'text-background-opacity': 0.78,
        'text-background-padding': 2
      }
    },
    {
      selector: '.selected',
      style: {
        label: 'data(label)',
        'border-color': '#f59e0b',
        'border-width': 4,
        'line-color': '#f59e0b',
        'target-arrow-color': '#f59e0b'
      }
    },
    {
      selector: '.highlighted',
      style: {
        label: 'data(label)',
        'border-color': '#22c55e',
        'border-width': 4,
        'line-color': '#22c55e',
        'target-arrow-color': '#22c55e'
      }
    }
  ] as cytoscape.StylesheetJson
}

function displayLabelForNode(node: ViewerElement, graphSize: number): string {
  if (graphSize <= 90) {
    return labelWithType(node, 28)
  }
  if (node.type === 'DirectoryGraph') {
    return labelWithType(node, 22)
  }
  if (node.type === 'ProjectGraph' || node.type === 'PackageGraph' || node.type === 'SourceGroupGraph' || node.type === 'RepositoryGraph' || node.type === 'SemanticCorpusGraph' || node.type === 'ApiContractGraph' || node.type === 'InventoryGraph' || node.type.endsWith('GraphLayer')) {
    return labelWithType(node, 24)
  }
  if (node.type === 'FileGraph' || node.type === 'ContentGraph') {
    return labelWithType({ ...node, label: lastPathPart(node.label) }, graphSize > 180 ? 14 : 20)
  }
  if (node.type === 'Requirement' || node.type === 'Document' || node.type === 'APIEndpoint') {
    return labelWithType(node, 24)
  }
  if (node.type === 'CodeSymbol' && graphSize <= 160) {
    return labelWithType(node, 20)
  }
  return ''
}

function labelWithType(node: ViewerElement, maxLength: number): string {
  const prefix = typePrefix(node.type)
  if (node.type === 'FileGraph' || node.type === 'ContentGraph' || node.type === 'File') {
    return `${prefix}\n${shortLabel(lastPathPart(node.label), maxLength)}`
  }
  return `${prefix}\n${shortLabel(node.label, maxLength)}`
}

function typePrefix(type: string): string {
  switch (type) {
    case 'ProjectGraph':
      return 'Project'
    case 'PackageGraph':
      return 'L0'
    case 'SourceGroupGraph':
      return 'Group'
    case 'RepositoryGraph':
      return 'L2 Code'
    case 'SemanticCorpusGraph':
      return 'L2 Docs'
    case 'ApiContractGraph':
      return 'L2 API'
    case 'InventoryGraph':
      return 'L2 Inv'
    case 'DirectoryGraph':
      return 'Directory'
    case 'FileGraph':
      return 'FileGraph'
    case 'ContentGraph':
      return 'Content'
    case 'Requirement':
      return 'Requirement'
    case 'Document':
      return 'Document'
    case 'CodeSymbol':
      return 'Symbol'
    case 'APIEndpoint':
      return 'API'
    case 'File':
      return 'File'
    default:
      return type.replace(/GraphLayer$/, '').replace(/Graph$/, '')
  }
}

function shortLabel(label: string, maxLength: number): string {
  return label.length > maxLength ? `${label.slice(0, Math.max(1, maxLength - 3))}...` : label
}

function lastPathPart(label: string): string {
  const parts = label.split('/')
  return parts[parts.length - 1] ?? label
}

function scopeViewToModel(view: GraphScopeView): GraphModel {
  const root = scopeToViewerElement(view.scope)
  const bucketChildScopes = shouldBucketChildScopes(view)
  const childScopeNodes = bucketChildScopes ? directoryScopeNodes(view) : view.childScopes.map(scopeToViewerElement)
  const relatedScopeNodes = view.relatedScopes.map(scopeToViewerElement)
  const childScopeRootIds = new Set(view.childScopes.map((scope) => scope.rootNodeId).filter((id): id is string => typeof id === 'string'))
  const includeFacts = view.scope.kind === 'file' || view.scope.kind === 'content' || view.childScopes.length <= 12
  const factCandidates = uniqueById([...view.entrypoints, ...view.nodes.filter((node) => isImportantFactType(node.type))])
    .filter((node) => !isDuplicateScopeFact(node, view.scope, childScopeRootIds))
  const factNodes = includeFacts
    ? factCandidates.slice(0, 36).map(contextNodeToViewerElement)
    : factCandidates.filter((node) => node.type === 'Requirement' || node.type === 'Document' || node.type === 'APIEndpoint').slice(0, 12).map(contextNodeToViewerElement)
  const nodes = uniqueById([root, ...childScopeNodes, ...relatedScopeNodes, ...factNodes])
  const nodeIds = new Set(nodes.map((node) => node.id))
  const scopeEdges = [
    ...childScopeNodes.map((node) => viewerEdge(`VIEWER-${view.scope.id}-has-child-${node.id}`, node.type === 'DirectoryGraph' ? 'contains_directory' : 'has_child_scope', view.scope.id, node.id)),
    ...relatedScopeNodes.map((node) => viewerEdge(`VIEWER-${view.scope.id}-related-${node.id}`, 'related_to_group', view.scope.id, node.id)),
    ...factNodes.map((node) => viewerEdge(`VIEWER-${view.scope.id}-contains-${node.id}`, 'contains', view.scope.id, node.id))
  ]
  const factEdges = view.edges
    .map(contextEdgeToViewerElement)
    .filter((edge) => edge.source && edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target))
  return {
    title: view.scope.title ?? view.scope.id,
    scopeId: view.scope.id,
    nodes,
    edges: uniqueById([...scopeEdges, ...factEdges]),
    childScopes: view.childScopes,
    relatedScopes: view.relatedScopes,
    nextActions: view.nextActions,
    omitted: view.omitted,
    diagnostics: view.diagnostics
  }
}

function shouldBucketChildScopes(view: GraphScopeView): boolean {
  if (view.scope.kind !== 'source_group') return false
  const fileScopes = view.childScopes.filter((scope) => scope.kind === 'file')
  return fileScopes.length >= DIRECTORY_BUCKET_THRESHOLD
}

function directoryScopeNodes(view: GraphScopeView): ViewerElement[] {
  const groups = new Map<string, GraphScope[]>()
  for (const scope of view.childScopes) {
    if (scope.kind !== 'file') continue
    const directory = directoryBucketName(scope, view.scope)
    const existing = groups.get(directory) ?? []
    existing.push(scope)
    groups.set(directory, existing)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([directory, scopes]) => directoryViewerElement(view.scope, directory, scopes))
}

function directoryViewerElement(parentScope: GraphScope, directory: string, scopes: GraphScope[]): ViewerElement {
  const id = `viewer:directory:${parentScope.id}:${slug(directory)}`
  const files = scopes.reduce((count, scope) => count + (scope.stats?.files ?? 1), 0)
  return {
    id,
    kind: 'node',
    type: 'DirectoryGraph',
    label: `${directory} (${files})`,
    metrics: {
      scopes: scopes.length,
      files
    },
    childScopes: scopes,
    styleHints: {
      color: colorForType('DirectoryGraph'),
      shape: shapeForType('DirectoryGraph'),
      size: sizeForType('DirectoryGraph')
    },
    rawRef: {
      factKind: 'directory',
      factId: id
    },
    data: {
      directory,
      parentScopeId: parentScope.id,
      files,
      childScopePreview: scopes.slice(0, 12).map((scope) => scope.path ?? scope.title ?? scope.id),
      omittedChildScopes: Math.max(0, scopes.length - 12)
    }
  }
}

function graphScopesFromUnknown(value: unknown): GraphScope[] {
  if (!Array.isArray(value)) return []
  return value.filter(isGraphScope)
}

function isGraphScope(value: unknown): value is GraphScope {
  return Boolean(value && typeof value === 'object' && typeof (value as GraphScope).id === 'string' && typeof (value as GraphScope).kind === 'string')
}

function scopeToOpenAction(scope: GraphScope): NextAction {
  return {
    type: 'open_scope',
    targetId: scope.rootNodeId ?? scope.id,
    label: scope.title ?? scope.path ?? scope.id,
    reason: 'Open graph scope',
    scopeId: scope.id
  }
}

function directoryBucketName(scope: GraphScope, parentScope: GraphScope): string {
  const path = scope.path ?? scope.title ?? scope.id
  const root = parentScope.path
  const relative = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
  const [first] = relative.split('/')
  return first && first !== relative ? first : '(root files)'
}

function isDuplicateScopeFact(node: ContextNode, scope: GraphScope, childScopeRootIds: Set<string>): boolean {
  if (node.id === scope.rootNodeId) {
    return true
  }
  if (node.type === 'SourceGroup') {
    return true
  }
  if (scope.kind === 'source_group' && node.type === 'File' && childScopeRootIds.has(node.id)) {
    return true
  }
  return false
}

function scopeToViewerElement(scope: GraphScope): ViewerElement {
  const type = graphTypeForScope(scope)
  return {
    id: scope.id,
    kind: 'node',
    type,
    label: scope.title ?? scope.id,
    scopeId: scope.id,
    status: scope.freshness?.status,
    metrics: {
      nodes: scope.stats?.nodes ?? 0,
      edges: scope.stats?.edges ?? 0,
      files: scope.stats?.files ?? 0,
      groups: scope.stats?.groups ?? 0,
      diagnostics: scope.stats?.diagnostics ?? 0
    },
    styleHints: {
      color: colorForType(type),
      shape: shapeForType(type),
      size: sizeForType(type)
    },
    rawRef: {
      factKind: 'scope',
      factId: scope.id,
      scopeId: scope.id
    },
    data: {
      scope,
      path: scope.path
    }
  }
}

function viewerEdge(id: string, type: string, source: string, target: string): ViewerElement {
  return {
    id,
    kind: 'edge',
    type,
    label: type,
    source,
    target,
    metrics: {},
    styleHints: {
      color: colorForEdge(type),
      shape: 'triangle',
      size: type === 'related_to_group' ? 2 : 1,
      lineStyle: type === 'related_to_group' || type === 'materializes_runtime' ? 'dashed' : 'solid'
    },
    rawRef: {
      factKind: 'edge',
      factId: id
    }
  }
}

function contextNodeToViewerElement(node: ContextNode): ViewerElement {
  const color = colorForType(node.type)
  return {
    id: node.id,
    kind: 'node',
    type: node.type,
    label: node.name ?? node.id,
    scopeId: node.type === 'SourceGroup' ? sourceGroupScopeId(node.id) : node.scopeId,
    status: node.status,
    metrics: {
      sourceRefs: node.sourceRefs?.length ?? 0
    },
    styleHints: {
      color,
      shape: shapeForType(node.type),
      size: sizeForType(node.type)
    },
    rawRef: {
      factKind: 'node',
      factId: node.id,
      scopeId: node.type === 'SourceGroup' ? sourceGroupScopeId(node.id) : node.scopeId
    },
    data: {
      sourceRefs: node.sourceRefs ?? [],
      properties: previewProperties(node.properties ?? {})
    }
  }
}

function graphTypeForScope(scope: GraphScope): string {
  switch (scope.kind) {
    case 'project':
      return 'ProjectGraph'
    case 'package':
      return 'PackageGraph'
    case 'source_group':
      return 'SourceGroupGraph'
    case 'file':
      return 'FileGraph'
    case 'content':
      return 'ContentGraph'
    default:
      return `${scope.kind[0]?.toUpperCase() ?? ''}${scope.kind.slice(1)}Graph`
  }
}

function isImportantFactType(type: string): boolean {
  return type === 'Requirement' || type === 'Document' || type === 'APIEndpoint' || type === 'CodeSymbol' || type === 'File'
}

function isGraphLayerType(type: string): boolean {
  return type.endsWith('Graph') || type.endsWith('GraphLayer')
}

function contextEdgeToViewerElement(edge: ContextEdge): ViewerElement {
  return {
    id: edge.id,
    kind: 'edge',
    type: edge.type,
    label: edge.type,
    scopeId: edge.scopeId,
    status: edge.status,
    source: edge.from,
    target: edge.to,
    metrics: {
      evidence: edge.evidence?.length ?? 0
    },
    styleHints: {
      color: colorForEdge(edge.type),
      shape: 'triangle',
      size: edge.type === 'related_to_group' ? 2 : 1,
      lineStyle: edge.type === 'related_to_group' ? 'dashed' : 'solid'
    },
    rawRef: {
      factKind: 'edge',
      factId: edge.id,
      scopeId: edge.scopeId
    },
    data: {
      evidence: edge.evidence ?? [],
      linker: edge.linker,
      properties: previewProperties(edge.properties ?? {})
    }
  }
}

function mergeSearchResults(graph: GraphModel, results: ViewerElement[]): GraphModel {
  return {
    ...graph,
    nodes: uniqueById([...results, ...graph.nodes])
  }
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const next: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    next.push(item)
  }
  return next
}

function orderedTypes(values: string[], preferredOrder: string[]): string[] {
  const unique = [...new Set(values)]
  return unique.sort((left, right) => {
    const leftIndex = preferredOrder.indexOf(left)
    const rightIndex = preferredOrder.indexOf(right)
    if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right)
    if (leftIndex === -1) return 1
    if (rightIndex === -1) return -1
    return leftIndex - rightIndex
  })
}

function sourceGroupScopeId(id: string): string {
  return `scope:source-group:${slug(id)}`
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]+/g, '-')
}

function colorForType(type: string): string {
  switch (type) {
    case 'ProjectGraph':
      return '#1d4ed8'
    case 'PackageGraph':
      return '#0f766e'
    case 'SourceGroupGraph':
      return '#0e7490'
    case 'RepositoryGraph':
      return '#0f766e'
    case 'SemanticCorpusGraph':
      return '#7c3aed'
    case 'ApiContractGraph':
      return '#ea580c'
    case 'InventoryGraph':
      return '#64748b'
    case 'DirectoryGraph':
      return '#334155'
    case 'FileGraph':
    case 'FileGraphLayer':
      return '#64748b'
    case 'ContentGraph':
    case 'ContentGraphLayer':
      return '#059669'
    case 'FactGraph':
    case 'FactGraphLayer':
      return '#7c3aed'
    case 'RuntimeGraph':
    case 'RuntimeGraphLayer':
      return '#ea580c'
    case 'Project':
      return '#2563eb'
    case 'SourceGroup':
      return '#0891b2'
    case 'Requirement':
      return '#7c3aed'
    case 'Document':
    case 'Section':
      return '#059669'
    case 'APIEndpoint':
      return '#ea580c'
    case 'CodeSymbol':
      return '#0f766e'
    case 'File':
    case 'SourceSnapshot':
      return '#64748b'
    default:
      return '#475569'
  }
}

function colorForEdge(type: string): string {
  switch (type) {
    case 'has_child_scope':
      return '#2563eb'
    case 'contains_package':
      return '#0f766e'
    case 'contains_source_group':
      return '#0891b2'
    case 'contains_directory':
      return '#334155'
    case 'materializes_runtime':
      return '#ea580c'
    case 'calls':
      return '#dc2626'
    case 'imports':
    case 'references':
      return '#2563eb'
    case 'related_to_group':
      return '#9333ea'
    default:
      return '#64748b'
  }
}

function shapeForType(type: string): string {
  switch (type) {
    case 'ProjectGraph':
    case 'PackageGraph':
    case 'SourceGroupGraph':
    case 'RepositoryGraph':
    case 'SemanticCorpusGraph':
    case 'ApiContractGraph':
    case 'InventoryGraph':
    case 'DirectoryGraph':
      return 'round-rectangle'
    case 'FileGraph':
    case 'FileGraphLayer':
      return 'rectangle'
    case 'ContentGraph':
    case 'ContentGraphLayer':
      return 'ellipse'
    case 'FactGraph':
    case 'FactGraphLayer':
      return 'diamond'
    case 'RuntimeGraph':
    case 'RuntimeGraphLayer':
      return 'hexagon'
    case 'Project':
    case 'SourceGroup':
      return 'round-rectangle'
    case 'APIEndpoint':
      return 'diamond'
    case 'CodeSymbol':
      return 'hexagon'
    case 'File':
    case 'SourceSnapshot':
      return 'rectangle'
    default:
      return 'ellipse'
  }
}

function sizeForType(type: string): number {
  switch (type) {
    case 'ProjectGraph':
      return 68
    case 'PackageGraph':
      return 60
    case 'SourceGroupGraph':
      return 58
    case 'RepositoryGraph':
    case 'SemanticCorpusGraph':
    case 'ApiContractGraph':
      return 54
    case 'InventoryGraph':
      return 50
    case 'DirectoryGraph':
      return 62
    case 'FileGraph':
    case 'FileGraphLayer':
      return 46
    case 'ContentGraph':
    case 'ContentGraphLayer':
    case 'RuntimeGraph':
    case 'RuntimeGraphLayer':
      return 44
    case 'FactGraph':
    case 'FactGraphLayer':
      return 46
    case 'Project':
      return 56
    case 'SourceGroup':
      return 48
    case 'Requirement':
    case 'APIEndpoint':
      return 42
    case 'CodeSymbol':
      return 36
    case 'File':
    case 'SourceSnapshot':
      return 32
    default:
      return 30
  }
}

function previewProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const next = { ...properties }
  if (typeof next.content === 'string' && next.content.length > 320) {
    next.contentPreview = next.content.slice(0, 320)
    next.contentOmittedChars = next.content.length - 320
    delete next.content
  }
  return next
}

function formatSourceRef(ref: SourceRef): string {
  const path = ref.location?.path ?? ref.uri
  const line = ref.location?.lineStart ? `:${ref.location.lineStart}` : ''
  return `${path}${line}`
}

function formatNextActionLabel(action: NextAction, nodeLabels: Map<string, string>): string {
  const label = nodeLabels.get(action.targetId) ?? action.label
  if (action.type === 'open_scope') {
    return `Open scope · ${shortLabel(lastPathPart(label), 72)}`
  }
  if (action.targetId.startsWith('FILE-')) {
    return `File fact · ${shortLabel(label, 72)}`
  }
  if (action.targetId.startsWith('MARKDOWN-')) {
    return `Document fact · ${shortLabel(label, 72)}`
  }
  if (action.targetId.startsWith('SYM-')) {
    return `Code symbol · ${shortLabel(label, 72)}`
  }
  return `${action.type.replace('_', ' ')} · ${shortLabel(label, 72)}`
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 180)}`)
  }
  return await response.json() as T
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
