import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SourceConfig } from './config.js'
import type { ParserPlugin } from './plugins.js'
import type { ContextEdge, ContextNode, Diagnostic } from './schemas.js'
import { discoverProjectInventory, type InventoryFile, type InventoryModule, type ProjectInventory } from './inventory.js'

export interface CodeIndexOptions {
  rootDir: string
  inventory: ProjectInventory
  providerNames?: string[]
  fallbackProvider?: string
}

export interface CodeIndexResult {
  provider: string
  nodes: ContextNode[]
  edges: ContextEdge[]
  diagnostics: Diagnostic[]
}

export interface CodeIndexProvider {
  name: string
  available(): Promise<boolean>
  index(options: CodeIndexOptions): Promise<CodeIndexResult>
}

const AVAILABLE_BUILT_INS = new Set(['tree-sitter', 'ctags'])

export async function indexCodeProject(options: CodeIndexOptions): Promise<CodeIndexResult> {
  const diagnostics: Diagnostic[] = []
  const requestedProviders = options.providerNames && options.providerNames.length > 0
    ? options.providerNames
    : ['tree-sitter', 'ctags']
  const fallbackProvider = options.fallbackProvider ?? 'ctags'

  for (const providerName of [...requestedProviders, fallbackProvider]) {
    if (!AVAILABLE_BUILT_INS.has(providerName)) {
      diagnostics.push(providerUnavailableDiagnostic(providerName))
      continue
    }

    const result = await lightweightIndex(providerName, options)
    return {
      ...result,
      diagnostics: [...diagnostics, ...result.diagnostics]
    }
  }

  return {
    provider: fallbackProvider,
    nodes: [],
    edges: [],
    diagnostics
  }
}

export function createCodeIndexParserPlugin(): ParserPlugin {
  return {
    name: 'parser-code-index',
    sourceTypes: ['code'],
    async parse(source: SourceConfig, context) {
      const inventory = context.inventory ?? await discoverProjectInventory({
        rootDir: context.rootDir,
        config: context.config
      })
      context.inventory = inventory
      const result = await indexCodeProject({
        rootDir: context.rootDir,
        inventory,
        providerNames: sourceProviderNames(source, context.config?.codeIndex?.providers),
        fallbackProvider: sourceFallbackProvider(source, context.config?.codeIndex?.fallbackProvider)
      })
      context.codeIndex = result
      return {
        nodes: result.nodes,
        edges: result.edges
      }
    }
  }
}

export async function writeCodeIndexFiles(result: CodeIndexResult, outputDir: string): Promise<void> {
  const codeDir = join(outputDir, 'indexes', 'code')
  const symbolDir = join(outputDir, 'indexes', 'symbol')
  await mkdir(codeDir, { recursive: true })
  await mkdir(symbolDir, { recursive: true })
  const symbols = result.nodes.filter((node) => node.type === 'code_symbol')
  const content = symbols.map((node) => JSON.stringify(node)).join('\n')
  await Promise.all([
    writeFile(join(codeDir, 'symbols.jsonl'), content.length > 0 ? `${content}\n` : ''),
    writeFile(join(symbolDir, 'symbols.jsonl'), content.length > 0 ? `${content}\n` : ''),
    writeFile(join(codeDir, 'metadata.json'), JSON.stringify({ provider: result.provider }, null, 2) + '\n')
  ])
}

async function lightweightIndex(provider: string, options: CodeIndexOptions): Promise<CodeIndexResult> {
  const nodes: ContextNode[] = []
  const edges: ContextEdge[] = []
  const modules = options.inventory.modules

  for (const module of modules) {
    nodes.push(moduleNode(module))
  }

  for (const file of options.inventory.files.filter((candidate) => candidate.language)) {
    const source = await readFile(join(options.rootDir, file.path), 'utf8')
    const symbols = extractSymbols(file, source)
    for (const symbol of symbols) {
      const node = codeSymbolNode(file, symbol, provider)
      nodes.push(node)
      if (file.moduleId) {
        edges.push({
          id: `${file.moduleId}--contains--${node.id}`,
          from: file.moduleId,
          to: node.id,
          type: 'contains',
          metadata: {}
        })
      }
    }
  }

  return {
    provider,
    nodes,
    edges,
    diagnostics: []
  }
}

interface ExtractedSymbol {
  name: string
  kind: string
}

function extractSymbols(file: InventoryFile, source: string): ExtractedSymbol[] {
  switch (file.language) {
    case 'typescript':
    case 'javascript':
      return collectMatches(source, [
        /\b(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
        /\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/g
      ], ['function', 'class'])
    case 'python':
      return collectMatches(source, [/^\s*def\s+([A-Za-z_]\w*)\s*\(/gm, /^\s*class\s+([A-Za-z_]\w*)\s*[:(]/gm], ['function', 'class'])
    case 'go':
      return collectMatches(source, [/\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/g], ['function'])
    case 'rust':
      return collectMatches(source, [/\b(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*\(/g, /\b(?:pub\s+)?struct\s+([A-Za-z_]\w*)\b/g], ['function', 'type'])
    case 'c':
    case 'cpp':
      return collectMatches(source, [/\b(?:void|int|char|float|double|bool|auto|static\s+\w+)\s+([A-Za-z_]\w*)\s*\(/g], ['function'])
    default:
      return []
  }
}

function collectMatches(source: string, patterns: RegExp[], kinds: string[]): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = []
  patterns.forEach((pattern, index) => {
    for (const match of source.matchAll(pattern)) {
      const name = match[1]
      if (name && !['if', 'for', 'while', 'switch'].includes(name)) {
        symbols.push({ name, kind: kinds[index] ?? 'symbol' })
      }
    }
  })
  return [...new Map(symbols.map((symbol) => [`${symbol.kind}:${symbol.name}`, symbol])).values()]
}

function moduleNode(module: InventoryModule): ContextNode {
  return {
    id: module.id,
    type: 'module',
    title: module.name,
    tags: module.languages,
    source: {
      uri: `file://${module.path}`,
      type: 'inventory'
    },
    metadata: {
      path: module.path,
      buildSystem: module.buildSystem
    }
  }
}

function codeSymbolNode(file: InventoryFile, symbol: ExtractedSymbol, provider: string): ContextNode {
  return {
    id: `CODE-${slug(file.path.replace(/\.[^.]+$/, ''))}-${slug(symbol.name)}`,
    type: 'code_symbol',
    title: symbol.name,
    tags: [file.language ?? 'code'],
    source: {
      uri: `file://${file.path}`,
      type: 'code',
      name: provider
    },
    metadata: {
      kind: symbol.kind,
      name: symbol.name,
      file: file.path,
      language: file.language,
      moduleId: file.moduleId,
      modulePath: file.moduleId?.replace(/^MODULE-/, '').replace(/-/g, '/'),
      provider
    }
  }
}

function providerUnavailableDiagnostic(provider: string): Diagnostic {
  return {
    id: `DIAG-code-index-provider-unavailable-${provider}`,
    severity: 'warning',
    code: 'code_index.provider_unavailable',
    message: `Code index provider "${provider}" is not available; trying the next provider.`,
    metadata: { provider }
  }
}

function sourceProviderNames(source: SourceConfig, configured: string[] | undefined): string[] {
  const value = source.providers
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value
  }
  return configured ?? ['tree-sitter', 'ctags']
}

function sourceFallbackProvider(source: SourceConfig, configured: string | undefined): string {
  return typeof source.fallbackProvider === 'string' ? source.fallbackProvider : configured ?? 'ctags'
}

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

