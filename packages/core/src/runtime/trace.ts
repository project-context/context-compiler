import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
  ContextRuntimeTraceEvent,
  ContextSourceInventory,
  ContextSourceFingerprint,
  Diagnostic,
  RawArtifact
} from '../contracts/index.js'

export interface ContextFingerprintCheck {
  status: 'fresh' | 'stale'
  stale: ContextSourceFingerprint[]
}

/** Build stable source fingerprints from ingested raw artifacts. */
export function buildSourceFingerprints(rawArtifacts: RawArtifact[]): ContextSourceFingerprint[] {
  return rawArtifacts.map((artifact) => ({
    id: `FP-${sha256(artifact.source.uri).slice(0, 12)}`,
    source: artifact.source,
    algorithm: 'sha256',
    hash: sha256(artifact.content),
    sizeBytes: Buffer.byteLength(artifact.content, 'utf8')
  }))
}

/** Build stable source fingerprints from the full source inventory. */
export function buildSourceFingerprintsFromInventory(inventory: ContextSourceInventory): ContextSourceFingerprint[] {
  return inventory.entries.map((entry) => ({
    id: `FP-${sha256(entry.sourceRef.uri).slice(0, 12)}`,
    source: entry.sourceRef,
    algorithm: 'sha256',
    hash: entry.hash,
    sizeBytes: entry.sizeBytes
  }))
}

/** Build one append-only runtime trace event for a compiler run. */
export function buildRuntimeTraceEvent(options: {
  pipeline: string
  components?: string[]
  sourceFingerprints: ContextSourceFingerprint[]
  diagnostics: Diagnostic[]
  emittedArtifacts: string[]
  generatedAt?: string
}): ContextRuntimeTraceEvent {
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  return {
    schemaVersion: 'context-runtime-trace.v1',
    id: `TRACE-${sha256(`${options.pipeline}:${generatedAt}:${options.sourceFingerprints.map((fingerprint) => fingerprint.hash).join(':')}`).slice(0, 16)}`,
    event: 'compile',
    generatedAt,
    pipeline: options.pipeline,
    components: options.components ?? [],
    sourceFingerprints: options.sourceFingerprints,
    diagnostics: options.diagnostics,
    emittedArtifacts: options.emittedArtifacts,
    metadata: {}
  }
}

/** Compare persisted fingerprints against current source files. */
export async function checkSourceFingerprints(rootDir: string, fingerprints: ContextSourceFingerprint[]): Promise<ContextFingerprintCheck> {
  const stale: ContextSourceFingerprint[] = []
  for (const fingerprint of fingerprints) {
    const path = filePathForSource(rootDir, fingerprint.source.uri)
    if (!path) {
      continue
    }
    try {
      const content = await readFile(path)
      if (sha256(content) !== fingerprint.hash) {
        stale.push(fingerprint)
      }
    } catch {
      stale.push(fingerprint)
    }
  }
  return { status: stale.length > 0 ? 'stale' : 'fresh', stale }
}

function filePathForSource(rootDir: string, uri: string): string | undefined {
  if (!uri.startsWith('file://')) {
    return undefined
  }
  const value = uri.slice('file://'.length)
  return resolve(rootDir, value)
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
