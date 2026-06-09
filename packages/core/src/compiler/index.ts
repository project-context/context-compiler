import { SourceFirstCompileEngine } from '../engine/index.js'
import type { CompileProjectOptions, CompileProjectResult } from '../contracts/pipeline.js'

export type { CompileProjectOptions, CompileProjectResult } from '../contracts/pipeline.js'
export * from '../engine/index.js'

/** Compile a workspace through the source-first Graph-of-Graphs engine. */
export async function compileContextProject(options: CompileProjectOptions): Promise<CompileProjectResult> {
  return new SourceFirstCompileEngine().compile(options)
}
