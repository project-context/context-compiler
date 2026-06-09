import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createAdapterRegistry } from '@context-compiler/core/graph'
import { ensureAdapterRuntimeStatus, type AdapterRuntimeStatus } from '@context-compiler/core/extensions'
import { defineComponent, type ContextComponent, type ContextSourceInventory, type ContextSourceInventoryEntry, type ContextSourceGroupKind, type Diagnostic, type DocumentExtractorAdapter, type GraphAdapterArtifact, type ParsedArtifact } from '@context-compiler/core/sdk'

export interface DocumentExtractorsParseOptions {
  documentExtractors?: DocumentExtractorAdapter[]
}

/** Execute registered document extractors against complex source inventory entries. */
export function createDocumentExtractorsParseComponent(options: DocumentExtractorsParseOptions = {}): ContextComponent {
  const registry = createAdapterRegistry({ documentExtractors: options.documentExtractors ?? [] })
  return defineComponent({
    manifest: {
      id: 'parse.document-extractors',
      stage: 'parse',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['context-source-inventory', 'document-extractor'],
      outputs: ['parsed-artifact', 'graph-adapter-artifact'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(state, context) {
      const sourceInventory = isSourceInventory(state.artifacts.sourceInventory) ? state.artifacts.sourceInventory : undefined
      if (!sourceInventory || registry.documentExtractors.length === 0) {
        return {}
      }
      const parsedArtifacts: ParsedArtifact[] = []
      const diagnostics: Diagnostic[] = []
      const documentExtractorArtifacts: GraphAdapterArtifact[] = []
      const documentExtractorRuntimeStatuses: AdapterRuntimeStatus[] = []

      for (const entry of sourceInventory.entries) {
        if (!shouldRunDocumentExtraction(entry, sourceInventory)) {
          continue
        }
        const extractors = registry.documentExtractors.filter((extractor) => extractor.manifest.mediaTypes.includes(entry.mediaType))
        if (extractors.length === 0) {
          continue
        }
        for (const extractor of extractors) {
          const runtimeStatus = await ensureAdapterRuntimeStatus({
            adapterId: extractor.manifest.id,
            outputDir: context.outputDir,
            requirement: extractor.manifest.runtime,
            onProgress: context.onProgress
          })
          documentExtractorRuntimeStatuses.push(runtimeStatus)
          if (runtimeStatus.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
            diagnostics.push(...runtimeStatus.diagnostics)
            continue
          }
          const result = await extractor.extract({
            entry,
            bytes: shouldPassBytes(entry) ? await readFile(resolve(context.rootDir, entry.path)).catch(() => undefined) : undefined,
            rootDir: context.rootDir,
            outputDir: context.outputDir,
            metadata: {
              adapterId: extractor.manifest.id,
              sourceInventoryId: entry.id,
              runtimeStatus
            }
          })
          parsedArtifacts.push(...(result.parsedArtifacts ?? []))
          diagnostics.push(...(result.diagnostics ?? []))
          documentExtractorArtifacts.push(...(result.artifacts ?? []))
        }
      }

      return {
        parsedArtifacts,
        diagnostics,
        artifacts: {
          documentExtractorArtifacts,
          documentExtractorRuntimeStatuses
        }
      }
    }
  })
}

function isSourceInventory(value: unknown): value is ContextSourceInventory {
  return Boolean(value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 'context-source-inventory.v1')
}

function shouldPassBytes(entry: ContextSourceInventoryEntry): boolean {
  return entry.sizeBytes <= 10 * 1024 * 1024
}

function shouldRunDocumentExtraction(entry: ContextSourceInventoryEntry, inventory: ContextSourceInventory): boolean {
  if (!entry.mediaType.startsWith('image/')) {
    return true
  }
  if (entry.metadata?.documentExtractor === 'docling' || entry.metadata?.extractDocument === true || entry.metadata?.documentRole === 'document') {
    return true
  }
  const group = inventory.groups
    ?.filter((candidate) => isPathInside(entry.path, candidate.path))
    .sort((a, b) => b.path.length - a.path.length)[0]
  return Boolean(group && isDocumentLikeGroup(group.kind))
}

function isDocumentLikeGroup(kind: ContextSourceGroupKind): boolean {
  return kind === 'doc_bundle' || kind === 'analysis_bundle' || kind === 'domain_area' || kind === 'design_bundle'
}

function isPathInside(path: string, parent: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedParent = normalizePath(parent)
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`)
}

function normalizePath(value: string): string {
  return value.split('\\').join('/').replace(/^\.?\//, '')
}
