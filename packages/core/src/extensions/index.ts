import type {
  AdapterRuntimeCommand,
  AdapterRuntimeEcosystem,
  AdapterRuntimeInstallPlan,
  AdapterRuntimeMode,
  AdapterRuntimeRequirement,
  AdapterRuntimeState,
  AdapterRuntimeStatus,
  ContextExtensionAdapterBinding,
  ContextExtensionAdapterKind,
  ContextExtensionCategory,
  ContextExtensionManifest,
  ContextProgressEvent,
  ContextProgressReporter,
  DocumentExtractorAdapterManifest,
  GraphAdapterManifest,
  SourceParserAdapterManifest
} from '../contracts/adapters.js'
import type {
  Diagnostic
} from '../contracts/graph.js'

export * from './runtime-manager.js'
export type {
  AdapterRuntimeCommand,
  AdapterRuntimeEcosystem,
  AdapterRuntimeInstallPlan,
  AdapterRuntimeMode,
  AdapterRuntimeRequirement,
  AdapterRuntimeState,
  AdapterRuntimeStatus,
  ContextExtensionAdapterBinding,
  ContextExtensionAdapterKind,
  ContextExtensionCategory,
  ContextExtensionManifest,
  ContextProgressEvent,
  ContextProgressReporter,
  DocumentExtractorAdapterManifest,
  GraphAdapterManifest,
  SourceParserAdapterManifest
} from '../contracts/adapters.js'

const EXTENSION_CATEGORIES = new Set<ContextExtensionCategory>(['document', 'knowledge', 'code', 'runtime', 'source', 'custom'])
const ADAPTER_KINDS = new Set<ContextExtensionAdapterKind>(['source-parser', 'document-extractor', 'graph-adapter'])

/** Preserve a typed extension manifest while keeping extension packages dependency-light. */
export function defineContextExtension<T extends ContextExtensionManifest>(manifest: T): T {
  return manifest
}

/** Validate a package-level extension manifest before it is registered by a distribution. */
export function validateContextExtensionManifest(manifest: ContextExtensionManifest): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  if (!nonEmpty(manifest.id)) {
    diagnostics.push(extensionDiagnostic('id', 'Context extension manifest must declare a stable id.'))
  }
  if (!nonEmpty(manifest.title)) {
    diagnostics.push(extensionDiagnostic('title', `Context extension "${manifest.id || 'unknown'}" must declare a title.`))
  }
  if (!nonEmpty(manifest.version)) {
    diagnostics.push(extensionDiagnostic('version', `Context extension "${manifest.id || 'unknown'}" must declare a version.`))
  }
  if (manifest.schemaVersion !== 'context-extension.v1') {
    diagnostics.push(extensionDiagnostic('schemaVersion', `Context extension "${manifest.id || 'unknown'}" must use schemaVersion context-extension.v1.`))
  }
  if (!EXTENSION_CATEGORIES.has(manifest.category)) {
    diagnostics.push(extensionDiagnostic('category', `Context extension "${manifest.id || 'unknown'}" declares an unsupported category.`))
  }
  if (manifest.adapters.length === 0) {
    diagnostics.push(extensionDiagnostic('adapters', `Context extension "${manifest.id || 'unknown'}" must declare at least one adapter.`))
  }
  for (const adapter of manifest.adapters) {
    diagnostics.push(...validateAdapterBinding(manifest.id || 'unknown', adapter))
  }
  return diagnostics
}

export function contextExtensionAdapterIds(manifest: ContextExtensionManifest): string[] {
  return manifest.adapters.map((adapter) => adapter.manifest.id)
}

function validateAdapterBinding(extensionId: string, adapter: ContextExtensionAdapterBinding): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  if (!ADAPTER_KINDS.has(adapter.kind)) {
    diagnostics.push(extensionDiagnostic('adapter.kind', `Context extension "${extensionId}" declares an unsupported adapter kind.`))
  }
  if (!adapter.manifest || !nonEmpty(adapter.manifest.id)) {
    diagnostics.push(extensionDiagnostic('adapter.id', `Context extension "${extensionId}" adapter must declare a stable id.`))
  }
  if (!adapter.manifest || !nonEmpty(adapter.manifest.title)) {
    diagnostics.push(extensionDiagnostic('adapter.title', `Context extension "${extensionId}" adapter must declare a title.`))
  }
  if (!adapter.manifest || !nonEmpty(adapter.manifest.version)) {
    diagnostics.push(extensionDiagnostic('adapter.version', `Context extension "${extensionId}" adapter must declare a version.`))
  }
  if (!adapter.manifest || adapter.manifest.outputs.length === 0) {
    diagnostics.push(extensionDiagnostic('adapter.outputs', `Context extension "${extensionId}" adapter must declare outputs.`))
  }
  return diagnostics
}

function extensionDiagnostic(field: string, message: string): Diagnostic {
  return {
    id: `DIAG-context-extension-invalid-${field.replace(/[^A-Za-z0-9_.:-]+/g, '-')}`,
    type: 'context-extension.invalid-manifest',
    severity: 'error',
    message,
    relatedNodes: [],
    evidence: [],
    createdAt: new Date().toISOString(),
    properties: { field }
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
