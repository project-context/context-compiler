import { readdir, readFile, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { defineComponent, type ContextComponent, type RawArtifact, type SourceConfig } from '@context-compiler/core'

/** Create the default local file ingest component. */
export function createLocalFilesIngestComponent(): ContextComponent {
  return defineComponent({
    manifest: {
      id: 'ingest.local-files',
      stage: 'ingest',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['source-config'],
      outputs: ['raw-artifact'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(_state, context) {
      const rawArtifacts: RawArtifact[] = []
      for (const source of context.config.sources) {
        rawArtifacts.push(...(await readSource(source, context.rootDir)))
      }
      return { rawArtifacts }
    }
  })
}

async function readSource(source: SourceConfig, rootDir: string): Promise<RawArtifact[]> {
  const sourcePath = resolve(rootDir, source.path)
  const files = await listFiles(sourcePath)
  const selected = files.filter((file) => matchesSource(file, source))
  const artifacts: RawArtifact[] = []

  for (const file of selected) {
    const content = await readFile(file, 'utf8')
    const uri = `file://${relative(rootDir, file).split('\\').join('/')}`
    artifacts.push({
      id: `raw:${source.name}:${relative(rootDir, file).split('\\').join('/')}`,
      kind: 'raw',
      mediaType: mediaTypeFor(source, file),
      content,
      source: {
        uri,
        type: source.type,
        name: source.name
      },
      metadata: {
        sourceName: source.name,
        sourceType: source.type,
        path: source.path
      }
    })
  }

  return artifacts
}

async function listFiles(path: string): Promise<string[]> {
  const entry = await stat(path)
  if (entry.isFile()) {
    return [path]
  }
  const children = await readdir(path, { withFileTypes: true })
  const files = await Promise.all(
    children
      .filter((child) => !child.name.startsWith('.'))
      .map((child) => listFiles(resolve(path, child.name)))
  )
  return files.flat()
}

function matchesSource(file: string, source: SourceConfig): boolean {
  const mediaType = mediaTypeFor(source, file)
  if (source.type === 'markdown' || source.parser === 'markdown') {
    return mediaType === 'text/markdown'
  }
  if (source.type === 'openapi' || source.parser === 'openapi') {
    return mediaType === 'application/openapi'
  }
  if (source.type === 'code' || source.type === 'git' || source.parser === 'code') {
    return mediaType === 'text/typescript' || mediaType === 'text/javascript'
  }
  return true
}

function mediaTypeFor(source: SourceConfig, file: string): string {
  if (source.mediaType) {
    return source.mediaType
  }
  if (/\.mdx?$/i.test(file)) {
    return 'text/markdown'
  }
  if (/\.(ya?ml|json)$/i.test(file)) {
    return 'application/openapi'
  }
  if (/\.tsx?$/i.test(file)) {
    return 'text/typescript'
  }
  if (/\.jsx?$/i.test(file)) {
    return 'text/javascript'
  }
  return 'text/plain'
}
