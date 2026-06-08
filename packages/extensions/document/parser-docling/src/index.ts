import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { defineContextExtension, resolveAdapterExtensionPaths, resolveAdapterRuntimeStatus, type Diagnostic, type DocumentExtractionInput, type DocumentExtractionResult, type DocumentExtractorAdapter, type DocumentExtractorAdapterManifest, type GraphAdapterArtifact, type ParsedArtifact } from '@context-compiler/core/sdk'

const execFileAsync = promisify(execFile)

export const doclingDocumentExtractorManifest: DocumentExtractorAdapterManifest = {
  id: 'docling.document-extractor',
  title: 'Docling document extractor',
  version: '0.1.0',
  mediaTypes: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
    'image/tiff',
    'image/x-icon'
  ],
  outputs: ['ParsedArtifact', 'GraphAdapterArtifact'],
  deterministic: true,
  requiresNetwork: false,
  stability: 'development',
  externalProjects: ['Docling'],
  runtime: {
    mode: 'managed-runtime',
    ecosystem: 'python',
    packageName: 'docling',
    executable: 'docling'
  },
  metadata: { backend: 'docling-cli', installMode: 'managed-venv' }
}

export const doclingExtension = defineContextExtension({
  schemaVersion: 'context-extension.v1',
  id: 'extension.parser-docling',
  title: 'Docling parser extension',
  version: '0.1.0',
  category: 'document',
  stability: 'development',
  adapters: [{ kind: 'document-extractor', manifest: doclingDocumentExtractorManifest }],
  externalProjects: ['Docling'],
  metadata: { backend: 'docling-cli', installMode: 'managed-venv' }
})

export interface DoclingRuntimePaths {
  runtimeDir: string
  venvDir: string
  executablePath: string
  pythonPath: string
  markerPath: string
}

export interface DoclingConversionResult {
  json: unknown
  markdown: string
  metadata?: Record<string, unknown>
  diagnostics?: Diagnostic[]
}

export interface DoclingRuntime {
  convertDocument(input: DocumentExtractionInput): Promise<DoclingConversionResult>
}

export interface DoclingDocumentExtractorOptions {
  runtime?: DoclingRuntime
}

export function doclingRuntimePaths(outputDir: string): DoclingRuntimePaths {
  const extensionPaths = resolveAdapterExtensionPaths({ adapterId: doclingDocumentExtractorManifest.id, outputDir })
  const runtimeDir = extensionPaths.runtimeDir
  const venvDir = join(runtimeDir, '.venv')
  const binDir = process.platform === 'win32' ? 'Scripts' : 'bin'
  return {
    runtimeDir,
    venvDir,
    executablePath: join(venvDir, binDir, process.platform === 'win32' ? 'docling.exe' : 'docling'),
    pythonPath: join(venvDir, binDir, process.platform === 'win32' ? 'python.exe' : 'python'),
    markerPath: extensionPaths.statusPath
  }
}

export function createDoclingDocumentExtractorAdapter(options: DoclingDocumentExtractorOptions = {}): DocumentExtractorAdapter {
  const runtime = options.runtime ?? createDoclingCliRuntime()
  return {
    manifest: doclingDocumentExtractorManifest,
    async extract(input: DocumentExtractionInput): Promise<DocumentExtractionResult> {
      try {
        const artifactDir = artifactDirFor(input.entry.id)
        const absoluteArtifactDir = resolveContextArtifactDir(input.outputDir, artifactDir)
        await mkdir(absoluteArtifactDir, { recursive: true })
        const converted = await runtime.convertDocument(input)
        const jsonPath = `${artifactDir}/docling.json`
        const markdownPath = `${artifactDir}/docling.md`
        await writeFile(join(absoluteArtifactDir, 'docling.json'), `${JSON.stringify(converted.json, null, 2)}\n`)
        await writeFile(join(absoluteArtifactDir, 'docling.md'), converted.markdown)
        const artifacts: GraphAdapterArtifact[] = [
          { id: `docling-json-${safeSegment(input.entry.id)}`, path: jsonPath, mediaType: 'application/json', metadata: converted.metadata },
          { id: `docling-markdown-${safeSegment(input.entry.id)}`, path: markdownPath, mediaType: 'text/markdown', metadata: converted.metadata }
        ]
        const parsedArtifacts: ParsedArtifact[] = [
          {
            id: `parsed:docling:${input.entry.id}`,
            kind: 'parsed',
            parser: 'markdown',
            source: input.entry.sourceRef,
            data: parseMarkdown(converted.markdown, input.entry.path),
            metadata: {
              adapterId: doclingDocumentExtractorManifest.id,
              sourceInventoryId: input.entry.id,
              doclingJson: jsonPath,
              doclingMarkdown: markdownPath,
              ...converted.metadata
            }
          }
        ]
        return {
          parsedArtifacts,
          diagnostics: converted.diagnostics ?? [],
          artifacts,
          metadata: converted.metadata
        }
      } catch (error) {
        return {
          parsedArtifacts: [],
          diagnostics: [doclingDiagnostic('docling.extract.failed', 'error', `Docling failed for ${input.entry.path}: ${error instanceof Error ? error.message : String(error)}`, input.entry.path)]
        }
      }
    }
  }
}

export function createDoclingCliRuntime(): DoclingRuntime {
  return {
    async convertDocument(input: DocumentExtractionInput): Promise<DoclingConversionResult> {
      if (!input.outputDir || !input.rootDir) {
        throw new Error('Docling runtime requires rootDir and outputDir.')
      }
      const paths = doclingRuntimePaths(input.outputDir)
      const status = await resolveAdapterRuntimeStatus({
        adapterId: doclingDocumentExtractorManifest.id,
        outputDir: input.outputDir,
        requirement: doclingDocumentExtractorManifest.runtime
      })
      if (status.state !== 'installed') {
        throw new Error(status.diagnostics[0]?.message ?? `Docling runtime is not installed. Run: context adapters install ${doclingDocumentExtractorManifest.id}`)
      }
      const sourcePath = resolve(input.rootDir, input.entry.path)
      const tempDir = join(paths.runtimeDir, 'runs', safeSegment(input.entry.id))
      await mkdir(tempDir, { recursive: true })
      await execFileAsync(paths.executablePath, [sourcePath, '--to', 'json', '--to', 'md', '--output', tempDir], { maxBuffer: 64 * 1024 * 1024 })
      const base = basename(input.entry.path).replace(/\.[^.]+$/, '')
      const json = await readFirstJson([join(tempDir, `${base}.json`), join(tempDir, 'docling.json')])
      const markdown = await readFirstText([join(tempDir, `${base}.md`), join(tempDir, `${base}.markdown`), join(tempDir, 'docling.md')])
      return {
        json,
        markdown,
        metadata: {
          backend: 'docling-cli',
          runtimeDir: paths.runtimeDir
        }
      }
    }
  }
}

async function readFirstJson(paths: string[]): Promise<unknown> {
  for (const path of paths) {
    if (existsSync(path)) {
      return JSON.parse(await readFile(path, 'utf8'))
    }
  }
  throw new Error('Docling did not produce JSON output.')
}

async function readFirstText(paths: string[]): Promise<string> {
  for (const path of paths) {
    if (existsSync(path)) {
      return readFile(path, 'utf8')
    }
  }
  throw new Error('Docling did not produce Markdown output.')
}

function artifactDirFor(entryId: string): string {
  return `.context/extensions/${doclingDocumentExtractorManifest.id}/artifacts/${safeSegment(entryId)}`
}

function resolveContextArtifactDir(outputDir: string | undefined, artifactDir: string): string {
  if (!outputDir) {
    return artifactDir
  }
  return artifactDir.startsWith('.context/') ? join(outputDir, artifactDir.slice('.context/'.length)) : resolve(outputDir, artifactDir)
}

function parseMarkdown(content: string, path: string): { meta: Record<string, unknown>; title: string; sections: Record<string, string[]>; body: string } {
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(path)
  const sections: Record<string, string[]> = {}
  let current = ''
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/)
    if (heading) {
      current = heading[1].trim().toLowerCase()
      sections[current] = []
      continue
    }
    const item = line.match(/^\s*-\s+(.+)$/)
    if (item && current) {
      sections[current].push(item[1].trim())
    }
  }
  return { meta: { sourceAdapter: doclingDocumentExtractorManifest.id }, title, sections, body: content }
}

function doclingDiagnostic(type: string, severity: Diagnostic['severity'], message: string, path: string): Diagnostic {
  return {
    id: `DIAG-${type}-${safeSegment(path)}`,
    type,
    severity,
    message,
    relatedNodes: [],
    evidence: [],
    createdAt: new Date().toISOString(),
    properties: { adapterId: doclingDocumentExtractorManifest.id, path }
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-|-$/g, '') || 'item'
}
