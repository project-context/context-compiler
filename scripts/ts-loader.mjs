import { access, readFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const rootDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

const aliases = new Map([
  ['@context-compiler/core', 'packages/core/src/index.ts'],
  ['@context-compiler/core/sdk', 'packages/core/src/sdk/index.ts'],
  ['@context-compiler/core/kernel', 'packages/core/src/kernel/index.ts'],
  ['@context-compiler/core/graph', 'packages/core/src/graph/index.ts'],
  ['@context-compiler/core/source-model', 'packages/core/src/source-model/index.ts'],
  ['@context-compiler/core/runtime', 'packages/core/src/runtime/index.ts'],
  ['@context-compiler/core/compiler', 'packages/core/src/compiler/index.ts'],
  ['@context-compiler/cli', 'packages/cli/src/index.ts'],
  ['@context-compiler/builtin-local', 'packages/builtin/local/src/index.ts'],
  ['@context-compiler/mcp-server', 'packages/mcp/server/src/index.ts'],
  ['@context-compiler/builtin-ingest-local-files', 'packages/builtin/ingest-local-files/src/index.ts'],
  ['@context-compiler/builtin-parse-markdown', 'packages/builtin/parse-markdown/src/index.ts'],
  ['@context-compiler/builtin-parse-openapi', 'packages/builtin/parse-openapi/src/index.ts'],
  ['@context-compiler/builtin-parse-document-extractors', 'packages/builtin/parse-document-extractors/src/index.ts'],
  ['@context-compiler/builtin-normalize-markdown-doc', 'packages/builtin/normalize-markdown-doc/src/index.ts'],
  ['@context-compiler/builtin-normalize-openapi-contract', 'packages/builtin/normalize-openapi-contract/src/index.ts'],
  ['@context-compiler/builtin-classify-context-facts', 'packages/builtin/classify-context-facts/src/index.ts'],
  ['@context-compiler/builtin-enrich-inventory', 'packages/builtin/enrich-inventory/src/index.ts'],
  ['@context-compiler/builtin-enrich-symbol-index', 'packages/builtin/enrich-symbol-index/src/index.ts'],
  ['@context-compiler/builtin-link-default-rules', 'packages/builtin/link-default-rules/src/index.ts'],
  ['@context-compiler/builtin-evidence-scope-feedback', 'packages/builtin/evidence-scope-feedback/src/index.ts'],
  ['@context-compiler/builtin-validate-default-rules', 'packages/builtin/validate-default-rules/src/index.ts'],
  ['@context-compiler/builtin-govern-redaction', 'packages/builtin/govern-redaction/src/index.ts'],
  ['@context-compiler/builtin-compress-context-view', 'packages/builtin/compress-context-view/src/index.ts'],
  ['@context-compiler/builtin-compress-runtime-plan', 'packages/builtin/compress-runtime-plan/src/index.ts'],
  ['@context-compiler/builtin-compress-task-context', 'packages/builtin/compress-task-context/src/index.ts'],
  ['@context-compiler/builtin-emit-files', 'packages/builtin/emit-files/src/index.ts'],
  ['@context-compiler/extension-parser-docling', 'packages/extensions/document/parser-docling/src/index.ts'],
  ['@context-compiler/extension-parser-unstructured', 'packages/extensions/document/parser-unstructured/src/index.ts'],
  ['@context-compiler/extension-graph-microsoft-graphrag', 'packages/extensions/knowledge/graph-microsoft-graphrag/src/index.ts'],
  ['@context-compiler/extension-graph-codegraph', 'packages/extensions/code/graph-codegraph/src/index.ts']
])

export async function resolve(specifier, context, defaultResolve) {
  const alias = aliases.get(specifier)
  if (alias) {
    return {
      url: pathToFileURL(resolvePath(rootDir, alias)).href,
      shortCircuit: true
    }
  }

  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const parentPath = fileURLToPath(context.parentURL)
    const candidate = resolvePath(dirname(parentPath), specifier)
    const tsCandidate = candidate.endsWith('.js') ? candidate.slice(0, -3) + '.ts' : candidate + '.ts'
    if (await exists(tsCandidate)) {
      return {
        url: pathToFileURL(tsCandidate).href,
        shortCircuit: true
      }
    }
  }

  return defaultResolve(specifier, context, defaultResolve)
}

export async function load(url, context, defaultLoad) {
  if (!url.endsWith('.ts')) {
    return defaultLoad(url, context, defaultLoad)
  }

  const source = await readFile(fileURLToPath(url), 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      esModuleInterop: true,
      sourceMap: false
    },
    fileName: fileURLToPath(url)
  })

  return {
    format: 'module',
    source: transpiled.outputText,
    shortCircuit: true
  }
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
