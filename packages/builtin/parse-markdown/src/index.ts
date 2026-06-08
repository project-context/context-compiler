import { defineComponent, type ContextComponent, type ParsedArtifact } from '@context-compiler/core/sdk'

/** Parsed Markdown document shape used by downstream normalizers. */
export interface ParsedMarkdownDocument {
  meta: Record<string, unknown>
  title: string
  sections: Record<string, string[]>
  body: string
}

/** Create the default Markdown parse component. */
export function createMarkdownParseComponent(): ContextComponent {
  return defineComponent({
    manifest: {
      id: 'parse.markdown',
      stage: 'parse',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['raw-artifact:text/markdown'],
      outputs: ['parsed-artifact:markdown'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(state) {
      const parsedArtifacts: ParsedArtifact[] = state.rawArtifacts
        .filter((artifact) => artifact.mediaType === 'text/markdown')
        .map((artifact) => ({
          id: artifact.id.replace(/^raw:/, 'parsed:markdown:'),
          kind: 'parsed',
          parser: 'markdown',
          source: artifact.source,
          data: parseMarkdown(artifact.content),
          metadata: artifact.metadata
        }))
      return { parsedArtifacts }
    }
  })
}

function parseMarkdown(content: string): ParsedMarkdownDocument {
  const { meta, body } = parseFrontmatter(content)
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? String(meta.id ?? 'Markdown Document')
  const sections: Record<string, string[]> = {}
  let current = ''
  for (const line of body.split(/\r?\n/)) {
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
  return { meta, title, sections, body }
}

function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  if (!content.startsWith('---')) {
    return { meta: {}, body: content }
  }
  const end = content.indexOf('\n---', 3)
  if (end === -1) {
    return { meta: {}, body: content }
  }
  return {
    meta: parseSimpleYaml(content.slice(3, end).trim()),
    body: content.slice(end + 4).trimStart()
  }
}

function parseSimpleYaml(value: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  let currentListKey: string | undefined
  for (const line of value.split(/\r?\n/)) {
    const listItem = line.match(/^\s*-\s+(.+)$/)
    if (listItem && currentListKey) {
      const existing = Array.isArray(result[currentListKey]) ? result[currentListKey] as string[] : []
      result[currentListKey] = [...existing, listItem[1].trim()]
      continue
    }
    const pair = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/)
    if (pair) {
      currentListKey = pair[1]
      result[pair[1]] = pair[2].trim() === '' ? [] : pair[2].trim()
    }
  }
  return result
}
