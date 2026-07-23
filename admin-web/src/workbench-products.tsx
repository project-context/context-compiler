import {
  CSSProperties,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, JsonObject, Page } from "./api";

export type ProductStage = "workspace" | "sources" | "normalize" | "structure" | "evidence" | "fact" | "semantic" | "project";

type RevisionRefView = { entity: { layer: string; id: string }; revision: string };
export type FileDescriptor = { id: string; sourceId: string; path: string; title: string; normalized?: JsonObject; source?: JsonObject };
type ScopeContextView = { target: RevisionRefView; directAssignments: JsonObject[]; effective: { values: JsonObject[]; conflicts: JsonObject[] }; scopes: JsonObject[] };
export type GraphNode = { id: string; label: string; meta: string; column: number; record?: JsonObject; scopeIds: string[] };
export type GraphEdge = { from: string; to: string; label: string };
export type GraphModel = { nodes: GraphNode[]; edges: GraphEdge[] };

const stageCollections: Record<ProductStage, string> = {
  workspace: "sources", sources: "sources", normalize: "normalized-sources", structure: "structures",
  evidence: "evidence", fact: "facts", semantic: "semantic-edges", project: "normalized-sources",
};

const scopeCollections: Partial<Record<ProductStage, { collection: string; label: string; readOnly?: boolean }>> = {
  sources: { collection: "snapshots", label: "Source" },
  normalize: { collection: "normalized-sources", label: "Normalized Source" },
  structure: { collection: "structures", label: "Structure" },
  evidence: { collection: "evidence", label: "Evidence" },
  fact: { collection: "facts", label: "Fact" },
  semantic: { collection: "facts", label: "Fact 范围边界", readOnly: true },
  project: { collection: "facts", label: "EffectiveScope 索引", readOnly: true },
};

export function LayerProduct({ workspaceId, stage, fail }: { workspaceId: string; stage: ProductStage; fail: (message: string) => void }) {
  if (stage === "workspace" || stage === "sources") return <FileProduct workspaceId={workspaceId} normalized={false} fail={fail} />;
  if (stage === "normalize" || stage === "project") return <FileProduct workspaceId={workspaceId} normalized fail={fail} />;
  if (stage === "structure") return <StructureGraphProduct workspaceId={workspaceId} fail={fail} />;
  return <GraphProduct workspaceId={workspaceId} stage={stage} fail={fail} />;
}

function FileProduct({ workspaceId, normalized, fail }: { workspaceId: string; normalized: boolean; fail: (message: string) => void }) {
  const [sources, setSources] = useState<JsonObject[]>([]);
  const [outputs, setOutputs] = useState<JsonObject[]>([]);
  const [selectedId, setSelectedId] = useState("");
  useEffect(() => {
    void Promise.all([loadAll(workspaceId, "sources"), normalized ? loadAll(workspaceId, "normalized-sources") : Promise.resolve([])])
      .then(([sourceItems, normalizedItems]) => { setSources(sourceItems); setOutputs(normalizedItems); })
      .catch((error: Error) => fail(error.message));
  }, [workspaceId, normalized, fail]);
  const files = useMemo(() => describeFiles(sources, outputs, normalized), [sources, outputs, normalized]);
  useEffect(() => { setSelectedId((current) => files.some((file) => file.id === current) ? current : files[0]?.id ?? ""); }, [files]);
  const selected = files.find((file) => file.id === selectedId);
  const groups = groupFiles(files);

  return <div className="file-product">
    <aside className="file-browser"><div className="product-heading"><b>{normalized ? "标准化文件" : "原始文件"}</b><span>{files.length} files</span></div>{groups.length ? groups.map(([sourceId, values]) => <details key={sourceId}><summary>{sourceId}<span>{values.length}</span></summary><FileTree files={values} selectedId={selectedId} select={setSelectedId} /></details>) : <ProductEmpty text={normalized ? "运行标准化后显示文件" : "运行数据源采集后显示文件"} />}</aside>
    <section className="file-preview"><div className="product-heading"><div><b>{selected?.title ?? "文件预览"}</b>{selected && <p>{selected.path}</p>}</div>{selected?.normalized && <span>{String(selected.normalized.mediaType ?? selected.normalized.format ?? "normalized")}</span>}</div>{selected ? normalized && selected.normalized ? <ContentPreview workspaceId={workspaceId} record={selected.normalized} /> : <SourceMetadata file={selected} /> : <ProductEmpty text="从左侧选择一个文件" />}</section>
  </div>;
}

function FileTree({ files, selectedId, select }: { files: FileDescriptor[]; selectedId: string; select: (id: string) => void }) {
  const tree = buildFileTree(files);
  return <div className="fs-tree">{tree.map((node) => <TreeNode key={node.path} node={node} selectedId={selectedId} select={select} depth={0} />)}</div>;
}

export type FileTreeNode = { name: string; path: string; children: FileTreeNode[]; file?: FileDescriptor };

export function buildFileTree(files: FileDescriptor[]): FileTreeNode[] {
  const root: FileTreeNode = { name: "", path: "", children: [] };
  for (const file of files) {
    const segments = file.path.replace(/^\/+/, "").split("/").filter(Boolean);
    let cursor = root;
    segments.forEach((name, index) => {
      const path = segments.slice(0, index + 1).join("/");
      let child = cursor.children.find((value) => value.name === name);
      if (!child) { child = { name, path, children: [] }; cursor.children.push(child); }
      cursor = child;
    });
    cursor.file = file;
  }
  const sort = (nodes: FileTreeNode[]) => { nodes.sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name)); nodes.forEach((node) => sort(node.children)); };
  sort(root.children);
  return root.children;
}

function TreeNode({ node, selectedId, select, depth }: { node: FileTreeNode; selectedId: string; select: (id: string) => void; depth: number }) {
  if (node.children.length) return <details className="fs-folder"><summary style={{ paddingLeft: 9 + depth * 14 }}><span>›</span>{node.name}</summary>{node.file && <FileRow file={node.file} selectedId={selectedId} select={select} depth={depth + 1} />}{node.children.map((child) => <TreeNode key={child.path} node={child} selectedId={selectedId} select={select} depth={depth + 1} />)}</details>;
  return node.file ? <FileRow file={node.file} selectedId={selectedId} select={select} depth={depth} /> : null;
}

function FileRow({ file, selectedId, select, depth }: { file: FileDescriptor; selectedId: string; select: (id: string) => void; depth: number }) {
  return <button className={`fs-file ${selectedId === file.id ? "active" : ""}`} style={{ paddingLeft: 13 + depth * 14 }} onClick={() => select(file.id)}><span>—</span><b>{file.path.split("/").pop()}</b></button>;
}

type ArtifactPreviewResponse = { content: string; truncated: boolean; characters: number };

export function primaryArtifactUri(record: JsonObject): string {
  const primary = record.primary as JsonObject | undefined;
  const artifact = primary?.artifact as JsonObject | undefined;
  return String(artifact?.uri ?? "");
}

function ContentPreview({ workspaceId, record }: { workspaceId: string; record: JsonObject }) {
  const artifactUri = primaryArtifactUri(record);
  const isHtml = String(record.mediaType ?? "").includes("html");
  const [rendered, setRendered] = useState(isHtml);
  const [preview, setPreview] = useState<ArtifactPreviewResponse>();
  const [previewError, setPreviewError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setRendered(isHtml);
    setPreview(undefined);
    setPreviewError("");
    setLoading(false);
    if (!artifactUri) { setPreviewError("该标准化记录没有可读取的主 Artifact。"); return () => { cancelled = true; }; }
    setLoading(true);
    void api.request<ArtifactPreviewResponse>(`/workspaces/${workspaceId}/artifacts/preview`, {
      method: "POST",
      body: JSON.stringify({ artifactUri, maxChars: 500_000 }),
    }).then((value) => { if (!cancelled) setPreview(value); })
      .catch((error: Error) => { if (!cancelled) setPreviewError(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId, artifactUri, isHtml, reloadKey]);
  const content = preview?.content ?? "";
  return <div className="content-preview"><div className="preview-toolbar"><span>{String(record.normalizerId ?? "normalized")}</span><div className="preview-toolbar-actions">{preview?.truncated && <small>内容较大，已截断</small>}{isHtml && preview && <button className="text-button" onClick={() => setRendered((value) => !value)}>{rendered ? "查看源码" : "渲染预览"}</button>}</div></div>{loading ? <PreviewState title="正在读取文件…" /> : previewError ? <PreviewState title="无法读取文件" detail={previewError} action={<button className="source-action" onClick={() => setReloadKey((value) => value + 1)}>重试</button>} /> : preview ? content ? rendered ? <iframe title="HTML preview" sandbox="" srcDoc={content} /> : <pre>{content}</pre> : <PreviewState title="文件内容为空" /> : <PreviewState title="选择文件查看内容" />}</div>;
}

function PreviewState({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return <div className="preview-state"><span>◇</span><b>{title}</b>{detail && <p>{detail}</p>}{action}</div>;
}

function SourceMetadata({ file }: { file: FileDescriptor }) {
  return <div className="source-metadata"><span className="file-glyph">—</span><h3>{file.title}</h3><p>{file.path}</p><dl><div><dt>数据源</dt><dd>{file.sourceId}</dd></div><div><dt>URI</dt><dd>{String(file.source?.uri ?? "—")}</dd></div><div><dt>格式</dt><dd>{String(file.source?.format ?? file.source?.mediaType ?? "—")}</dd></div><div><dt>状态</dt><dd>{String(file.source?.accessStatus ?? "—")}</dd></div></dl></div>;
}

function GraphProduct({ workspaceId, stage, fail }: { workspaceId: string; stage: ProductStage; fail: (message: string) => void }) {
  const [data, setData] = useState<Record<string, JsonObject[]>>({});
  const [selectedFile, setSelectedFile] = useState("");
  const [selectedNode, setSelectedNode] = useState<JsonObject>();
  const [scopeContexts, setScopeContexts] = useState<Record<string, ScopeContextView>>({});
  const [scopeFilter, setScopeFilter] = useState("");
  useEffect(() => {
    void Promise.all(["sources", "normalized-sources", "structures", "evidence", "facts", "semantic-edges", "scopes"].map(async (collection) => [collection, await loadAll(workspaceId, collection)] as const))
      .then((entries) => setData(Object.fromEntries(entries))).catch((error: Error) => fail(error.message));
  }, [workspaceId, stage, fail]);
  const files = useMemo(() => describeFiles(data.sources ?? [], data["normalized-sources"] ?? [], true), [data]);
  useEffect(() => { setSelectedFile((current) => files.some((file) => file.id === current) ? current : files[0]?.id ?? ""); }, [files]);
  const records = data[stageCollections[stage]] ?? [];
  const fileRecords = records.filter((record) => fileIdForRecord(record, files, stage) === selectedFile);
  const factsForEdges = stage === "semantic" ? factsForSemantic(fileRecords, data.facts ?? []) : [];
  const contextTargets = stage === "semantic" ? factsForEdges : fileRecords;
  const contextSignature = contextTargets.map((record) => revisionKey(revisionRefOf(record))).filter(Boolean).join("|");
  useEffect(() => {
    let cancelled = false;
    void loadScopeContexts(workspaceId, contextTargets).then((contexts) => { if (!cancelled) setScopeContexts(contexts); }).catch((error: Error) => fail(error.message));
    return () => { cancelled = true; };
  }, [workspaceId, stage, selectedFile, contextSignature, fail]);
  const scopes = data.scopes ?? [];
  const visible = fileRecords.filter((record) => !scopeFilter || recordScopeIds(record, stage, scopeContexts, data.facts ?? []).includes(scopeFilter));
  const model = buildGraphModel(stage, files.find((file) => file.id === selectedFile), visible, data, scopeContexts);

  return <div className="graph-product"><div className="graph-toolbar"><label>标准化文件<select value={selectedFile} onChange={(event) => { setSelectedFile(event.target.value); setSelectedNode(undefined); }}>{files.map((file) => <option value={file.id} key={file.id}>{file.sourceId} / {file.path}</option>)}</select></label><label>Scope 过滤<select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value)}><option value="">全部 Scope</option>{scopes.map((scope) => <option key={scopeId(scope)} value={scopeId(scope)}>{String(scope.label ?? scopeId(scope))}</option>)}</select></label><span>{visible.length}/{fileRecords.length} records</span></div><GraphWorkspaceLayout
    fileList={groupFiles(files).map(([sourceId, values]) => <div key={sourceId}><b>{sourceId}</b>{values.map((file) => <button className={file.id === selectedFile ? "active" : ""} onClick={() => setSelectedFile(file.id)} key={file.id}>{file.path}</button>)}</div>)}
    canvas={<LayerGraph model={model} select={setSelectedNode} />}
    detail={<><div className="product-heading"><b>节点详情</b><span>{selectedNode ? "DTO" : "未选择"}</span></div>{selectedNode ? <pre>{JSON.stringify(selectedNode, null, 2)}</pre> : <ProductEmpty text="选择 Graph 节点查看引用和 Locator" />}</>}
  /></div>;
}

function StructureGraphProduct({ workspaceId, fail }: { workspaceId: string; fail: (message: string) => void }) {
  const [sources, setSources] = useState<JsonObject[]>([]);
  const [normalized, setNormalized] = useState<JsonObject[]>([]);
  const [scopes, setScopes] = useState<JsonObject[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [units, setUnits] = useState<JsonObject[]>([]);
  const [relations, setRelations] = useState<JsonObject[]>([]);
  const [contexts, setContexts] = useState<Record<string, ScopeContextView>>({});
  const [scopeFilter, setScopeFilter] = useState("");
  const [selectedNode, setSelectedNode] = useState<JsonObject>();
  const [preview, setPreview] = useState<ArtifactPreviewResponse>();
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void Promise.all([
      loadAll(workspaceId, "sources"),
      loadAll(workspaceId, "normalized-sources"),
      loadAll(workspaceId, "scopes"),
    ]).then(([sourceItems, normalizedItems, scopeItems]) => {
      setSources(sourceItems);
      setNormalized(normalizedItems);
      setScopes(scopeItems);
    }).catch((error: Error) => fail(error.message));
  }, [workspaceId, fail]);
  const files = useMemo(() => describeFiles(sources, normalized, true), [sources, normalized]);
  useEffect(() => {
    setSelectedFile((current) => files.some((file) => file.id === current) ? current : files[0]?.id ?? "");
  }, [files]);
  const selected = files.find((file) => file.id === selectedFile);
  useEffect(() => {
    let cancelled = false;
    setUnits([]);
    setRelations([]);
    setContexts({});
    setSelectedNode(undefined);
    if (!selected?.normalized) return () => { cancelled = true; };
    const sourceSnapshot = selected.normalized.sourceSnapshot as RevisionRefView | undefined;
    if (!sourceSnapshot) return () => { cancelled = true; };
    setLoading(true);
    const query = new URLSearchParams({
      limit: "1",
      sourceEntityId: sourceSnapshot.entity.id,
      sourceRevision: sourceSnapshot.revision,
    });
    void api.request<Page>(`/workspaces/${workspaceId}/layers/structures?${query}`)
      .then(async (first) => {
        const build = first.items[0]?.buildRef as RevisionRefView | undefined;
        if (!build) return { units: [], relations: [] };
        const reference = encodeURIComponent(build.revision);
        const [buildUnits, buildRelations] = await Promise.all([
          loadEndpointAll(workspaceId, `structure/builds/${reference}/units`),
          loadEndpointAll(workspaceId, `structure/builds/${reference}/relations`),
        ]);
        return { units: buildUnits, relations: buildRelations };
      })
      .then(async (result) => {
        if (cancelled) return;
        setUnits(result.units);
        setRelations(result.relations);
        setContexts(await loadScopeContexts(workspaceId, result.units));
      })
      .catch((error: Error) => { if (!cancelled) fail(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId, selectedFile, selected?.id, fail]);

  const artifactUri = primaryArtifactUri(selected?.normalized ?? {});
  useEffect(() => {
    let cancelled = false;
    setPreview(undefined);
    setPreviewError("");
    setPreviewLoading(false);
    if (!artifactUri) {
      setPreviewError("该标准化记录没有可读取的主 Artifact。");
      return () => { cancelled = true; };
    }
    setPreviewLoading(true);
    void api.request<ArtifactPreviewResponse>(`/workspaces/${workspaceId}/artifacts/preview`, {
      method: "POST",
      body: JSON.stringify({ artifactUri, maxChars: 2_000_000 }),
    }).then((value) => { if (!cancelled) setPreview(value); })
      .catch((error: Error) => { if (!cancelled) setPreviewError(error.message); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId, artifactUri, previewReloadKey]);

  const contentUnits = units.filter((record) => isFileContentStructureUnit(record, artifactUri));
  const visible = contentUnits.filter((record) => !scopeFilter || scopeIdsForRecord(record, contexts).includes(scopeFilter));
  const visibleIds = new Set(visible.map((record) => revisionKey(revisionRefOf(record))));
  const visibleRelations = relations.filter((relation) => visibleIds.has(revisionKey(relation.from as RevisionRefView)) && visibleIds.has(revisionKey(relation.to as RevisionRefView)));
  const model = buildStructureGraph(visible, visibleRelations, contexts);
  const selectedNodeId = revisionKey(revisionRefOf(selectedNode));
  const selectNode = (record: JsonObject | undefined) => {
    setSelectedNode(record);
  };

  return <div className="graph-product"><div className="graph-toolbar"><label>标准化文件<select value={selectedFile} onChange={(event) => setSelectedFile(event.target.value)}>{files.map((file) => <option value={file.id} key={file.id}>{file.sourceId} / {file.path}</option>)}</select></label><label>Scope 过滤<select value={scopeFilter} onChange={(event) => { setScopeFilter(event.target.value); setSelectedNode(undefined); }}><option value="">全部 Scope</option>{scopes.map((scope) => <option key={scopeId(scope)} value={scopeId(scope)}>{String(scope.label ?? scopeId(scope))}</option>)}</select></label><span>{loading ? "加载 Graph…" : `${visible.length}/${contentUnits.length} 个内容节点 · ${visibleRelations.length} 个关系`}</span></div><GraphWorkspaceLayout
    fileList={groupFiles(files).map(([sourceId, values]) => <div key={sourceId}><b>{sourceId}</b>{values.map((file) => <button className={file.id === selectedFile ? "active" : ""} onClick={() => setSelectedFile(file.id)} key={file.id}>{file.path}</button>)}</div>)}
    canvas={loading ? <ProductEmpty text="正在分页加载该文件的 Structure Graph" /> : model.nodes.length ? <LayerGraph model={model} select={selectNode} selectedId={selectedNodeId} /> : <ProductEmpty text="该文件尚无可定位的内容结构项" />}
    bottom={<StructureSourcePreview
      file={selected}
      preview={preview}
      loading={previewLoading}
      error={previewError}
      selectedNode={selectedNode}
      artifactUri={artifactUri}
      reload={() => setPreviewReloadKey((value) => value + 1)}
    />}
  /></div>;
}

function GraphWorkspaceLayout({ fileList, canvas, detail, bottom }: { fileList: ReactNode; canvas: ReactNode; detail?: ReactNode; bottom?: ReactNode }) {
  const layoutRef = useRef<HTMLDivElement>(null);
  const resizePointer = useRef<number | undefined>(undefined);
  const [fileWidth, setFileWidth] = useState(180);
  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizePointer.current !== event.pointerId || !layoutRef.current) return;
    const bounds = layoutRef.current.getBoundingClientRect();
    setFileWidth(Math.round(Math.max(140, Math.min(440, event.clientX - bounds.left))));
  };
  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizePointer.current !== event.pointerId) return;
    resizePointer.current = undefined;
    if (layoutRef.current?.hasPointerCapture(event.pointerId)) {
      layoutRef.current.releasePointerCapture(event.pointerId);
    }
  };
  const style = { "--graph-files-width": `${fileWidth}px` } as CSSProperties;
  return <div
    className={`graph-layout ${bottom ? "graph-layout-stacked" : ""}`}
    ref={layoutRef}
    style={style}
    onPointerMove={resize}
    onPointerUp={finishResize}
    onPointerCancel={finishResize}
  >
    <aside className="graph-files">{fileList}</aside>
    <div
      className="graph-resizer"
      role="separator"
      aria-label="调整文件列表宽度"
      aria-orientation="vertical"
      aria-valuemin={140}
      aria-valuemax={440}
      aria-valuenow={fileWidth}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") setFileWidth((value) => Math.max(140, value - 12));
        if (event.key === "ArrowRight") setFileWidth((value) => Math.min(440, value + 12));
      }}
      onPointerDown={(event) => {
        resizePointer.current = event.pointerId;
        layoutRef.current?.setPointerCapture(event.pointerId);
      }}
    />
    <div className="graph-main">
      <section className="graph-canvas">{canvas}</section>
      {bottom && <section className="structure-source-pane">{bottom}</section>}
    </div>
    {detail && <aside className="graph-detail">{detail}</aside>}
  </div>;
}

type ContentSegments = { before: string; selected: string; after: string };

export function splitContentByByteRange(content: string, start: number, end: number): ContentSegments | undefined {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) return undefined;
  const encoded = new TextEncoder().encode(content);
  if (start >= encoded.length || end > encoded.length) return undefined;
  const decoder = new TextDecoder();
  return {
    before: decoder.decode(encoded.slice(0, start)),
    selected: decoder.decode(encoded.slice(start, end)),
    after: decoder.decode(encoded.slice(end)),
  };
}

function StructureSourcePreview({
  file,
  preview,
  loading,
  error,
  selectedNode,
  artifactUri,
  reload,
}: {
  file: FileDescriptor | undefined;
  preview: ArtifactPreviewResponse | undefined;
  loading: boolean;
  error: string;
  selectedNode: JsonObject | undefined;
  artifactUri: string;
  reload: () => void;
}) {
  const markRef = useRef<HTMLElement>(null);
  const sourceRef = useRef<HTMLPreElement>(null);
  const locator = selectedNode?.locator as JsonObject | undefined;
  const range = selectedNode && isFileContentStructureUnit(selectedNode, artifactUri)
    ? { start: Number(locator?.start), end: Number(locator?.end) }
    : undefined;
  const segments = preview && range ? splitContentByByteRange(preview.content, range.start, range.end) : undefined;
  const selectedKey = revisionKey(revisionRefOf(selectedNode));

  useEffect(() => {
    if (!segments || !sourceRef.current || !markRef.current) return;
    const top = markRef.current.offsetTop - sourceRef.current.clientHeight / 2 + markRef.current.offsetHeight / 2;
    sourceRef.current.scrollTop = Math.max(0, top);
  }, [selectedKey, preview?.content, Boolean(segments)]);

  return <div className="structure-source-preview">
    <div className="product-heading">
      <div><b>文件原文</b><p>{file?.path ?? "请选择标准化文件"}</p></div>
      <span>{selectedNode ? `${String(selectedNode.kind ?? "结构项")} · 已定位` : "点击上方结构项定位"}</span>
    </div>
    <div className="structure-source-content">
      {loading
        ? <PreviewState title="正在读取文件原文…" />
        : error
          ? <PreviewState title="无法读取文件原文" detail={error} action={<button className="source-action" onClick={reload}>重试</button>} />
          : preview
            ? preview.content
              ? <>{preview.truncated && <div className="structure-source-notice">文件较大，当前展示前 {preview.characters.toLocaleString()} 个字符</div>}<pre ref={sourceRef}>{segments ? <><span>{segments.before}</span><mark ref={markRef}>{segments.selected}</mark><span>{segments.after}</span></> : preview.content}</pre>{selectedNode && !segments && <div className="structure-source-notice warning">节点位于当前预览范围之外，无法定位高亮</div>}</>
              : <PreviewState title="文件内容为空" />
            : <PreviewState title="选择文件查看原文" />}
    </div>
  </div>;
}

export function isFileContentStructureUnit(unit: JsonObject, artifactUri: string): boolean {
  if (!artifactUri || ["document", "file"].includes(String(unit.kind ?? ""))) return false;
  const locator = unit.locator as JsonObject | undefined;
  const artifact = locator?.artifact as JsonObject | undefined;
  const start = Number(locator?.start);
  const end = Number(locator?.end);
  return locator?.type === "byte_range"
    && String(artifact?.uri ?? "") === artifactUri
    && Number.isSafeInteger(start)
    && Number.isSafeInteger(end)
    && start >= 0
    && end > start;
}

export function buildStructureGraph(units: JsonObject[], relations: JsonObject[], contexts: Record<string, ScopeContextView>): GraphModel {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const unitById = new Map(units.map((unit) => [revisionKey(revisionRefOf(unit)), unit]));
  const structuralRelations = relations.filter((relation) => ["contains", "declares"].includes(String(relation.relationType)));
  const incoming = new Set(structuralRelations.map((relation) => revisionKey(relation.to as RevisionRefView)));
  const columns = new Map<string, number>();
  units.forEach((unit) => columns.set(revisionKey(revisionRefOf(unit)), incoming.has(revisionKey(revisionRefOf(unit))) ? 1 : 0));
  for (let pass = 0; pass < 5; pass += 1) {
    structuralRelations.forEach((relation) => {
      const from = revisionKey(relation.from as RevisionRefView); const to = revisionKey(relation.to as RevisionRefView);
      columns.set(to, Math.min(5, Math.max(columns.get(to) ?? 0, (columns.get(from) ?? 0) + 1)));
    });
  }
  units.forEach((unit) => { const id = revisionKey(revisionRefOf(unit)); nodes.push(graphNode(id, unit, columns.get(id) ?? 0, contexts, "Structure")); });
  relations.forEach((relation) => { const from = revisionKey(relation.from as RevisionRefView); const to = revisionKey(relation.to as RevisionRefView); if (unitById.has(from) && unitById.has(to)) edges.push({ from, to, label: String(relation.relationType ?? "relates") }); });
  return { nodes, edges };
}

export function buildGraphModel(stage: ProductStage, file: FileDescriptor | undefined, records: JsonObject[], data: Record<string, JsonObject[]>, contexts: Record<string, ScopeContextView>): GraphModel {
  if (!file) return { nodes: [], edges: [] };
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const add = (node: GraphNode) => { if (!nodes.some((value) => value.id === node.id)) nodes.push(node); };
  if (stage === "structure") {
    add({ id: file.id, label: file.path, meta: "Normalized file", column: 0, record: file.normalized, scopeIds: scopeIdsForRecord(file.normalized, contexts) });
    records.forEach((record) => { const id = revisionKey(revisionRefOf(record)); add(graphNode(id, record, 1, contexts)); edges.push({ from: file.id, to: id, label: "splits_to" }); });
  } else if (stage === "evidence") {
    const structures = new Map((data.structures ?? []).map((record) => [revisionKey(revisionRefOf(record)), record]));
    records.forEach((record) => { const currentId = revisionKey(revisionRefOf(record)); add(graphNode(currentId, record, 1, contexts)); for (const reference of (record.structureRefs as RevisionRefView[] | undefined) ?? []) { const id = revisionKey(reference); const upstream = structures.get(id); add(graphNode(id, upstream ?? { revisionRef: reference, label: reference.entity.id }, 0, contexts, "Structure")); edges.push({ from: id, to: currentId, label: "evidence_from" }); } });
  } else if (stage === "fact") {
    const evidence = new Map((data.evidence ?? []).map((record) => [revisionKey(revisionRefOf(record)), record]));
    records.forEach((record) => { const currentId = revisionKey(revisionRefOf(record)); add(graphNode(currentId, record, 1, contexts)); for (const link of (record.evidence as JsonObject[] | undefined) ?? []) { const reference = link.evidenceRef as RevisionRefView; const id = revisionKey(reference); add(graphNode(id, evidence.get(id) ?? { revisionRef: reference, excerpt: reference.entity.id }, 0, contexts, "Evidence")); edges.push({ from: id, to: currentId, label: String(link.role ?? "supports") }); } });
  } else if (stage === "semantic") {
    const facts = new Map((data.facts ?? []).map((record) => [entityKey((record.revisionRef as JsonObject).entity), record]));
    records.forEach((edge) => { const from = entityKey(edge.fromFact); const to = entityKey(edge.toFact); add(graphNode(`from:${from}`, facts.get(from) ?? { entityRef: edge.fromFact, statement: from }, 0, contexts, "Fact")); add(graphNode(`to:${to}`, facts.get(to) ?? { entityRef: edge.toFact, statement: to }, 1, contexts, "Fact")); edges.push({ from: `from:${from}`, to: `to:${to}`, label: String(edge.relation ?? "relates") }); });
  }
  return { nodes, edges };
}

type GraphPoint = { x: number; y: number };
type GraphDrag = { mode: "pan" | "node"; pointerId: number; nodeId?: string; clientX: number; clientY: number };

const graphNodeRadius = 46;

function layeredGraphLayout(nodes: GraphNode[]) {
  const positions = new Map<string, GraphPoint>();
  if (!nodes.length) return { positions, width: 760, height: 570 };
  const grouped = new Map<number, GraphNode[]>();
  nodes.forEach((node) => grouped.set(node.column, [...(grouped.get(node.column) ?? []), node]));
  const columns = [...grouped.entries()].sort(([left], [right]) => left - right);
  const horizontalGap = 172;
  const verticalGap = 122;
  const maximumRows = Math.max(...columns.map(([, values]) => values.length));
  const width = Math.max(760, (columns.length - 1) * horizontalGap + 220);
  const height = Math.max(570, (maximumRows - 1) * verticalGap + 170);
  const left = (width - (columns.length - 1) * horizontalGap) / 2;
  columns.forEach(([, values], columnIndex) => {
    const columnHeight = (values.length - 1) * verticalGap;
    const top = (height - columnHeight) / 2;
    values.forEach((node, rowIndex) => {
      positions.set(node.id, { x: left + columnIndex * horizontalGap, y: top + rowIndex * verticalGap });
    });
  });
  return { positions, width, height };
}

function graphEdgePoints(from: GraphPoint, to: GraphPoint) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / distance;
  const uy = dy / distance;
  return {
    x1: from.x + ux * graphNodeRadius,
    y1: from.y + uy * graphNodeRadius,
    x2: to.x - ux * (graphNodeRadius + 4),
    y2: to.y - uy * (graphNodeRadius + 4),
  };
}

function graphLabelLines(label: string) {
  const compact = label.trim();
  if (compact.length <= 14) return [compact];
  return [compact.slice(0, 13), `${compact.slice(13, 25)}${compact.length > 25 ? "…" : ""}`];
}

function LayerGraph({ model, select, selectedId = "" }: { model: GraphModel; select: (record: JsonObject | undefined) => void; selectedId?: string }) {
  const nodeSignature = model.nodes.map((node) => `${node.id}:${node.column}`).join("|");
  const layout = useMemo(() => layeredGraphLayout(model.nodes), [nodeSignature]);
  const [positions, setPositions] = useState(layout.positions);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<GraphPoint>({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<GraphDrag | undefined>(undefined);
  const moved = useRef(false);

  useEffect(() => {
    setPositions(layout.positions);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [nodeSignature, layout]);

  if (!model.nodes.length) return <ProductEmpty text="该文件尚无本层 Graph 节点" />;

  const startDrag = (event: ReactPointerEvent<SVGElement>, mode: GraphDrag["mode"], nodeId?: string) => {
    event.preventDefault();
    event.stopPropagation();
    moved.current = false;
    drag.current = { mode, nodeId, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    svgRef.current?.setPointerCapture(event.pointerId);
    if (mode === "pan") setPanning(true);
  };
  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - active.clientX) * (layout.width / Math.max(1, bounds.width));
    const dy = (event.clientY - active.clientY) * (layout.height / Math.max(1, bounds.height));
    if (Math.abs(dx) + Math.abs(dy) > 1) moved.current = true;
    if (active.mode === "pan") {
      setPan((value) => ({ x: value.x + dx, y: value.y + dy }));
    } else if (active.nodeId) {
      setPositions((current) => {
        const point = current.get(active.nodeId!);
        if (!point) return current;
        const next = new Map(current);
        next.set(active.nodeId!, { x: point.x + dx / zoom, y: point.y + dy / zoom });
        return next;
      });
    }
    drag.current = { ...active, clientX: event.clientX, clientY: event.clientY };
  };
  const stopDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = undefined;
    setPanning(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const wheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = {
      x: (event.clientX - bounds.left) * (layout.width / Math.max(1, bounds.width)),
      y: (event.clientY - bounds.top) * (layout.height / Math.max(1, bounds.height)),
    };
    const nextZoom = Math.max(.35, Math.min(2.8, zoom * Math.exp(-event.deltaY * .0014)));
    const world = { x: (point.x - pan.x) / zoom, y: (point.y - pan.y) / zoom };
    setPan({ x: point.x - world.x * nextZoom, y: point.y - world.y * nextZoom });
    setZoom(nextZoom);
  };
  const changeZoom = (factor: number) => setZoom((value) => Math.max(.35, Math.min(2.8, value * factor)));
  const resetView = () => {
    setPositions(layout.positions);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return <div className="graph-viewport">
    <div className="graph-zoom-controls" aria-label="Graph 缩放">
      <button aria-label="缩小 Graph" onClick={() => changeZoom(.82)}>−</button>
      <span>{Math.round(zoom * 100)}%</span>
      <button aria-label="放大 Graph" onClick={() => changeZoom(1.22)}>+</button>
      <button aria-label="重置 Graph" onClick={resetView}>复位</button>
    </div>
    <svg
      className={`layer-graph ${panning ? "panning" : ""}`}
      ref={svgRef}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label="Layer graph"
      onPointerDown={(event) => startDrag(event, "pan")}
      onPointerMove={moveDrag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onWheel={wheel}
    >
      <defs>
        <radialGradient id="graph-sphere" cx="34%" cy="28%" r="72%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#f3f3f4" />
          <stop offset="100%" stopColor="#dddddf" />
        </radialGradient>
        <filter id="graph-sphere-shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="7" stdDeviation="8" floodColor="#000000" floodOpacity=".11" />
        </filter>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
        {model.edges.map((edge, index) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          const points = graphEdgePoints(from, to);
          return <g className="graph-edge" key={`${edge.from}:${edge.to}:${index}`}>
            <line {...points} markerEnd="url(#arrow)" />
            <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 7}>{truncate(edge.label, 18)}</text>
          </g>;
        })}
        {model.nodes.map((node) => {
          const point = positions.get(node.id) ?? { x: layout.width / 2, y: layout.height / 2 };
          const lines = graphLabelLines(node.label);
          return <g
            className={`graph-node ${selectedId === node.id ? "selected" : ""}`}
            role="button"
            tabIndex={0}
            key={node.id}
            transform={`translate(${point.x} ${point.y})`}
            onPointerDown={(event) => startDrag(event, "node", node.id)}
            onClick={() => {
              if (moved.current) {
                moved.current = false;
                return;
              }
              select(node.record);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") select(node.record);
            }}
          >
            <title>{node.label}</title>
            <circle r={graphNodeRadius} />
            <text className="graph-node-label" textAnchor="middle" y={lines.length === 1 ? -5 : -13}>
              {lines.map((line, index) => <tspan x="0" dy={index === 0 ? 0 : 14} key={`${line}:${index}`}>{line}</tspan>)}
            </text>
            <text className="graph-node-meta" textAnchor="middle" x="0" y={lines.length === 1 ? 20 : 27}>{truncate(`${node.meta}${node.scopeIds.length ? ` · ${node.scopeIds.length} scopes` : ""}`, 18)}</text>
          </g>;
        })}
      </g>
    </svg>
  </div>;
}

export function LayerScopeView(props: { workspaceId: string; stage: ProductStage; fail: (message: string) => void }) {
  return props.stage === "sources" ? <SourceScopeView workspaceId={props.workspaceId} fail={props.fail} /> : <DerivedLayerScopeView {...props} />;
}

function SourceScopeView({ workspaceId, fail }: { workspaceId: string; fail: (message: string) => void }) {
  const [configuredSources, setConfiguredSources] = useState<JsonObject[]>([]);
  const [records, setRecords] = useState<JsonObject[]>([]);
  const [contexts, setContexts] = useState<Record<string, ScopeContextView>>({});
  const [selectedKey, setSelectedKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [dimension, setDimension] = useState("system"); const [label, setLabel] = useState(""); const [scopeKey, setScopeKey] = useState(""); const [propagation, setPropagation] = useState("inherit");
  const reload = useCallback(async () => {
    try {
      const [loaded, sourceRecords] = await Promise.all([api.config(workspaceId), loadAll(workspaceId, "sources")]);
      const definitions = (loaded.config.sources as JsonObject[] | undefined) ?? [];
      setConfiguredSources(definitions); setRecords(sourceRecords); setContexts(await loadScopeContexts(workspaceId, sourceRecords));
      const firstSourceId = String(definitions[0]?.id ?? sourceIdentity(sourceRecords[0]).sourceId ?? "");
      setSelectedKey((current) => current || (firstSourceId ? `source:${firstSourceId}` : revisionKey(revisionRefOf(sourceRecords[0]))));
    } catch (error) { fail((error as Error).message); }
  }, [workspaceId, fail]);
  useEffect(() => { void reload(); }, [reload]);

  const files = describeFiles(records, [], false);
  const groups = new Map(groupFiles(files));
  const sourceIds = [...new Set([...configuredSources.map((source) => String(source.id)), ...groups.keys()])];
  const selectedSourceId = selectedKey.startsWith("source:") ? selectedKey.slice("source:".length) : "";
  const selectedFile = files.find((file) => file.id === selectedKey);
  const targets = selectedSourceId ? groups.get(selectedSourceId) ?? [] : selectedFile ? [selectedFile] : [];
  const selectedContexts = targets.map((file) => contexts[file.id]).filter((value): value is ScopeContextView => Boolean(value));
  const labels = uniqueScopeLabels(selectedContexts);
  const stats = { manual: labels.filter((value) => value.kind === "manual").length, inferred: labels.filter((value) => value.kind === "inferred").length, inherited: labels.filter((value) => value.kind === "inherited").length };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      for (const file of targets) {
        const target = revisionRefOf(file.source);
        if (!target) continue;
        await api.request(`/workspaces/${workspaceId}/scope/assignments`, { method: "POST", body: JSON.stringify({ target, dimension, scopeKey: scopeKey || label, label, propagation }) });
      }
      setLabel(""); setScopeKey(""); setEditing(false); await reload();
    } catch (error) { fail((error as Error).message); }
  };

  return <div className="source-scope-view"><div className="scope-layer-head"><div><b>Scope · 数据源</b><p>选择数据源可批量标记其当前文件，也可以展开目录只标记单个文件。</p></div><div className="scope-counts"><span>人工 {stats.manual}</span><span>自动 {stats.inferred}</span><span>继承 {stats.inherited}</span></div></div><div className="source-scope-layout"><section className="source-scope-tree">{sourceIds.length ? sourceIds.map((sourceId) => { const sourceFiles = groups.get(sourceId) ?? []; const tree = buildFileTree(sourceFiles); return <div className="source-scope-group" key={sourceId}><button className={selectedKey === `source:${sourceId}` ? "active" : ""} onClick={() => { setSelectedKey(`source:${sourceId}`); setEditing(false); }}><span className="scope-tree-mark">⌄</span><div><b>{String(configuredSources.find((source) => String(source.id) === sourceId)?.displayName ?? sourceId)}</b><small>{sourceId} · {sourceFiles.length} 个文件</small></div><ScopeAggregateTags contexts={sourceFiles.map((file) => contexts[file.id])} /></button><div className="source-scope-children">{tree.length ? tree.map((node) => <SourceScopeTreeBranch node={node} contexts={contexts} selectedKey={selectedKey} select={(key) => { setSelectedKey(key); setEditing(false); }} depth={0} key={node.path} />) : <p>运行数据源采集后显示文件</p>}</div></div>; }) : <ProductEmpty text="先配置并运行数据源节点" />}</section><aside className="scope-node-inspector"><div className="product-heading"><div><b>{selectedSourceId ? configuredSources.find((source) => String(source.id) === selectedSourceId)?.displayName as string ?? selectedSourceId : selectedFile?.path ?? "Scope 详情"}</b><p>{selectedSourceId ? `将标签应用到当前 ${targets.length} 个文件` : "当前文件 Scope"}</p></div>{targets.length > 0 && <button className="ghost" onClick={() => setEditing((value) => !value)}>{editing ? "收起" : "打标签"}</button>}</div>{editing && targets.length > 0 && <form className="scope-side-form" onSubmit={save}><label>维度<input list="scope-dimensions" value={dimension} onChange={(event) => setDimension(event.target.value)} required /></label><label>范围名称<input value={label} onChange={(event) => setLabel(event.target.value)} required /></label><label>稳定键<input value={scopeKey} onChange={(event) => setScopeKey(event.target.value)} placeholder="可自动生成" /></label><label>传播<select value={propagation} onChange={(event) => setPropagation(event.target.value)}><option value="inherit">向下继承</option><option value="local_only">仅当前文件</option></select></label><button>{selectedSourceId ? `标记 ${targets.length} 个文件` : "保存 Scope"}</button></form>}{selectedSourceId ? <ScopeAggregateInspector contexts={selectedContexts} /> : <ScopeInspector context={selectedFile ? contexts[selectedFile.id] : undefined} />}</aside></div><datalist id="scope-dimensions"><option value="system" /><option value="service" /><option value="team" /><option value="capability" /><option value="version" /></datalist></div>;
}

function SourceScopeTreeBranch({ node, contexts, selectedKey, select, depth }: { node: FileTreeNode; contexts: Record<string, ScopeContextView>; selectedKey: string; select: (key: string) => void; depth: number }) {
  const [open, setOpen] = useState(false);
  if (node.children.length) return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="source-scope-folder"><summary style={{ paddingLeft: `${10 + depth * 16}px` }}><span>{open ? "⌄" : "›"}</span>{node.name}</summary>{open && <>{node.file && <SourceScopeFile file={node.file} contexts={contexts} selectedKey={selectedKey} select={select} depth={depth + 1} />}{node.children.map((child) => <SourceScopeTreeBranch node={child} contexts={contexts} selectedKey={selectedKey} select={select} depth={depth + 1} key={child.path} />)}</>}</details>;
  return node.file ? <SourceScopeFile file={node.file} contexts={contexts} selectedKey={selectedKey} select={select} depth={depth} /> : null;
}

function SourceScopeFile({ file, contexts, selectedKey, select, depth }: { file: FileDescriptor; contexts: Record<string, ScopeContextView>; selectedKey: string; select: (key: string) => void; depth: number }) {
  return <button className={`source-scope-file ${selectedKey === file.id ? "active" : ""}`} style={{ paddingLeft: `${15 + depth * 16}px` }} onClick={() => select(file.id)}><span>·</span><div><b>{file.path.split("/").pop()}</b><small>{file.path}</small></div><ScopeTags context={contexts[file.id]} /></button>;
}

function ScopeAggregateTags({ contexts }: { contexts: Array<ScopeContextView | undefined> }) {
  const labels = uniqueScopeLabels(contexts.filter((value): value is ScopeContextView => Boolean(value)));
  return <span className="scope-tag-list">{labels.length ? labels.slice(0, 3).map((value) => <i className={value.kind} key={`${value.kind}:${value.id}`}>{value.label}</i>) : <i>无标签</i>}{labels.length > 3 && <i>+{labels.length - 3}</i>}</span>;
}

function ScopeAggregateInspector({ contexts }: { contexts: ScopeContextView[] }) {
  const labels = uniqueScopeLabels(contexts);
  return <div className="scope-inspector-groups"><section><span>数据源文件标签</span>{labels.length ? labels.map((value) => <div className="scope-inspector-row" key={`${value.kind}:${value.id}`}><b>{value.label}</b><small>{value.kind}</small></div>) : <p>当前文件尚无 Scope 标签</p>}</section></div>;
}

function uniqueScopeLabels(contexts: ScopeContextView[]) {
  const labels = contexts.flatMap(scopeLabels);
  return labels.filter((value, index) => labels.findIndex((candidate) => candidate.id === value.id && candidate.kind === value.kind) === index);
}

function DerivedLayerScopeView({ workspaceId, stage, fail }: { workspaceId: string; stage: ProductStage; fail: (message: string) => void }) {
  const definition = scopeCollections[stage];
  const [data, setData] = useState<Record<string, JsonObject[]>>({});
  const [contexts, setContexts] = useState<Record<string, ScopeContextView>>({});
  const [selectedKey, setSelectedKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [dimension, setDimension] = useState("system"); const [label, setLabel] = useState(""); const [scopeKey, setScopeKey] = useState(""); const [propagation, setPropagation] = useState("inherit");
  const reload = useCallback(async () => {
    if (!definition) return;
    try {
      const [sources, normalized, records] = await Promise.all([loadAll(workspaceId, "sources"), loadAll(workspaceId, "normalized-sources"), loadAll(workspaceId, definition.collection)]);
      const next = { sources, normalized, records };
      setData(next);
      const targets = uniqueRecords([...normalized, ...records]);
      setContexts(await loadScopeContexts(workspaceId, targets));
      setSelectedKey((current) => targets.some((record) => revisionKey(revisionRefOf(record)) === current) ? current : revisionKey(revisionRefOf(records[0] ?? normalized[0])));
    } catch (error) { fail((error as Error).message); }
  }, [workspaceId, stage, definition?.collection, fail]);
  useEffect(() => { void reload(); }, [reload]);
  if (!definition) return <ProductEmpty text="该阶段没有 ScopeAssignment 目标" />;
  const files = describeFiles(data.sources ?? [], data.normalized ?? [], true);
  const records = data.records ?? [];
  const selected = uniqueRecords([...(data.normalized ?? []), ...records]).find((record) => revisionKey(revisionRefOf(record)) === selectedKey);
  const selectedContext = contexts[selectedKey];
  const save = async (event: FormEvent) => { event.preventDefault(); const target = revisionRefOf(selected); if (!target) return; try { await api.request(`/workspaces/${workspaceId}/scope/assignments`, { method: "POST", body: JSON.stringify({ target, dimension, scopeKey: scopeKey || label, label, propagation }) }); setLabel(""); setScopeKey(""); setEditing(false); await reload(); } catch (error) { fail((error as Error).message); } };
  const stats = scopeStats(selectedContext);

  return <div className="scope-layer-view"><div className="scope-layer-head"><div><b>Scope · {definition.label}</b><p>标准化文件 → 当前层节点；标签保留直接、候选和继承来源。</p></div><div className="scope-counts"><span>人工 {stats.manual}</span><span>自动 {stats.inferred}</span><span>继承 {stats.inherited}</span></div></div><div className="scope-layer-layout"><section className="scope-file-list">{files.length ? files.map((file) => { const fileContext = contexts[revisionKey(revisionRefOf(file.normalized))]; const children = records.filter((record) => fileIdForRecord(record, files, stage) === file.id); return <div className="scope-file-group" key={file.id}><button className={selectedKey === revisionKey(revisionRefOf(file.normalized)) ? "active" : ""} onClick={() => setSelectedKey(revisionKey(revisionRefOf(file.normalized)))}><span className="scope-tree-mark">—</span><div><b>{file.path}</b><small>{file.sourceId} · 标准化文件</small></div><ScopeTags context={fileContext} /></button><div className="scope-file-children">{children.length ? children.map((record) => { const key = revisionKey(revisionRefOf(record)); return <button className={selectedKey === key ? "active" : ""} key={key} onClick={() => setSelectedKey(key)}><span className="scope-tree-mark">└</span><div><b>{recordLabel(record)}</b><small>{String(record.kind ?? stage)}</small></div><ScopeTags context={contexts[key]} /></button>; }) : <p>该文件尚无 {definition.label} 节点</p>}</div></div>; }) : <ProductEmpty text="运行标准化后显示两级 Scope 列表" />}</section><aside className="scope-node-inspector"><div className="product-heading"><div><b>{selected ? recordLabel(selected) : "Scope 详情"}</b><p>{selectedKey || "选择一个文件或节点"}</p></div>{selected && !definition.readOnly && <button className="ghost" onClick={() => setEditing((value) => !value)}>{editing ? "收起" : "人工设置"}</button>}</div>{editing && selected && <form className="scope-side-form" onSubmit={save}><label>维度<input list="scope-dimensions" value={dimension} onChange={(event) => setDimension(event.target.value)} required /></label><label>范围名称<input value={label} onChange={(event) => setLabel(event.target.value)} required /></label><label>稳定键<input value={scopeKey} onChange={(event) => setScopeKey(event.target.value)} placeholder="可自动生成" /></label><label>传播<select value={propagation} onChange={(event) => setPropagation(event.target.value)}><option value="inherit">向下继承</option><option value="local_only">仅当前对象</option></select></label><button>保存 Scope</button></form>}<ScopeInspector context={selectedContext} /></aside></div><datalist id="scope-dimensions"><option value="system" /><option value="service" /><option value="team" /><option value="capability" /><option value="version" /></datalist></div>;
}

function ScopeTags({ context }: { context?: ScopeContextView }) {
  const labels = scopeLabels(context);
  return <span className="scope-tag-list">{labels.length ? labels.slice(0, 4).map((value) => <i className={value.kind} key={`${value.kind}:${value.id}`}>{value.label}</i>) : <i>无标签</i>}{labels.length > 4 && <i>+{labels.length - 4}</i>}</span>;
}

function ScopeInspector({ context }: { context?: ScopeContextView }) {
  if (!context) return <ProductEmpty text="选择节点查看 Scope 来源" />;
  const scopeById = new Map(context.scopes.map((scope) => [scopeId(scope), String(scope.label ?? scopeId(scope))]));
  const manual = context.directAssignments.filter(isManualAssignment);
  const inferred = context.directAssignments.filter((assignment) => !isManualAssignment(assignment));
  const inherited = context.effective.values.filter((value) => revisionKey(value.assignedAt as RevisionRefView) !== revisionKey(context.target));
  const render = (items: JsonObject[], kind: "assignment" | "effective") => items.length ? items.map((item, index) => { const reference = item.scopeRef as JsonObject; const id = String(reference.id); const assignedAt = item.assignedAt as RevisionRefView | undefined; return <div className="scope-inspector-row" key={`${id}:${index}`}><b>{scopeById.get(id) ?? id}</b><small>{kind === "effective" ? `继承自 ${assignedAt?.entity.layer ?? "upstream"}` : `${String(item.reviewStatus)} · ${String(item.propagation)}`}</small></div>; }) : <p>暂无</p>;
  return <div className="scope-inspector-groups"><section><span>人工设置</span>{render(manual, "assignment")}</section><section><span>自动推断</span>{render(inferred, "assignment")}</section><section><span>继承 EffectiveScope</span>{render(inherited, "effective")}</section>{context.effective.conflicts.length > 0 && <section><span>冲突</span>{context.effective.conflicts.map((conflict, index) => <p key={index}>{String(conflict.dimension)}</p>)}</section>}</div>;
}

async function loadAll(workspaceId: string, collection: string): Promise<JsonObject[]> {
  const items: JsonObject[] = [];
  let cursor = "";
  do {
    const page = await api.request<Page>(`/workspaces/${workspaceId}/layers/${collection}?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    items.push(...page.items); cursor = page.nextCursor ?? "";
  } while (cursor);
  return items;
}

async function loadEndpointAll(workspaceId: string, endpoint: string): Promise<JsonObject[]> {
  const items: JsonObject[] = [];
  let cursor = "";
  do {
    const query = new URLSearchParams({ limit: "200" });
    if (cursor) query.set("cursor", cursor);
    const page = await api.request<Page>(`/workspaces/${workspaceId}/${endpoint}?${query}`);
    items.push(...page.items);
    cursor = page.nextCursor ?? "";
  } while (cursor);
  return items;
}

async function loadScopeContexts(workspaceId: string, records: JsonObject[]) {
  const entries = await Promise.all(uniqueRecords(records).map(async (record) => { const target = revisionRefOf(record); if (!target) return undefined; const query = new URLSearchParams({ layer: target.entity.layer, entityId: target.entity.id, revision: target.revision }); try { return [revisionKey(target), await api.request<ScopeContextView>(`/workspaces/${workspaceId}/scope/context?${query}`)] as const; } catch { return undefined; } }));
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, ScopeContextView] => Boolean(entry)));
}

function describeFiles(sources: JsonObject[], normalized: JsonObject[], useNormalized: boolean): FileDescriptor[] {
  const sourceBySnapshot = new Map(sources.map((source) => [revisionKey(source.currentSnapshot as RevisionRefView), source]));
  if (useNormalized) return normalized.map((record) => { const source = sourceBySnapshot.get(revisionKey(record.sourceSnapshot as RevisionRefView)); const identity = sourceIdentity(source); return { id: revisionKey(revisionRefOf(record)), sourceId: identity.sourceId, path: identity.path, title: String(source?.title ?? identity.path), source, normalized: record }; });
  return sources.map((source) => { const identity = sourceIdentity(source); return { id: revisionKey(source.currentSnapshot as RevisionRefView), sourceId: identity.sourceId, path: identity.path, title: String(source.title ?? identity.path), source }; });
}

function sourceIdentity(source?: JsonObject) {
  const id = String(((source?.entityRef as JsonObject | undefined)?.id) ?? "source:unknown:unknown");
  const match = /^source:([^:]+):(.*)$/.exec(id);
  return { sourceId: match?.[1] ?? "workspace", path: match?.[2] ?? String(source?.uri ?? id) };
}

function groupFiles(files: FileDescriptor[]): Array<[string, FileDescriptor[]]> {
  const grouped = new Map<string, FileDescriptor[]>();
  files.forEach((file) => grouped.set(file.sourceId, [...(grouped.get(file.sourceId) ?? []), file]));
  return [...grouped.entries()].map(([id, values]) => [id, values.sort((a, b) => a.path.localeCompare(b.path))]);
}

function fileIdForRecord(record: JsonObject, files: FileDescriptor[], stage: ProductStage) {
  if (stage === "normalize" || stage === "project") return revisionKey(revisionRefOf(record));
  const direct = record.normalizedSource as RevisionRefView | undefined;
  if (direct) return revisionKey(direct);
  const sourceSnapshot = (record.trace as JsonObject | undefined)?.sourceSnapshot as RevisionRefView | undefined;
  return files.find((file) => revisionKey(file.normalized?.sourceSnapshot as RevisionRefView | undefined) === revisionKey(sourceSnapshot))?.id ?? "";
}

function graphNode(id: string, record: JsonObject, column: number, contexts: Record<string, ScopeContextView>, fallback = "Node"): GraphNode {
  return { id, label: recordLabel(record), meta: String(record.kind ?? fallback), column, record, scopeIds: scopeIdsForRecord(record, contexts) };
}

function factsForSemantic(edges: JsonObject[], facts: JsonObject[]) {
  const ids = new Set(edges.flatMap((edge) => [entityKey(edge.fromFact), entityKey(edge.toFact)]));
  return facts.filter((fact) => ids.has(entityKey((fact.revisionRef as JsonObject).entity)));
}

function recordScopeIds(record: JsonObject, stage: ProductStage, contexts: Record<string, ScopeContextView>, facts: JsonObject[]) {
  if (stage !== "semantic") return scopeIdsForRecord(record, contexts);
  const ids = [entityKey(record.fromFact), entityKey(record.toFact)];
  return [...new Set(facts.filter((fact) => ids.includes(entityKey((fact.revisionRef as JsonObject).entity))).flatMap((fact) => scopeIdsForRecord(fact, contexts)))];
}

function scopeIdsForRecord(record: JsonObject | undefined, contexts: Record<string, ScopeContextView>) {
  const context = contexts[revisionKey(revisionRefOf(record))];
  if (!context) return [];
  return [...new Set([...context.directAssignments.map((item) => String((item.scopeRef as JsonObject).id)), ...context.effective.values.map((item) => String((item.scopeRef as JsonObject).id))])];
}

function scopeLabels(context?: ScopeContextView) {
  if (!context) return [];
  const scopeById = new Map(context.scopes.map((scope) => [scopeId(scope), String(scope.label ?? scopeId(scope))]));
  const values: Array<{ id: string; label: string; kind: string }> = [];
  context.directAssignments.forEach((assignment) => { const id = String((assignment.scopeRef as JsonObject).id); values.push({ id, label: scopeById.get(id) ?? id, kind: isManualAssignment(assignment) ? "manual" : "inferred" }); });
  context.effective.values.filter((value) => revisionKey(value.assignedAt as RevisionRefView) !== revisionKey(context.target)).forEach((value) => { const id = String((value.scopeRef as JsonObject).id); if (!values.some((item) => item.id === id)) values.push({ id, label: scopeById.get(id) ?? id, kind: "inherited" }); });
  return values;
}

function scopeStats(context?: ScopeContextView) { const labels = scopeLabels(context); return { manual: labels.filter((value) => value.kind === "manual").length, inferred: labels.filter((value) => value.kind === "inferred").length, inherited: labels.filter((value) => value.kind === "inherited").length }; }
function isManualAssignment(assignment: JsonObject) { return String((((assignment.trace as JsonObject | undefined)?.producer as JsonObject | undefined)?.name) ?? "") === "context-admin-manual"; }
function scopeId(scope: JsonObject) { return String((scope.scopeRef as JsonObject).id); }
function revisionRefOf(record?: JsonObject): RevisionRefView | undefined { return (record?.revisionRef ?? record?.currentSnapshot) as RevisionRefView | undefined; }
function revisionKey(reference?: RevisionRefView) { return reference ? `${reference.entity.layer}:${reference.entity.id}@${reference.revision}` : ""; }
function entityKey(value: unknown) { const entity = value as JsonObject | undefined; return entity ? `${String(entity.layer)}:${String(entity.id)}` : ""; }
function recordLabel(item: JsonObject) { const ref = (item.revisionRef ?? item.entityRef) as JsonObject | undefined; return String(item.title ?? item.label ?? item.statement ?? item.excerpt ?? item.stableKey ?? item.id ?? (ref?.entity as JsonObject | undefined)?.id ?? ref?.id ?? "record"); }
function uniqueRecords(records: JsonObject[]) { const seen = new Set<string>(); return records.filter((record) => { const key = revisionKey(revisionRefOf(record)); return Boolean(key) && !seen.has(key) && Boolean(seen.add(key)); }); }
function truncate(value: string, length: number) { return value.length > length ? `${value.slice(0, length - 1)}…` : value; }
function ProductEmpty({ text }: { text: string }) { return <div className="product-empty"><span>◇</span><p>{text}</p></div>; }
