import { access, readFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const rootDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

const aliases = new Map([
  ['@context-compiler/core', 'packages/core/src/index.ts'],
  ['@context-compiler/cli', 'packages/cli/src/index.ts'],
  ['@context-compiler/distribution-local', 'packages/distributions/local/src/index.ts'],
  ['@context-compiler/mcp-server', 'packages/mcp/server/src/index.ts'],
  ['@context-compiler/ingest-local-files', 'packages/components/ingest/local-files/src/index.ts'],
  ['@context-compiler/parse-markdown', 'packages/components/parse/markdown/src/index.ts'],
  ['@context-compiler/parse-openapi', 'packages/components/parse/openapi/src/index.ts'],
  ['@context-compiler/normalize-markdown-doc', 'packages/components/normalize/markdown-doc/src/index.ts'],
  ['@context-compiler/normalize-openapi-contract', 'packages/components/normalize/openapi-contract/src/index.ts'],
  ['@context-compiler/classify-context-facts', 'packages/components/classify/context-facts/src/index.ts'],
  ['@context-compiler/enrich-inventory', 'packages/components/enrich/inventory/src/index.ts'],
  ['@context-compiler/enrich-symbol-index', 'packages/components/enrich/symbol-index/src/index.ts'],
  ['@context-compiler/link-default-rules', 'packages/components/link/default-rules/src/index.ts'],
  ['@context-compiler/validate-default-rules', 'packages/components/validate/default-rules/src/index.ts'],
  ['@context-compiler/govern-redaction', 'packages/components/govern/redaction/src/index.ts'],
  ['@context-compiler/compress-context-view', 'packages/components/compress/context-view/src/index.ts'],
  ['@context-compiler/compress-runtime-plan', 'packages/components/compress/runtime-plan/src/index.ts'],
  ['@context-compiler/compress-task-context', 'packages/components/compress/task-context/src/index.ts'],
  ['@context-compiler/emit-files', 'packages/components/emit/files/src/index.ts']
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
