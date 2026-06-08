# Context Compiler Ultimate Goal: Super Data Network

Context Compiler's north star is a human-agent co-queryable Super Data Network:
start outside-in from source packages, correct inside-out from graph evidence,
and repeat until project context converges.

The most reasonable end state is not only a four-level graph. It is a 4-layer
query interface plus evidence, correction, revision, confidence, and permission
control layers. Users and agents should be able to browse, search, ask task
questions, explain sources, propose corrections, and keep improving the network
without turning project knowledge into an opaque automated black box.

Every answer must remain traceable to original evidence. Every automated
classification, link, claim, or correction must remain reviewable and reversible.

## Summary

- User-visible L0/L1/L2/L3 levels are enough for product experience, but the
  implementation must also include internal control layers.
- The primary direction is human-agent co-query: humans and agents first learn
  to query, explain, and correct the network together, then automation becomes
  stronger over time.
- L3 should not only create more nodes from L2. It is the global semantic fusion
  layer where entities, concepts, claims, facts, rules, causal links, temporal
  validity, contradictions, decisions, and evidence connect across local graphs.

## Key Architecture

### L0 Package Map

L0 is the package directory for all available materials. A package can represent
product documents, a code repository, design material, API contracts, runtime
data, analysis material, assets, or unknown material.

Package is the outside-in starting point and the correction entrypoint. Nothing
should disappear because it cannot be classified. Every source belongs to one L0
package, including `unknown` material that may be shown as "other materials" or
"unknown package" in a localized UI.

### L1 SourceGroup Map

L1 groups are local build boundaries inside packages. A code repository can be
one group. A folder of same-domain documents can be one group. A batch of API
contracts, runtime signals, or analysis material can be one group.

The goal of L1 is not beautiful taxonomy. The goal is to define a boundary small
and coherent enough for independent graph construction, adapter selection,
quality checks, and later correction.

### L2 Local Graphs

L2 is the independently built graph for each L1 group and its child scopes:
files, content nodes, code symbols, API endpoints, document facts, source
snapshots, local relations, adapter outputs, and source evidence.

L2 prioritizes fidelity. It preserves the original evidence chain, exposes why
an adapter was selected, and makes local structure drillable without requiring
global semantic reasoning to be correct first.

### L3 Semantic Supergraph

L3 is the global semantic network built from L2 evidence. It aligns entities,
concepts, claims, decisions, rules, APIs, code symbols, user flows, tests,
incidents, and runtime signals across packages and groups.

L3 is the reasoning layer. It should expose supported claims, contradictions,
temporal changes, causal links, ownership, coverage, risk, and task-specific
subgraphs. It should not silently replace L2 fidelity; it should explain itself
through L2 evidence.

## Meta Layer

The Meta Layer is not exposed as L4 in the product navigation, but it must exist
inside the system. It controls trust, change, and access:

- **Claim**: a semantic assertion with content, scope, confidence, status,
  provenance, applicable time, supporting evidence, counter-evidence, and
  revision history.
- **Evidence**: source references, file/content nodes, excerpts, runtime
  signals, tests, graph facts, or human confirmations that support or challenge
  a claim.
- **Revision**: immutable graph history so changes can be traced, compared, and
  reverted.
- **Proposal**: pending relabel, split, merge, rehome, confirm, reject, or link
  changes produced by agents or humans.
- **Confidence**: explicit uncertainty for packages, groups, claims, and links.
- **Permission**: source and policy boundaries that control what can be queried,
  linked, emitted, or shown to a caller.

These layers are not optional polish. They are what make the Super Data Network
auditable instead of a black-box knowledge graph.

## Core Model

All L0 package and L1 source group classifications are hypotheses, not permanent
truth. The system should continuously use L2/L3 evidence to propose package
relabeling, group splits, group merges, source rehomes, and relation fixes.

Claim is the recommended L3 semantic unit. A claim is stronger than a plain fact
because it carries content, source scope, confidence, temporal validity,
supporting evidence, counter-evidence, status, and revision provenance.

Relations fall into three families:

- **Structural relations** support drill-down and materialization, such as
  package contains group, group contains file, file contains content node, or
  group materializes local graph.
- **Semantic relations** support understanding, such as implements, depends on,
  contradicts, supports, causes, belongs to concept, owned by, changed by, or
  tested by.
- **Correction relations** support evolution, such as proposed relabel, split,
  merge, rehome, confirm, reject, supersede, or restore.

Adapters are replaceable technical implementations. The core should keep stable
intermediate representations, evidence chains, graph projections, manifests, and
adapter selection metadata. When a better open-source technique appears, the
adapter and manifest can change without rewriting the Super Data Network model.

## Usage Flow

The user entrypoint is always L0. A user or agent first lists packages, then
opens an L1 group, inspects an L2 local graph, and uses L3 semantics when cross
material understanding is needed.

There are three primary query modes:

- **Browse drill-down**: L0 package -> L1 source group -> L2 local graph -> L3
  semantic relation or claim.
- **Package-scoped search**: search inside one package boundary before widening
  to project-wide search.
- **Task agent query**: ask for a task-specific view such as a feature, API,
  business rule, risk, incident, or test coverage subgraph.

Every answer must be traceable backward:

```txt
answer -> L3 claim -> L2 local graph node -> L1 source group -> L0 package -> original source
```

Corrections happen through the same chain. When a human or agent finds a wrong
classification, missing relation, contradiction, or stale claim, the system
should create a proposal instead of silently changing the graph.

The operating loop is:

1. **Outside-in startup**: classify materials into L0 packages and L1 groups,
   preserving unknowns instead of dropping them.
2. **Local construction**: build L2 local graphs with the best available adapter
   for each build boundary.
3. **Semantic fusion**: derive L3 claims and cross-graph relations from local
   evidence.
4. **Inside-out correction**: use L2/L3 evidence to propose package relabeling,
   group splits/merges, source rehomes, and relation fixes.
5. **Convergence**: rerun affected builds and keep the network improving as
   materials, code, tests, runtime signals, and user feedback change.

## Future Milestones

### P1 Package-First Query Experience

Stabilize L0/L1/L2 query surfaces. Unknown packages must be drillable. Adapter
selection must be explainable. CLI, MCP, and generated agent instructions should
prefer package-first tools before low-level graph tools.

### P2 Correction Loop

Support relabel, split, merge, rehome, confirm relation, and reject relation
flows from package and group views. Persist them as proposals and graph patches
with evidence, status, revision history, and rollback paths.

### P3 L3 Claim Graph

Introduce claim, entity, concept, semantic relation, conflict, decision, rule,
and temporal validity models. Cross-group links must be explainable through L2
evidence, not just inferred by a global model.

### P4 Task Views

Generate dynamic task subgraphs for questions like "understand this feature",
"trace this API", "explain this business rule", "find risky changes", or
"review test coverage". Task views should be semantic, but still source-backed.

### P5 Continuous Convergence

Use feedback, code changes, test results, runtime signals, and recurring agent
reviews to propose graph updates. The long-term automation goal is explainable
convergence, not silent total automation.

## Assumptions

- The Super Data Network first serves human-agent co-query and collaborative
  correction, not fully automatic black-box reasoning.
- User-visible navigation remains L0-L3 so the product does not become a deep
  database browser.
- Internal models may be refactored aggressively when needed, but every
  automated judgment must preserve evidence, confidence, revision, and a
  reversible correction record.
- GraphScope remains an execution structure. Package, source group, local graph,
  and semantic claim are the product-facing mental model.
