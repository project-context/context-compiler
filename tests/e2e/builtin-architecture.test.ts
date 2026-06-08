import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createBuiltinLocalDistribution } from '@context-compiler/builtin-local'
import { compileProject } from '@context-compiler/cli'

describe('builtin source-first architecture', () => {
  it('uses packages/builtin as the default compile distribution entrypoint', () => {
    const distribution = createBuiltinLocalDistribution()

    expect(distribution.id).toBe('@context-compiler/builtin-local')
    expect(distribution.metadata).toMatchObject({
      architecture: 'source-first-graph-of-graphs'
    })
    expect(distribution.components.map((component) => component.manifest.id)).toEqual(
      expect.arrayContaining(['ingest.local-files', 'emit.files'])
    )
  })

  it('CLI project compile imports the builtin distribution entrypoint', async () => {
    expect(compileProject.toString()).toContain('createBuiltinLocalDistribution')
  })

  it('does not expose legacy component packages outside builtin', async () => {
    const rootDir = process.cwd()
    await expect(access(join(rootDir, 'packages', 'components'))).rejects.toThrow()

    const workspace = await readFile(join(rootDir, 'pnpm-workspace.yaml'), 'utf8')
    const tsconfig = await readFile(join(rootDir, 'tsconfig.json'), 'utf8')
    const vitest = await readFile(join(rootDir, 'vitest.config.ts'), 'utf8')
    const loader = await readFile(join(rootDir, 'scripts', 'ts-loader.mjs'), 'utf8')
    const combined = [workspace, tsconfig, vitest, loader].join('\n')

    expect(combined).not.toContain('packages/components')
    expect(combined).not.toContain('@context-compiler/ingest-local-files')
    expect(combined).not.toContain('@context-compiler/emit-files')
  })

  it('documents the Super Data Network end state as the architecture north star', async () => {
    const rootDir = process.cwd()
    const goal = await readFile(join(rootDir, 'docs', 'architecture', 'super-data-network-goal.md'), 'utf8')
    const readme = await readFile(join(rootDir, 'README.md'), 'utf8')
    const pipeline = await readFile(join(rootDir, 'docs', 'architecture', 'pipeline-architecture.md'), 'utf8')

    expect(goal).toContain('## Key Architecture')
    expect(goal).toContain('### L0 Package Map')
    expect(goal).toContain('### L1 SourceGroup Map')
    expect(goal).toContain('### L2 Local Graphs')
    expect(goal).toContain('### L3 Semantic Supergraph')
    expect(goal).toContain('## Meta Layer')
    expect(goal).toContain('Claim is the recommended L3 semantic unit')
    expect(goal).toContain('Structural relations')
    expect(goal).toContain('Semantic relations')
    expect(goal).toContain('Correction relations')
    expect(goal).toContain('answer -> L3 claim -> L2 local graph node -> L1 source group -> L0 package -> original source')
    expect(goal).toContain('### P1 Package-First Query Experience')
    expect(goal).toContain('### P2 Correction Loop')
    expect(goal).toContain('### P3 L3 Claim Graph')
    expect(goal).toContain('### P4 Task Views')
    expect(goal).toContain('### P5 Continuous Convergence')
    expect(goal).toContain('human-agent co-query')

    expect(readme).toContain('4-layer query interface plus evidence, correction, revision, and permission control layers')
    expect(pipeline).toContain('L0/L1/L2/L3')
    expect(pipeline).toContain('Meta Layer')
  })
})
