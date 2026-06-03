import { basename } from 'node:path'
import ts from 'typescript'
import { defineComponent, type ContextComponent, type ContextNode } from '@context-compiler/core'

/** Create the dependency-free symbol index enrichment component. */
export function createSymbolIndexEnrichComponent(): ContextComponent {
  return defineComponent({
    manifest: {
      id: 'enrich.symbol-index',
      stage: 'enrich',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['raw-artifact:text/typescript'],
      outputs: ['context-fact:code_symbol', 'symbol-index'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(state) {
      const facts: ContextNode[] = []
      for (const artifact of state.rawArtifacts.filter((candidate) => candidate.mediaType === 'text/typescript' || candidate.mediaType === 'text/javascript')) {
        const imports = extractImports(artifact.content, fileNameFromArtifact(artifact.source.uri))
        for (const symbol of extractSymbols(artifact.content, fileNameFromArtifact(artifact.source.uri))) {
          const file = artifact.source.uri.replace(/^file:\/\//, '')
          const stableFileId = basename(file).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
          facts.push({
            id: `SYM-${stableFileId}-${symbol.name}`,
            type: 'code_symbol',
            title: symbol.name,
            content: `${symbol.kind} ${symbol.name}`,
            tags: [symbol.kind],
            source: artifact.source,
            metadata: {
              kind: symbol.kind,
              file,
              language: artifact.mediaType === 'text/typescript' ? 'typescript' : 'javascript',
              exported: symbol.exported,
              exportedDefault: symbol.exportedDefault,
              signature: symbol.signature,
              imports
            }
          })
        }
      }
      return {
        facts,
        artifacts: {
          symbolIndex: facts.map((node) => ({
            id: node.id,
            name: node.title,
            file: node.metadata.file,
            kind: node.metadata.kind
          }))
        }
      }
    }
  })
}

interface ExtractedSymbol {
  name: string
  kind: string
  exported: boolean
  exportedDefault: boolean
  signature: string
}

interface ExtractedImport {
  module: string
  names: string[]
}

function extractSymbols(content: string, fileName: string): ExtractedSymbol[] {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, scriptKindFor(fileName))
  const symbols = []
  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement) && hasExport(statement)) {
      symbols.push(symbolFromDeclaration(statement.name.text, 'interface', statement, sourceFile))
    }
    if (ts.isTypeAliasDeclaration(statement) && hasExport(statement)) {
      symbols.push(symbolFromDeclaration(statement.name.text, 'type', statement, sourceFile))
    }
    if (ts.isClassDeclaration(statement) && (hasExport(statement) || hasDefault(statement))) {
      symbols.push(symbolFromDeclaration(statement.name?.text ?? 'default', 'class', statement, sourceFile))
    }
    if (ts.isFunctionDeclaration(statement) && (hasExport(statement) || hasDefault(statement))) {
      symbols.push(symbolFromDeclaration(statement.name?.text ?? 'default', 'function', statement, sourceFile))
    }
  }
  return symbols
}

function extractImports(content: string, fileName: string): ExtractedImport[] {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, scriptKindFor(fileName))
  const imports: ExtractedImport[] = []
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue
    }
    const names = namesFromImport(statement)
    if (names.length > 0) {
      imports.push({ module: statement.moduleSpecifier.text, names })
    }
  }
  return imports
}

function symbolFromDeclaration(
  name: string,
  kind: ExtractedSymbol['kind'],
  node: ts.Declaration & { modifiers?: ts.NodeArray<ts.ModifierLike> },
  sourceFile: ts.SourceFile
): ExtractedSymbol {
  return {
    name,
    kind,
    exported: hasExport(node) || hasDefault(node),
    exportedDefault: hasDefault(node),
    signature: declarationSignature(node, sourceFile)
  }
}

function namesFromImport(statement: ts.ImportDeclaration): string[] {
  const clause = statement.importClause
  if (!clause) {
    return []
  }
  const names = []
  if (clause.name) {
    names.push(clause.name.text)
  }
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    names.push(...clause.namedBindings.elements.map((element) => element.name.text))
  }
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    names.push(clause.namedBindings.name.text)
  }
  return names
}

function declarationSignature(node: ts.Node, sourceFile: ts.SourceFile): string {
  const text = node.getText(sourceFile).replace(/\s+/g, ' ').trim()
  const bodyIndex = text.indexOf('{')
  return bodyIndex === -1 ? text : text.slice(0, bodyIndex).trim()
}

function hasExport(node: { modifiers?: ts.NodeArray<ts.ModifierLike> }): boolean {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
}

function hasDefault(node: { modifiers?: ts.NodeArray<ts.ModifierLike> }): boolean {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword))
}

function fileNameFromArtifact(uri: string): string {
  return uri.replace(/^file:\/\//, '')
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  if (/\.tsx$/i.test(fileName)) return ts.ScriptKind.TSX
  if (/\.jsx$/i.test(fileName)) return ts.ScriptKind.JSX
  if (/\.js$/i.test(fileName)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}
