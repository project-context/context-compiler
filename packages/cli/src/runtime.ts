/** Options for running the CLI in tests or as a binary. */
export interface RunCliOptions {
  cwd?: string
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
    },
    writeErr(message) {
      stderr += message
    },
    result() {
      return { stdout, stderr, exitCode: this.exitCode }
    }
  }
}
