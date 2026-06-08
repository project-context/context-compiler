import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('root context script', () => {
  it('runs the local-shop example through the real pnpm script', async () => {
    const compile = await execFileAsync('pnpm', ['context', '--cwd', 'examples/local-shop', 'compile'], {
      cwd: process.cwd()
    })

    expect(compile.stdout).toContain('Compiled')

    const query = await execFileAsync('pnpm', ['context', '--cwd', 'examples/local-shop', 'query', 'refund'], {
      cwd: process.cwd()
    })

    expect(query.stdout).toContain('REQ-ORDER-REFUND-001')
  }, 15000)
})
