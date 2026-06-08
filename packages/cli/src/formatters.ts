import {
  type AdapterRuntimeStatus,
  type ContextBuildUnitView,
  type ContextCorrectionActionResult,
  type ContextCorrectionOperationEffect,
  type ContextCorrectionPreview,
  type ContextCorrectionProposal,
  type ContextEdge,
  type ContextNode,
  type ContextPackageCorrectionInbox,
  type ContextPackageCorrectionSummary,
  type ContextPackageExpansion,
  type ContextPackageList,
  type ContextPackageSearch,
  type ContextPackageView,
  type ContextRuntimeHealth,
  type ContextSourceGroupRecord,
  type Diagnostic,
  type GraphExpansion,
  type GraphFactExplanation,
  type GraphFactHistory,
  type GraphScopeView,
  type LayeredSourceTrace
} from '@context-compiler/core'

export interface AdapterRuntimeFormatEntry {
  kind: string
  id: string
  title: string
  status: AdapterRuntimeStatus
}

/** Format query results for terminal output. */
export function formatNodes(nodes: ContextNode[]): string {
  if (nodes.length === 0) {
    return 'No matching context nodes found.\n'
  }
  return nodes.map((node) => `${node.id}\t${node.type}\t${node.name}`).join('\n') + '\n'
}

/** Format L0 package inventory for `context package list`. */
export function formatContextPackageList(list: ContextPackageList): string {
  if (list.packages.length === 0) {
    return 'No context packages found.\n'
  }
  const lines = ['Packages:']
  for (const item of list.packages) {
    const adapters = item.adapterSelections.map((adapter) => adapter.adapterId).join(', ') || 'none'
    const corrections = item.corrections.proposalCounts.total || item.corrections.counts.findings + item.corrections.counts.proposedPatches + item.corrections.counts.rehomeProposals
    lines.push(`- ${item.package.id}\t${item.package.kind}\t${item.package.path}\tgroups=${item.sourceGroups.length}\tbuildUnits=${item.buildUnits.length}\tcorrections=${corrections}\tadapters=${adapters}`)
  }
  appendDiagnostics(lines, list.diagnostics)
  lines.push('')
  return lines.join('\n')
}

/** Format one L0 package view for `context package show`. */
export function formatContextPackageView(view: ContextPackageView): string {
  const lines = [
    view.package.title,
    `Package: ${view.package.id}`,
    `Kind: ${view.package.kind}`,
    `Path: ${view.package.path}`,
    view.scope ? `Scope: ${view.scope.id}` : undefined,
    `Source groups: ${view.sourceGroups.length}`,
    `Build units: ${view.buildUnits.length}`,
    `Files: ${view.stats.files}`,
    `Nodes: ${view.stats.nodes}`,
    `Edges: ${view.stats.edges}`,
    `Diagnostics: ${view.stats.diagnostics}`,
    ''
  ].filter((line): line is string => typeof line === 'string')

  appendPackageSourceGroups(lines, view.sourceGroups)
  appendPackageBuildUnits(lines, view.buildUnits)
  appendPackageCorrections(lines, view.corrections)
  appendNextActions(lines, view.nextActions)
  appendDiagnostics(lines, view.diagnostics)
  lines.push('')
  return lines.join('\n')
}

/** Format package expansion for `context package expand`. */
export function formatContextPackageExpansion(expansion: ContextPackageExpansion): string {
  const lines = [
    expansion.package.title,
    `Package: ${expansion.package.id}`,
    `Mode: ${expansion.mode}`,
    expansion.scope ? `Scope: ${expansion.scope.id}` : undefined,
    `Source groups: ${expansion.sourceGroups.length}`,
    `Child scopes: ${expansion.childScopes.length}`,
    `Files: ${expansion.files.length}`,
    `Facts: ${expansion.facts.length}`,
    `Edges: ${expansion.edges.length}`,
    ''
  ].filter((line): line is string => typeof line === 'string')

  appendPackageSourceGroups(lines, expansion.sourceGroups)
  if (expansion.files.length > 0) {
    lines.push('', 'Files:')
    for (const file of expansion.files) {
      lines.push(`- ${file.properties.path ?? file.name}`)
    }
  }
  if (expansion.facts.length > 0) {
    lines.push('', 'Facts:')
    for (const node of expansion.facts) {
      lines.push(`- ${formatNodeBrief(node)}`)
    }
  }
  if (expansion.edges.length > 0) {
    lines.push('', 'Edges:')
    for (const edge of expansion.edges) {
      lines.push(`- ${formatEdgeBrief(edge)}`)
    }
  }
  appendPackageBuildUnits(lines, expansion.buildUnits)
  appendPackageCorrections(lines, expansion.corrections)
  appendNextActions(lines, expansion.nextActions)
  appendDiagnostics(lines, expansion.diagnostics)
  lines.push('')
  return lines.join('\n')
}

/** Format package-scoped search results for `context package search`. */
export function formatContextPackageSearch(search: ContextPackageSearch): string {
  const lines = [
    `Package search: ${search.query}`,
    search.package ? `Package: ${search.package.id}` : 'Package: all',
    `Engine: ${search.engine}`,
    `Index: ${search.indexPath}`,
    `Results: ${search.results.length}`,
    ''
  ]
  if (search.results.length > 0) {
    lines.push('Results:')
    for (const node of search.results) {
      lines.push(`- ${formatNodeBrief(node)}`)
    }
  } else {
    lines.push('No matching context nodes found.')
  }
  appendDiagnostics(lines, search.diagnostics)
  lines.push('')
  return lines.join('\n')
}

/** Format a package-first correction inbox. */
export function formatContextPackageCorrectionInbox(inbox: ContextPackageCorrectionInbox): string {
  const lines = [
    `Correction inbox: ${inbox.package?.id ?? 'all packages'}`,
    `Package: ${inbox.package?.path ?? 'all'}`,
    `Total: ${inbox.counts.total}`,
    `Proposed: ${inbox.counts.proposed}`,
    `Approved: ${inbox.counts.approved}`,
    `Rejected: ${inbox.counts.rejected}`,
    `Applied: ${inbox.counts.applied}`,
    `Blocked: ${inbox.counts.blocked}`,
    `Conflicted: ${inbox.counts.conflicted}`,
    `Conflicts: ${inbox.counts.conflicted}`,
    `Risk: ${formatRecordCounts(inbox.counts.byRiskLevel) || 'none'}`,
    inbox.nextRecommendedProposalId ? `Next: ${inbox.nextRecommendedProposalId}` : undefined,
    inbox.nextRecommendedProposalId ? `Recommended: context package correction show ${inbox.nextRecommendedProposalId}` : undefined,
    ''
  ].filter((line): line is string => typeof line === 'string')
  if (inbox.proposals.length > 0) {
    lines.push('Proposals:')
    for (const proposal of inbox.proposals) {
      lines.push(`- ${formatCorrectionProposalBrief(proposal)}`)
      lines.push(`  command=context package correction show ${proposal.id}`)
    }
  } else {
    lines.push('No correction proposals found.')
  }
  appendDiagnostics(lines, inbox.diagnostics)
  lines.push('')
  return lines.join('\n')
}

/** Format one correction proposal for terminal output. */
export function formatContextCorrectionProposal(proposal: ContextCorrectionProposal): string {
  const lines = [
    proposal.title,
    `Proposal: ${proposal.id}`,
    `Kind: ${proposal.kind}`,
    `Status: ${proposal.status}`,
    `Blocked: ${proposal.blocked ? 'true' : 'false'}`,
    `Confidence: ${proposal.confidence}`,
    `Risk: ${proposal.impact.riskLevel}`,
    `Dedupe key: ${proposal.dedupeKey}`,
    proposal.packageId ? `Package: ${proposal.packageId}${proposal.packagePath ? ` (${proposal.packagePath})` : ''}` : undefined,
    `Source groups: ${proposal.sourceGroupIds.join(', ') || 'none'}`,
    `Affected nodes: ${proposal.affectedNodeIds.join(', ') || 'none'}`,
    `Source paths: ${proposal.sourcePaths.join(', ') || 'none'}`,
    `Graph patches: ${proposal.graphPatchIds.join(', ') || 'none'}`,
    `Rehome proposals: ${proposal.rehomeProposalIds.join(', ') || 'none'}`,
    `Supersedes: ${proposal.supersedesProposalIds.join(', ') || 'none'}`,
    proposal.statusReason ? `Reason: ${proposal.statusReason}` : undefined,
    ''
  ].filter((line): line is string => typeof line === 'string')
  lines.push(proposal.summary)
  lines.push('', 'Impact:')
  lines.push(`- operations=${proposal.impact.operationCount} creates=${proposal.impact.creates} updates=${proposal.impact.updates} deprecates=${proposal.impact.deprecates} reparents=${proposal.impact.reparents} relabels=${proposal.impact.relabels} rehomes=${proposal.impact.rehomes}`)
  lines.push(`- nodes=${proposal.impact.affectedNodeIds.join(', ') || 'none'}`)
  lines.push(`- edges=${proposal.impact.affectedEdgeIds.join(', ') || 'none'}`)
  lines.push(`- paths=${proposal.impact.sourcePaths.join(', ') || 'none'}`)
  if (proposal.operationPlan) {
    lines.push('', 'Operation plan:')
    lines.push(`- effects=${proposal.operationPlan.effects.length} source=${proposal.operationPlan.sourceEffects.length} graph=${proposal.operationPlan.graphEffects.length} persistent=${proposal.operationPlan.persistent ? 'true' : 'false'} unsupportedSourcePersistence=${proposal.operationPlan.unsupportedSourcePersistence ? 'true' : 'false'}`)
  }
  lines.push('', 'Conflicts:')
  if (proposal.conflicts.length > 0) {
    for (const conflict of proposal.conflicts) {
      lines.push(`- [${conflict.severity}] ${conflict.type}: ${conflict.message}`)
    }
  } else {
    lines.push('- none')
  }
  if (proposal.evidence.length > 0) {
    lines.push('', 'Evidence:')
    for (const evidence of proposal.evidence.slice(0, 5)) {
      lines.push(`- ${evidence.type}: ${evidence.description}`)
    }
  }
  lines.push('', `Preview: context package correction preview ${proposal.id}`)
  lines.push('', `Approve: context package correction approve ${proposal.id}`)
  lines.push(`Reject: context package correction reject ${proposal.id}`)
  lines.push(`Apply dry-run: context package correction apply ${proposal.id} --dry-run`)
  lines.push('')
  return lines.join('\n')
}

/** Format one correction preview for terminal output. */
export function formatContextCorrectionPreview(preview: ContextCorrectionPreview): string {
  const plan = preview.operationPlan
  const lines = [
    `Correction preview: ${preview.proposal.id}`,
    `Kind: ${plan.kind}`,
    `Persistent: ${plan.persistent ? 'true' : 'false'}`,
    `Requires source persistence: ${plan.requiresSourcePersistence ? 'true' : 'false'}`,
    `Unsupported source persistence: ${plan.unsupportedSourcePersistence ? 'true' : 'false'}`,
    `Graph patches: ${plan.graphPatchIds.join(', ') || 'none'}`,
    preview.revisionSummary?.baseRevisionId ? `Base revision: ${preview.revisionSummary.baseRevisionId}` : undefined,
    preview.revisionSummary?.newRevisionId ? `New revision: ${preview.revisionSummary.newRevisionId}` : undefined,
    `Source decisions: ${preview.revisionSummary?.sourceDecisionIds.join(', ') || 'none'}`,
    ''
  ].filter((line): line is string => typeof line === 'string')
  appendEffects(lines, 'Source effects:', plan.sourceEffects)
  appendEffects(lines, 'Graph effects:', plan.graphEffects)
  appendDiagnostics(lines, [...preview.diagnostics, ...plan.diagnostics])
  lines.push('')
  return lines.join('\n')
}

/** Format approve/reject/apply action results for terminal output. */
export function formatContextCorrectionActionResult(result: ContextCorrectionActionResult): string {
  const lines = [
    `Action: ${result.action}`,
    `Dry run: ${result.dryRun ? 'true' : 'false'}`,
    `Submitted: ${result.submitted ? 'true' : 'false'}`,
    `Written: ${result.written ? 'true' : 'false'}`,
    `Proposal: ${result.proposal.id}`,
    `Status: ${result.proposal.status}`,
    `Blocked: ${result.proposal.blocked ? 'true' : 'false'}`,
    `Risk: ${result.proposal.impact.riskLevel}`,
    result.graphPatch ? `Graph patch: ${result.graphPatch.id}` : undefined,
    result.proposal.appliedRevisionId ? `Applied revision: ${result.proposal.appliedRevisionId}` : undefined,
    result.revisionSummary?.newRevisionId ? `Revision summary: ${result.revisionSummary.newRevisionId}` : undefined,
    result.operationPlan ? `Operation plan: ${result.operationPlan.id}` : undefined,
    result.path ? `Path: ${result.path}` : undefined,
    `Conflicts: ${result.proposal.conflicts.length}`,
    `Diagnostics: ${result.diagnostics.length}`,
    ''
  ].filter((line): line is string => typeof line === 'string')
  if (result.proposal.conflicts.length > 0) {
    lines.push('Conflicts:')
    for (const conflict of result.proposal.conflicts) {
      lines.push(`- [${conflict.severity}] ${conflict.type}: ${conflict.message}`)
    }
    lines.push('')
  }
  appendDiagnostics(lines, result.diagnostics)
  return lines.join('\n')
}

function appendEffects(lines: string[], heading: string, effects: ContextCorrectionOperationEffect[]): void {
  lines.push(heading)
  if (effects.length === 0) {
    lines.push('- none', '')
    return
  }
  for (const effect of effects) {
    lines.push(`- ${effect.kind} ${effect.targetId ?? effect.path ?? effect.targetKind} operation=${effect.operation} persistent=${effect.persistent ? 'true' : 'false'}`)
    if (effect.before) {
      lines.push(`  before=${JSON.stringify(effect.before)}`)
    }
    if (effect.after) {
      lines.push(`  after=${JSON.stringify(effect.after)}`)
    }
  }
  lines.push('')
}

/** Format diagnostics for terminal output. */
export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return 'No diagnostics.\n'
  }
  return diagnostics.map((diagnostic) => `[${diagnostic.severity}] ${diagnostic.type}: ${diagnostic.message}`).join('\n') + '\n'
}

/** Format adapter runtime status for `context adapters list`. */
export function formatAdapterRuntimeList(entries: AdapterRuntimeFormatEntry[]): string {
  if (entries.length === 0) {
    return 'No registered adapters.\n'
  }
  return [
    'Adapter runtimes:',
    ...entries.map((entry) =>
      `- ${entry.id}\t${entry.kind}\t${entry.status.mode}\t${entry.status.state}\t${entry.status.packageName ?? ''}${entry.status.runtimeDir ? `\t${entry.status.runtimeDir}` : ''}`
    ),
    ''
  ].join('\n')
}

/** Format adapter runtime install result for `context adapters install`. */
export function formatAdapterRuntimeInstall(entries: AdapterRuntimeFormatEntry[]): string {
  return [
    'Adapter runtime install:',
    ...entries.map((entry) =>
      `- ${entry.id}\t${entry.status.mode}\t${entry.status.state}${entry.status.runtimeDir ? `\t${entry.status.runtimeDir}` : ''}`
    ),
    ''
  ].join('\n')
}

/** Format one provenance-backed graph fact explanation. */
export function formatGraphFactExplanation(explanation: GraphFactExplanation): string {
  const fact = explanation.node ?? explanation.edge
  const title = explanation.node ? `${explanation.node.id}: ${explanation.node.name}` : `${explanation.edge?.id}: ${explanation.edge?.from} -[${explanation.edge?.type}]-> ${explanation.edge?.to}`
  const lines = [
    title,
    `Kind: ${explanation.factKind}`,
    `Type: ${explanation.node?.type ?? explanation.edge?.type ?? 'unknown'}`,
    `Source refs: ${explanation.sourceRefs.length}`,
    `Provenance entries: ${explanation.provenance.length}`,
    ''
  ]
  for (const provenance of explanation.provenance) {
    lines.push(`- ${provenance.operation ?? 'unknown'} revision=${provenance.revisionId}${provenance.patchId ? ` patch=${provenance.patchId}` : ''}`)
    if (provenance.evidenceReportIds.length > 0) {
      lines.push(`  evidenceReports=${provenance.evidenceReportIds.join(', ')}`)
    }
    if (provenance.findingTypes.length > 0) {
      lines.push(`  findings=${provenance.findingTypes.join(', ')}`)
    }
  }
  if (explanation.sourceRefs.length > 0 || explanation.omitted.sourceRefs > 0) {
    lines.push('', 'Sources:')
    for (const sourceRef of explanation.sourceRefs) {
      lines.push(`- ${sourceRef.uri}`)
    }
    if (explanation.omitted.sourceRefs > 0) {
      lines.push(`... omitted ${explanation.omitted.sourceRefs} source refs`)
    }
  }
  if (explanation.omitted.evidence > 0 || explanation.omitted.provenance > 0) {
    lines.push('', `Omitted: ${explanation.omitted.provenance} provenance entries, ${explanation.omitted.evidence} evidence entries`)
  }
  if (explanation.patches.length > 0) {
    lines.push('', 'Patches:')
    for (const patch of explanation.patches) {
      lines.push(`- ${patch.id} status=${patch.status} appliedRevision=${patch.appliedRevisionId ?? 'unknown'}`)
    }
  }
  if (explanation.evidenceReports.length > 0) {
    lines.push('', 'Evidence reports:')
    for (const report of explanation.evidenceReports) {
      lines.push(`- ${report.id} scope=${report.scopeId} findings=${report.findings.length}`)
    }
  }
  if (explanation.relatedEdges.length > 0 || explanation.omitted.relations > 0) {
    lines.push('', 'Relations:')
    for (const edge of explanation.relatedEdges) {
      lines.push(`- ${edge.from} -[${edge.type}]-> ${edge.to}`)
    }
    if (explanation.omitted.relations > 0) {
      lines.push(`... omitted ${explanation.omitted.relations} relations`)
    }
  }
  if (fact && explanation.diagnostics.length > 0) {
    lines.push('', 'Diagnostics:')
    for (const diagnostic of explanation.diagnostics) {
      lines.push(`- [${diagnostic.severity}] ${diagnostic.type}: ${diagnostic.message}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

/** Format one provenance-backed graph fact history timeline. */
export function formatGraphFactHistory(history: GraphFactHistory): string {
  const lines = [
    `${history.factId}`,
    `Kind: ${history.factKind}`,
    `Timeline entries: ${history.timeline.length}`,
    ''
  ]
  for (const item of history.timeline) {
    const patch = item.patchId ? ` patch=${item.patchId}` : ''
    const findings = item.findingTypes.length > 0 ? ` findings=${item.findingTypes.join(',')}` : ''
    lines.push(`- ${item.createdAt} ${item.operation ?? 'unknown'} revision=${item.revisionId}${patch}${findings} sources=${item.sourceRefCount} status=${item.status}`)
  }
  if (history.diagnostics.length > 0) {
    lines.push('', 'Diagnostics:')
    for (const diagnostic of history.diagnostics) {
      lines.push(`- [${diagnostic.severity}] ${diagnostic.type}: ${diagnostic.message}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

/** Format a budgeted Graph-of-Graphs scope view. */
export function formatGraphScopeView(view: GraphScopeView): string {
  const lines = [
    `${view.scope.title}`,
    `Scope: ${view.scope.id}`,
    `Kind: ${view.scope.kind}`,
    view.scope.path ? `Path: ${view.scope.path}` : undefined,
    `Nodes: ${view.nodes.length}/${view.scope.stats.nodes}`,
    `Edges: ${view.edges.length}/${view.scope.stats.edges}`,
    `Child scopes: ${view.childScopes.length}`,
    `Related scopes: ${view.relatedScopes.length}`,
    ''
  ].filter((line): line is string => typeof line === 'string')

  if (view.nodes.length > 0) {
    lines.push('Nodes:')
    for (const node of view.nodes) {
      lines.push(`- ${formatNodeBrief(node)}`)
    }
  }
  if (view.edges.length > 0) {
    lines.push('', 'Edges:')
    for (const edge of view.edges) {
      lines.push(`- ${formatEdgeBrief(edge)}`)
    }
  }
  if (view.childScopes.length > 0) {
    lines.push('', 'Child scopes:')
    for (const scope of view.childScopes) {
      lines.push(`- ${scope.id} ${scope.kind} ${scope.title}`)
    }
  }
  if (view.relatedScopes.length > 0) {
    lines.push('', 'Related scopes:')
    for (const scope of view.relatedScopes) {
      lines.push(`- ${scope.id} ${scope.kind} ${scope.title}`)
    }
  }
  appendNextActions(lines, view.nextActions)
  appendOmitted(lines, view.omitted)
  appendDiagnostics(lines, view.diagnostics)
  lines.push('')
  return lines.join('\n')
}

/** Format a budgeted expansion from a node, edge, or scope target. */
export function formatGraphExpansion(expansion: GraphExpansion): string {
  const lines = [
    `${expansion.target.id}`,
    `Target kind: ${expansion.targetKind}`,
    expansion.scopePath.length > 0 ? `Scope path: ${expansion.scopePath.map((scope) => scope.title).join(' > ')}` : undefined,
    `Facts: ${expansion.facts.length}`,
    `Edges: ${expansion.edges.length}`,
    ''
  ].filter((line): line is string => typeof line === 'string')

  if (expansion.facts.length > 0) {
    lines.push('Facts:')
    for (const node of expansion.facts) {
      lines.push(`- ${formatNodeBrief(node)}`)
    }
  }
  if (expansion.edges.length > 0) {
    lines.push('', 'Edges:')
    for (const edge of expansion.edges) {
      lines.push(`- ${formatEdgeBrief(edge)}`)
    }
  }
  if (expansion.sourceTrace) {
    lines.push('', `Source trace: ${expansion.sourceTrace.sourceRefs.length} source refs, ${expansion.sourceTrace.files.length} files, ${expansion.sourceTrace.contentNodes.length} content nodes`)
  }
  appendNextActions(lines, expansion.nextActions)
  appendOmitted(lines, expansion.omitted)
  appendDiagnostics(lines, expansion.diagnostics)
  lines.push('')
  return lines.join('\n')
}

/** Format a layered source trace for one graph fact. */
export function formatLayeredSourceTrace(trace: LayeredSourceTrace): string {
  const lines = [
    `${trace.factId}`,
    trace.fact ? `Fact: ${formatNodeBrief(trace.fact)}` : trace.edge ? `Edge: ${formatEdgeBrief(trace.edge)}` : undefined,
    `Source groups: ${trace.sourceGroups.length}`,
    `Scopes: ${trace.scopes.length}`,
    `Files: ${trace.files.length}`,
    `Content nodes: ${trace.contentNodes.length}`,
    `Source refs: ${trace.sourceRefs.length}`,
    ''
  ].filter((line): line is string => typeof line === 'string')

  if (trace.sourceGroups.length > 0) {
    lines.push('Source groups:')
    for (const group of trace.sourceGroups) {
      lines.push(`- ${formatNodeBrief(group)}`)
    }
  }
  if (trace.scopes.length > 0) {
    lines.push('', 'Scope path:')
    for (const scope of trace.scopes) {
      lines.push(`- ${scope.id} ${scope.kind} ${scope.title}`)
    }
  }
  if (trace.files.length > 0) {
    lines.push('', 'Files:')
    for (const file of trace.files) {
      lines.push(`- ${file.properties.path ?? file.name}`)
    }
  }
  if (trace.contentNodes.length > 0) {
    lines.push('', 'Content nodes:')
    for (const node of trace.contentNodes) {
      lines.push(`- ${formatNodeBrief(node)}`)
    }
  }
  if (trace.sourceRefs.length > 0 || trace.omitted.sourceRefs > 0) {
    lines.push('', 'Sources:')
    for (const sourceRef of trace.sourceRefs) {
      lines.push(`- ${sourceRef.uri}`)
    }
  }
  appendOmitted(lines, trace.omitted)
  appendDiagnostics(lines, trace.diagnostics)
  lines.push('')
  return lines.join('\n')
}

/** Format runtime health for `context doctor`. */
export function formatRuntimeHealth(
  health: ContextRuntimeHealth,
  diagnostics: Diagnostic[],
  freshness?: { status: 'fresh' | 'stale' | 'unknown'; staleSources: string[] },
  adapterRuntimeStatuses: AdapterRuntimeStatus[] = []
): string {
  const lines = [
    `Context runtime: ${health.status}`,
    ...(freshness ? [`Context freshness: ${freshness.status}`] : []),
    `Nodes: ${health.counts.nodes}`,
    `Edges: ${health.counts.edges}`,
    `Diagnostics: ${health.counts.diagnostics}`,
    `Views: ${health.counts.views}`,
    `Indexes: ${health.counts.indexes}`,
    `Providers: ${health.counts.providers}`,
    `Tools: ${health.counts.tools}`,
    `Skills: ${health.counts.skills}`,
    ''
  ]

  if (freshness?.staleSources.length) {
    lines.push('Stale sources:')
    for (const source of freshness.staleSources) {
      lines.push(`- ${source}`)
    }
    lines.push('')
  }

  if (adapterRuntimeStatuses.length > 0) {
    lines.push('Adapter runtimes:')
    for (const status of adapterRuntimeStatuses) {
      lines.push(`- ${status.adapterId} ${status.mode} ${status.state}${status.packageName ? ` ${status.packageName}` : ''}`)
    }
    lines.push('')
  }

  if (diagnostics.length > 0) {
    lines.push('Graph diagnostics:')
    for (const diagnostic of diagnostics) {
      lines.push(`- [${diagnostic.severity}] ${diagnostic.type}: ${diagnostic.message}`)
    }
    lines.push('')
  }

  if (health.capabilityGaps && health.capabilityGaps.length > 0) {
    lines.push('Capability gaps:')
    for (const gap of health.capabilityGaps) {
      const diagnosticType = gap.diagnosticType ? ` [${gap.diagnosticType}]` : ''
      lines.push(`- ${gap.id}${diagnosticType}: ${gap.message}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function formatNodeBrief(node: ContextNode): string {
  return `${node.id}\t${node.type}\t${node.name}`
}

function formatCorrectionProposalBrief(proposal: ContextCorrectionProposal): string {
  const paths = proposal.sourcePaths.length > 0 ? ` paths=${proposal.sourcePaths.join(',')}` : ''
  const nodes = proposal.affectedNodeIds.length > 0 ? ` nodes=${proposal.affectedNodeIds.join(',')}` : ''
  return `${proposal.id}\t${proposal.kind}\t${proposal.status}\tblocked=${proposal.blocked}\trisk=${proposal.impact.riskLevel}\tconflicts=${proposal.conflicts.length}\tconfidence=${proposal.confidence}\tpackage=${proposal.packageId ?? 'unknown'}${paths}${nodes}`
}

function formatRecordCounts(record: Record<string, number | undefined>): string {
  return Object.entries(record)
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .map(([key, count]) => `${key}=${count}`)
    .join(' ')
}

function appendPackageSourceGroups(lines: string[], groups: ContextSourceGroupRecord[]): void {
  if (groups.length === 0) {
    return
  }
  lines.push('L1 source groups:')
  for (const group of groups) {
    lines.push(`- ${group.id}\t${group.kind}\t${group.path}\t${group.title}`)
  }
}

function appendPackageBuildUnits(lines: string[], buildUnits: ContextBuildUnitView[]): void {
  if (buildUnits.length === 0) {
    return
  }
  lines.push('', 'Build units:')
  for (const unit of buildUnits) {
    const candidates = unit.adapterSelection.candidateAdapterIds?.length ? ` candidates=${unit.adapterSelection.candidateAdapterIds.join(',')}` : ''
    const reason = unit.adapterSelection.selectionReason ? ` reason=${unit.adapterSelection.selectionReason}` : ''
    lines.push(`- ${unit.id}\t${unit.standardKind}\t${unit.adapterId}\tinventoryOnly=${unit.inventoryOnly}${candidates}${reason}`)
  }
}

function appendPackageCorrections(lines: string[], corrections: ContextPackageCorrectionSummary): void {
  const total = corrections.counts.findings + corrections.counts.proposedPatches + corrections.counts.rehomeProposals
  if (total === 0) {
    return
  }
  lines.push('', 'Corrections:')
  lines.push(`- counts evidenceReports=${corrections.counts.evidenceReports} findings=${corrections.counts.findings} proposedPatches=${corrections.counts.proposedPatches} rehomeProposals=${corrections.counts.rehomeProposals}`)
  lines.push(`- proposals total=${corrections.proposalCounts.total} blocked=${corrections.proposalCounts.blocked} conflicted=${corrections.proposalCounts.conflicted} risk=${formatRecordCounts(corrections.proposalCounts.byRiskLevel) || 'none'}`)
  if (corrections.nextRecommendedProposalId) {
    lines.push(`- recommended=context package correction show ${corrections.nextRecommendedProposalId}`)
  }
  const findingTypes = Object.entries(corrections.counts.byFindingType)
  if (findingTypes.length > 0) {
    lines.push(`- findingTypes ${findingTypes.map(([type, count]) => `${type}=${count}`).join(',')}`)
  }
  for (const report of corrections.evidenceReports.slice(0, 5)) {
    lines.push(`- evidenceReport ${report.id} scope=${report.scopeId} findings=${report.findings.length}`)
  }
  for (const patch of corrections.proposedPatches.slice(0, 5)) {
    lines.push(`- proposedPatch ${patch.id} status=${patch.status}`)
  }
  for (const proposal of corrections.rehomeProposals.slice(0, 5)) {
    lines.push(`- rehomeProposal ${proposal.id} action=${proposal.action} status=${proposal.status} source=${proposal.sourcePath}`)
  }
}

function formatEdgeBrief(edge: ContextEdge): string {
  return `${edge.id}\t${edge.from} -[${edge.type}]-> ${edge.to}`
}

function appendNextActions(lines: string[], actions: Array<{ type: string; targetId: string; label: string; reason: string }>): void {
  if (actions.length === 0) {
    return
  }
  lines.push('', 'Next actions:')
  for (const action of actions) {
    lines.push(`- ${action.type} ${action.targetId}: ${action.label}`)
  }
}

function appendOmitted(lines: string[], omitted: { nodes: number; edges: number; childScopes: number; sourceRefs: number; evidence: number }): void {
  const values = [
    omitted.nodes > 0 ? `${omitted.nodes} nodes` : undefined,
    omitted.edges > 0 ? `${omitted.edges} edges` : undefined,
    omitted.childScopes > 0 ? `${omitted.childScopes} child scopes` : undefined,
    omitted.sourceRefs > 0 ? `${omitted.sourceRefs} source refs` : undefined,
    omitted.evidence > 0 ? `${omitted.evidence} evidence entries` : undefined
  ].filter(Boolean)
  if (values.length > 0) {
    lines.push('', `Omitted: ${values.join(', ')}`)
  }
}

function appendDiagnostics(lines: string[], diagnostics: Diagnostic[]): void {
  if (diagnostics.length === 0) {
    return
  }
  lines.push('', 'Diagnostics:')
  for (const diagnostic of diagnostics) {
    lines.push(`- [${diagnostic.severity}] ${diagnostic.type}: ${diagnostic.message}`)
  }
}
