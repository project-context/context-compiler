import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import matter from 'gray-matter'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type { ContextNode, ParserPlugin, SourceConfig, SourceRef } from '@context-compiler/core'

interface MdastNode {
  type: string
  depth?: number
  value?: string
  children?: MdastNode[]
}

interface MarkdownMeta {
  id?: string
  type?: string
  domain?: string
  status?: string
  owner?: string
  updatedAt?: string | Date
  sourceUri?: string
  requirementIds?: string[]
}

export function createMarkdownParserPlugin(): ParserPlugin {
  return {
    name: 'parser-markdown',
    sourceTypes: ['markdown'],
    async parse(source: SourceConfig, context): Promise<{ nodes: ContextNode[] }> {
      const root = resolve(context.rootDir, source.path)
      const files = await findMarkdownFiles(root)
      const nodes: ContextNode[] = []

      for (const file of files) {
        nodes.push(...(await parseMarkdownFile(file, source, context.rootDir)))
      }

      return { nodes }
    }
  }
}

async function parseMarkdownFile(
  filePath: string,
  source: SourceConfig,
  rootDir: string
): Promise<ContextNode[]> {
  const raw = await readFile(filePath, 'utf8')
  const fileStat = await stat(filePath)
  const parsed = matter(raw)
  const meta = parsed.data as MarkdownMeta
  const tree = unified().use(remarkParse).parse(parsed.content) as MdastNode
  const title = firstHeading(tree, 1) ?? meta.id ?? relative(rootDir, filePath)
  const baseId = meta.id ?? slugId(title)
  const sourceRef: SourceRef = {
    uri: meta.sourceUri ?? `file://${relative(rootDir, filePath)}`,
    type: source.type,
    name: source.name,
    status: meta.status,
    updatedAt: toIsoString(meta.updatedAt) ?? fileStat.mtime.toISOString(),
    ownerRole: meta.owner
  }
  const sections = sectionsByHeading(tree)
  const nodes: ContextNode[] = []

  if (meta.type !== 'test_case') {
    nodes.push({
      id: baseId,
      type: normalizeNodeType(meta.type) ?? 'requirement',
      title,
      domain: meta.domain,
      tags: [],
      source: sourceRef,
      metadata: {
        relatedApis: sectionItems(sections, 'Related APIs')
      }
    })
  }

  nodes.push(
    ...sectionItems(sections, 'Business Rules').map((item, index) => ({
      id: `${baseId}-BR-${index + 1}`,
      type: 'business_rule' as const,
      title: item,
      domain: meta.domain,
      tags: [],
      source: sourceRef,
      metadata: {
        requirementId: meta.type === 'test_case' ? undefined : baseId
      }
    }))
  )

  nodes.push(
    ...sectionItems(sections, 'Acceptance Criteria').map((item, index) => ({
      id: `${baseId}-AC-${index + 1}`,
      type: 'acceptance_criteria' as const,
      title: item,
      domain: meta.domain,
      tags: [],
      source: sourceRef,
      metadata: {
        requirementId: meta.type === 'test_case' ? undefined : baseId
      }
    }))
  )

  nodes.push(
    ...sectionItems(sections, 'Test Cases').map((item, index) => {
      const parsedItem = parseTestCaseItem(item)
      return {
        id: parsedItem.id ?? `${baseId}-TC-${index + 1}`,
        type: 'test_case' as const,
        title: parsedItem.title,
        domain: meta.domain,
        tags: [],
        source: sourceRef,
        metadata: {
          requirementIds: meta.type === 'test_case' ? meta.requirementIds ?? [] : [baseId]
        }
      }
    })
  )

  return nodes
}

async function findMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        return findMarkdownFiles(path)
      }
      return entry.isFile() && entry.name.endsWith('.md') ? [path] : []
    })
  )

  return files.flat().sort()
}

function firstHeading(tree: MdastNode, depth: number): string | undefined {
  return tree.children
    ?.filter((node) => node.type === 'heading' && node.depth === depth)
    .map(textContent)
    .find((text) => text.length > 0)
}

function sectionsByHeading(tree: MdastNode): Map<string, MdastNode[]> {
  const sections = new Map<string, MdastNode[]>()
  let current: string | undefined

  for (const node of tree.children ?? []) {
    if (node.type === 'heading' && node.depth === 2) {
      current = textContent(node)
      sections.set(current, [])
      continue
    }
    if (current) {
      sections.get(current)?.push(node)
    }
  }

  return sections
}

function sectionItems(sections: Map<string, MdastNode[]>, title: string): string[] {
  const section = sections.get(title) ?? []
  return section.flatMap((node) => {
    if (node.type !== 'list') {
      return []
    }
    return (node.children ?? []).map(textContent).filter((text) => text.length > 0)
  })
}

function parseTestCaseItem(item: string): { id?: string; title: string } {
  const match = item.match(/^([A-Z]+-[A-Z0-9-]+):\s*(.+)$/)
  if (!match) {
    return { title: item }
  }
  return { id: match[1], title: match[2] }
}

function textContent(node: MdastNode): string {
  if (typeof node.value === 'string') {
    return node.value.trim()
  }
  return (node.children ?? []).map(textContent).join(' ').replace(/\s+/g, ' ').trim()
}

function normalizeNodeType(type: string | undefined): ContextNode['type'] | undefined {
  if (!type) {
    return undefined
  }
  const normalized = type.replace(/-/g, '_')
  const allowed = new Set<ContextNode['type']>([
    'requirement',
    'business_rule',
    'acceptance_criteria',
    'design_spec',
    'api_contract',
    'test_case',
    'bug',
    'decision',
    'risk',
    'code_symbol',
    'project',
    'domain',
    'page',
    'ui_component',
    'database',
    'diagnostic'
  ])
  return allowed.has(normalized as ContextNode['type'])
    ? (normalized as ContextNode['type'])
    : undefined
}

function slugId(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase()
}

function toIsoString(value: string | Date | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
