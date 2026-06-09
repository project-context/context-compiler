import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@context-compiler/core/sdk': resolve(__dirname, 'packages/core/src/sdk/index.ts'),
      '@context-compiler/core/config': resolve(__dirname, 'packages/core/src/config/index.ts'),
      '@context-compiler/core/extensions': resolve(__dirname, 'packages/core/src/extensions/index.ts'),
      '@context-compiler/core/kernel': resolve(__dirname, 'packages/core/src/kernel/index.ts'),
      '@context-compiler/core/graph': resolve(__dirname, 'packages/core/src/graph/index.ts'),
      '@context-compiler/core/source-model': resolve(__dirname, 'packages/core/src/source-model/index.ts'),
      '@context-compiler/core/runtime': resolve(__dirname, 'packages/core/src/runtime/index.ts'),
      '@context-compiler/core/compiler': resolve(__dirname, 'packages/core/src/compiler/index.ts'),
      '@context-compiler/cli': resolve(__dirname, 'packages/cli/src/index.ts'),
      '@context-compiler/builtin-local': resolve(__dirname, 'packages/builtin/local/src/index.ts'),
      '@context-compiler/mcp-server': resolve(__dirname, 'packages/mcp/server/src/index.ts'),
      '@context-compiler/builtin-ingest-local-files': resolve(__dirname, 'packages/builtin/ingest-local-files/src/index.ts'),
      '@context-compiler/builtin-parse-markdown': resolve(__dirname, 'packages/builtin/parse-markdown/src/index.ts'),
      '@context-compiler/builtin-parse-openapi': resolve(__dirname, 'packages/builtin/parse-openapi/src/index.ts'),
      '@context-compiler/builtin-normalize-markdown-doc': resolve(__dirname, 'packages/builtin/normalize-markdown-doc/src/index.ts'),
      '@context-compiler/builtin-normalize-openapi-contract': resolve(__dirname, 'packages/builtin/normalize-openapi-contract/src/index.ts'),
      '@context-compiler/builtin-classify-context-facts': resolve(__dirname, 'packages/builtin/classify-context-facts/src/index.ts'),
      '@context-compiler/builtin-enrich-inventory': resolve(__dirname, 'packages/builtin/enrich-inventory/src/index.ts'),
      '@context-compiler/builtin-enrich-symbol-index': resolve(__dirname, 'packages/builtin/enrich-symbol-index/src/index.ts'),
      '@context-compiler/builtin-link-default-rules': resolve(__dirname, 'packages/builtin/link-default-rules/src/index.ts'),
      '@context-compiler/builtin-evidence-scope-feedback': resolve(__dirname, 'packages/builtin/evidence-scope-feedback/src/index.ts'),
      '@context-compiler/builtin-validate-default-rules': resolve(__dirname, 'packages/builtin/validate-default-rules/src/index.ts'),
      '@context-compiler/builtin-govern-redaction': resolve(__dirname, 'packages/builtin/govern-redaction/src/index.ts'),
      '@context-compiler/builtin-compress-context-view': resolve(__dirname, 'packages/builtin/compress-context-view/src/index.ts'),
      '@context-compiler/builtin-compress-runtime-plan': resolve(__dirname, 'packages/builtin/compress-runtime-plan/src/index.ts'),
      '@context-compiler/builtin-compress-task-context': resolve(__dirname, 'packages/builtin/compress-task-context/src/index.ts'),
      '@context-compiler/builtin-emit-files': resolve(__dirname, 'packages/builtin/emit-files/src/index.ts'),
      '@context-compiler/extension-parser-docling': resolve(__dirname, 'packages/extensions/document/parser-docling/src/index.ts'),
      '@context-compiler/extension-parser-unstructured': resolve(__dirname, 'packages/extensions/document/parser-unstructured/src/index.ts'),
      '@context-compiler/extension-graph-microsoft-graphrag': resolve(__dirname, 'packages/extensions/knowledge/graph-microsoft-graphrag/src/index.ts'),
      '@context-compiler/extension-graph-codegraph': resolve(__dirname, 'packages/extensions/code/graph-codegraph/src/index.ts')
    }
  },
  test: {
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 120000
  }
})
