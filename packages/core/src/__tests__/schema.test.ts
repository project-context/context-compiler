import { describe, expect, it } from 'vitest'
import { ContextNodeSchema } from '../index.js'

describe('ContextNodeSchema', () => {
  it('returns clear validation errors for invalid nodes', () => {
    const parsed = ContextNodeSchema.safeParse({
      id: 'REQ-ORDER-REFUND-001',
      type: 'requirement'
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.path.join('.'))).toContain('title')
      expect(parsed.error.issues.map((issue) => issue.path.join('.'))).toContain('source')
    }
  })
})
