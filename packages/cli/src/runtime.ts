/** Options for running the CLI in tests or as a binary. */
export interface RunCliOptions {
  cwd?: string
  progress?: boolean
  progressStyle?: 'log' | 'bar'
  stream?: boolean
  stdout?: (chunk: string) => void
  stderr?: (chunk: string) => void
}

/** Buffered CLI result returned by `runCli`. */
export interface RunCliResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Minimal runtime abstraction that keeps command code testable. */
export interface CliRuntime {
  cwd: string
  exitCode: number
  writeOut(message: string): void
  writeErr(message: string): void
  result(): RunCliResult
}

/** Create a buffered CLI runtime. */
export function createRuntime(options: RunCliOptions = {}): CliRuntime {
  let stdout = ''
  let stderr = ''
  return {
    cwd: options.cwd ?? process.cwd(),
    exitCode: 0,
    writeOut(message) {
      stdout += message
      if (options.stream) {
        options.stdout?.(message)
      }
    },
    writeErr(message) {
      stderr += message
      if (options.stream) {
        options.stderr?.(message)
      }
    },
    result() {
      return { stdout, stderr, exitCode: this.exitCode }
    }
  }
}
