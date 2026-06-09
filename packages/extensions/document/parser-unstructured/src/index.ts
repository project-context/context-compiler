import { defineContextExtension } from '@context-compiler/core/extensions'
import { type Diagnostic, type DocumentExtractionInput, type DocumentExtractionResult, type DocumentExtractorAdapter, type DocumentExtractorAdapterManifest } from '@context-compiler/core/sdk'

export const unstructuredDocumentExtractorManifest: DocumentExtractorAdapterManifest = {
  id: 'unstructured.document-extractor',
  title: 'Unstructured document extractor',
  version: '0.1.0',
  mediaTypes: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ],
  outputs: ['ParsedArtifact', 'GraphAdapterArtifact'],
  deterministic: true,
  requiresNetwork: false,
  stability: 'development',
  externalProjects: ['Unstructured']
}

export const unstructuredExtension = defineContextExtension({
  schemaVersion: 'context-extension.v1',
  id: 'extension.parser-unstructured',
  title: 'Unstructured parser extension',
  version: '0.1.0',
  category: 'document',
  stability: 'development',
  adapters: [{ kind: 'document-extractor', manifest: unstructuredDocumentExtractorManifest }],
  externalProjects: ['Unstructured']
})

export function createUnstructuredDocumentExtractorAdapter(): DocumentExtractorAdapter {
  return {
    manifest: unstructuredDocumentExtractorManifest,
    async extract(input: DocumentExtractionInput): Promise<DocumentExtractionResult> {
      return {
        parsedArtifacts: [],
        diagnostics: [notConfiguredDiagnostic(unstructuredDocumentExtractorManifest.id, input.entry.path)]
      }
    }
  }
}

function notConfiguredDiagnostic(adapterId: string, path: string): Diagnostic {
  return {
    id: `DIAG-${adapterId}-not-configured`,
    type: 'extension.adapter.not-configured',
    severity: 'warning',
    message: `${adapterId} is declared but no Unstructured runtime is configured for ${path}.`,
    relatedNodes: [],
    evidence: [],
    createdAt: new Date().toISOString(),
    properties: { adapterId, path }
  }
}
