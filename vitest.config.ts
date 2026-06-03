import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@context-compiler/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@context-compiler/cli': resolve(__dirname, 'packages/cli/src/index.ts'),
      '@context-compiler/distribution-local': resolve(__dirname, 'packages/distributions/local/src/index.ts'),
      '@context-compiler/mcp-server': resolve(__dirname, 'packages/mcp/server/src/index.ts'),
      '@context-compiler/ingest-local-files': resolve(__dirname, 'packages/components/ingest/local-files/src/index.ts'),
      '@context-compiler/parse-markdown': resolve(__dirname, 'packages/components/parse/markdown/src/index.ts'),
      '@context-compiler/parse-openapi': resolve(__dirname, 'packages/components/parse/openapi/src/index.ts'),
      '@context-compiler/normalize-markdown-doc': resolve(__dirname, 'packages/components/normalize/markdown-doc/src/index.ts'),
      '@context-compiler/normalize-openapi-contract': resolve(__dirname, 'packages/components/normalize/openapi-contract/src/index.ts'),
      '@context-compiler/classify-context-facts': resolve(__dirname, 'packages/components/classify/context-facts/src/index.ts'),
      '@context-compiler/enrich-inventory': resolve(__dirname, 'packages/components/enrich/inventory/src/index.ts'),
      '@context-compiler/enrich-symbol-index': resolve(__dirname, 'packages/components/enrich/symbol-index/src/index.ts'),
      '@context-compiler/link-default-rules': resolve(__dirname, 'packages/components/link/default-rules/src/index.ts'),
      '@context-compiler/validate-default-rules': resolve(__dirname, 'packages/components/validate/default-rules/src/index.ts'),
      '@context-compiler/govern-redaction': resolve(__dirname, 'packages/components/govern/redaction/src/index.ts'),
      '@context-compiler/compress-context-view': resolve(__dirname, 'packages/components/compress/context-view/src/index.ts'),
      '@context-compiler/compress-runtime-plan': resolve(__dirname, 'packages/components/compress/runtime-plan/src/index.ts'),
      '@context-compiler/compress-task-context': resolve(__dirname, 'packages/components/compress/task-context/src/index.ts'),
      '@context-compiler/emit-files': resolve(__dirname, 'packages/components/emit/files/src/index.ts')
    }
  },
  test: {
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts']
  }
})
