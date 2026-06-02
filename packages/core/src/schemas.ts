import { z } from 'zod'

export const ContextNodeTypeSchema = z.enum([
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

export const SourceRefSchema = z
  .object({
    uri: z.string().min(1),
    type: z.string().min(1),
    name: z.string().optional(),
    status: z.string().optional(),
    author: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
    confidence: z.number().min(0).max(1).optional(),
    authorityLevel: z.string().optional(),
    ownerRole: z.string().optional()
  })
  .passthrough()

export const ContextNodeSchema = z.object({
  id: z.string().min(1),
  type: ContextNodeTypeSchema,
  title: z.string().min(1),
  content: z.string().optional(),
  domain: z.string().optional(),
  tags: z.array(z.string()).default([]),
  source: SourceRefSchema,
  metadata: z.record(z.unknown()).default({})
})

export const ContextEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.string().min(1),
  source: SourceRefSchema.optional(),
  metadata: z.record(z.unknown()).default({})
})

export const DiagnosticSeveritySchema = z.enum(['info', 'warning', 'error'])

export const DiagnosticSchema = z.object({
  id: z.string().min(1),
  severity: DiagnosticSeveritySchema,
  code: z.string().min(1),
  message: z.string().min(1),
  nodeId: z.string().optional(),
  source: SourceRefSchema.optional(),
  metadata: z.record(z.unknown()).default({})
})

export const ContextGraphSchema = z.object({
  nodes: z.array(ContextNodeSchema),
  edges: z.array(ContextEdgeSchema),
  diagnostics: z.array(DiagnosticSchema).default([])
})

export type ContextNodeType = z.infer<typeof ContextNodeTypeSchema>
export type SourceRef = z.infer<typeof SourceRefSchema>
export type ContextNode = z.infer<typeof ContextNodeSchema>
export type ContextEdge = z.infer<typeof ContextEdgeSchema>
export type Diagnostic = z.infer<typeof DiagnosticSchema>
export type DiagnosticSeverity = z.infer<typeof DiagnosticSeveritySchema>
export type ContextGraph = z.infer<typeof ContextGraphSchema>

