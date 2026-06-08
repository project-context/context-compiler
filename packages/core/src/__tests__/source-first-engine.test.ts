import { describe, expect, it } from 'vitest'
import { SOURCE_FIRST_ENGINE_PHASES, SourceFirstCompileEngine, compileContextProject } from '@context-compiler/core/compiler'

describe('source-first compile engine', () => {
  it('declares the Graph-of-Graphs compile phases as the SDK compile entry model', () => {
    expect(SOURCE_FIRST_ENGINE_PHASES).toEqual([
      'inventory',
      'triage',
      'agent-plan',
      'scope-build',
      'normalize-link-validate-govern',
      'materialize'
    ])
    expect(new SourceFirstCompileEngine()).toBeInstanceOf(SourceFirstCompileEngine)
    expect(compileContextProject.toString()).toContain('SourceFirstCompileEngine')
  })
})
