import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('root context script', () => {
  it('runs the local-shop example through the real pnpm script', async () => {
    const env = { ...process.env, CONTEXT_GRAPHRAG_RUNTIME: 'mock' }
    const compile = await execFileAsync('pnpm', ['context', '--cwd', 'examples/local-shop', 'compile'], {
      cwd: process.cwd(),
      env
    })

    expect(compile.stdout).toContain('Compiled')

    const query = await execFileAsync('pnpm', ['context', '--cwd', 'examples/local-shop', 'query', 'refund'], {
      cwd: process.cwd(),
      env
    })

    expect(query.stdout).toContain('REQ-ORDER-REFUND-001')
  }, 90000)
})
