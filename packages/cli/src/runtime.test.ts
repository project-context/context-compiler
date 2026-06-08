import { describe, expect, it } from 'vitest'
import { createRuntime } from './runtime.js'

describe('CLI runtime', () => {
  it('buffers output while optionally streaming chunks to caller sinks', () => {
    const stdout: string[] = []
    const stderr: string[] = []
    const runtime = createRuntime({
      stream: true,
      stdout: (chunk) => stdout.push(chunk),
      stderr: (chunk) => stderr.push(chunk)
    })

    runtime.writeOut('hello')
    runtime.writeErr('warn')

    expect(runtime.result()).toMatchObject({
      stdout: 'hello',
      stderr: 'warn'
    })
    expect(stdout).toEqual(['hello'])
    expect(stderr).toEqual(['warn'])
  })
})
