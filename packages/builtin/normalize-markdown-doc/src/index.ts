import { defineComponent, type ContextComponent, type NormalizedRecord } from '@context-compiler/core/sdk'

/** Create the Markdown document normalizer. */
export function createMarkdownDocNormalizeComponent(): ContextComponent {
  return defineComponent({
    manifest: {
      id: 'normalize.markdown-doc',
      stage: 'normalize',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['parsed-artifact:markdown'],
      outputs: ['normalized-record'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(state) {
      const normalizedRecords: NormalizedRecord[] = []
      for (const artifact of state.parsedArtifacts.filter((candidate) => candidate.parser === 'markdown')) {
        const doc = artifact.data as {
          meta: Record<string, unknown>
          title: string
          sections: Record<string, string[]>
          body: string
        }
        const id = String(doc.meta.id ?? stableId(doc.title))
        const semanticType = String(doc.meta.type ?? inferType(artifact.source.uri))
        const sourceUri = typeof doc.meta.sourceUri === 'string' ? doc.meta.sourceUri : artifact.source.uri
        const source = { ...artifact.source, uri: sourceUri }
        const relatedApis = doc.sections['related apis'] ?? []
        const requirementIds = asStringArray(doc.meta.requirementIds)
        const testCases = doc.sections['test cases'] ?? []

        normalizedRecords.push({
          id,
          semanticType,
          title: doc.title,
          content: semanticType === 'test_case' ? testCases.join('\n') : doc.body,
          domain: typeof doc.meta.domain === 'string' ? doc.meta.domain : undefined,
          tags: [],
          source,
          metadata: {
            ...doc.meta,
            relatedApis,
            requirementIds,
            testCases
          }
        })

        const acceptanceCriteria = doc.sections['acceptance criteria'] ?? []
        acceptanceCriteria.forEach((criterion, index) => {
          normalizedRecords.push({
            id: `AC-${id}-${index + 1}`,
            semanticType: 'acceptance_criteria',
            title: criterion,
            content: criterion,
            domain: typeof doc.meta.domain === 'string' ? doc.meta.domain : undefined,
            tags: [],
            source,
            metadata: {
              requirementId: id
            }
          })
        })
      }
      return { normalizedRecords }
    }
  })
}

function inferType(uri: string): string {
  if (/\/README\.md$/i.test(uri)) {
    return 'document'
  }
  return uri.includes('/tests/') ? 'test_case' : 'requirement'
}

function stableId(title: string): string {
  return title.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'MARKDOWN-DOC'
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
