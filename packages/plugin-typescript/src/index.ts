import { readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { Project } from 'ts-morph'
import type { ContextNode, ParserPlugin, SourceConfig, SourceRef } from '@context-compiler/core'

export function createTypeScriptParserPlugin(): ParserPlugin {
  return {
    name: 'parser-typescript',
    sourceTypes: ['git', 'typescript'],
    async parse(source: SourceConfig, context): Promise<{ nodes: ContextNode[] }> {
      const root = resolve(context.rootDir, source.path)
      const files = await findTypeScriptFiles(root)
      const project = new Project({
        skipAddingFilesFromTsConfig: true,
        compilerOptions: {
          allowJs: false
        }
      })
      const nodes: ContextNode[] = []

      for (const file of files) {
        const sourceFile = project.addSourceFileAtPath(file)
        const sourceRef: SourceRef = {
          uri: `file://${relative(context.rootDir, file)}`,
          type: source.type,
          name: source.name
        }
        const relativeFile = relative(context.rootDir, file)

        for (const declaration of sourceFile.getClasses()) {
          if (!declaration.isExported() && !declaration.isDefaultExport()) {
            continue
          }
          const name = declaration.getName()
          if (!name) {
            continue
          }
          nodes.push(symbolNode(name, 'class', relativeFile, sourceRef))
        }

        for (const declaration of sourceFile.getFunctions()) {
          if (!declaration.isExported() && !declaration.isDefaultExport()) {
            continue
          }
          const name = declaration.getName()
          if (!name) {
            continue
          }
          nodes.push(symbolNode(name, 'function', relativeFile, sourceRef))
        }
      }

      return { nodes }
    }
  }
}

function symbolNode(
  name: string,
  kind: 'class' | 'function',
  relativeFile: string,
  source: SourceRef
): ContextNode {
  return {
    id: `CODE-${slug(relativeFile)}-${slug(name)}`,
    type: 'code_symbol',
    title: name,
    tags: [],
    source,
    metadata: {
      kind,
      name,
      file: relativeFile
    }
  }
}

async function findTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') {
          return []
        }
        return findTypeScriptFiles(path)
      }
      return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')
        ? [path]
        : []
    })
  )
  return files.flat().sort()
}

function slug(value: string): string {
  return value
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
