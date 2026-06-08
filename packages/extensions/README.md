# Context Compiler Extensions

`packages/extensions` contains optional adapters for external parsers, graph builders, and knowledge systems.

These packages are intentionally not part of the default local distribution. Each extension declares a `context-extension.v1` manifest and one or more standard adapters:

- `source-parser`: routes source inventory entries into raw or parsed artifacts.
- `document-extractor`: extracts structured document artifacts from PDF, Office, image, or mixed document sources.
- `graph-adapter`: maps parsed/source data into canonical `ContextNode` and `ContextEdge` graph patches.

Extension packages must not write `.context/graph` directly. They return standard adapter results, and the core compiler normalizes those results into the canonical Graph-of-Graphs workspace.

Current starter extensions:

- `document/parser-docling`
- `document/parser-unstructured`
- `knowledge/graph-microsoft-graphrag`
- `code/graph-codegraph`
