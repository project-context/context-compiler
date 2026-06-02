import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import type { ContextProjectConfig } from './config.js'

export interface ProjectInventoryOptions {
  rootDir: string
  config?: ContextProjectConfig
}

export interface ProjectInventory {
  project: string
  rootDir: string
  generatedAt: string
  languages: InventoryLanguage[]
  buildSystems: InventoryBuildSystem[]
  modules: InventoryModule[]
  files: InventoryFile[]
  testPaths: InventoryPath[]
  docPaths: InventoryPath[]
  apiFiles: InventoryPath[]
}

export interface InventoryLanguage {
  name: string
  files: number
  bytes: number
}

export interface InventoryBuildSystem {
  type: string
  path: string
}

export interface InventoryModule {
  id: string
  name: string
  path: string
  buildSystem?: string
  languages: string[]
}

export interface InventoryFile {
  path: string
  language?: string
  bytes: number
  moduleId?: string
}

export interface InventoryPath {
  path: string
  kind: string
}

const SKIP_DIRS = new Set([
  '.git',
  '.context',
  'node_modules',
  'dist',
  'build',
  'target',
  'coverage',
  '.turbo',
  '.next',
  '.venv',
  'venv'
])

const LANGUAGE_BY_EXTENSION = new Map<string, string>([
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.py', 'python'],
  ['.go', 'go'],
  ['.rs', 'rust'],
  ['.c', 'c'],
  ['.h', 'c'],
  ['.cpp', 'cpp'],
  ['.cc', 'cpp'],
  ['.cxx', 'cpp'],
  ['.hpp', 'cpp'],
  ['.hh', 'cpp'],
  ['.java', 'java'],
  ['.kt', 'kotlin'],
  ['.kts', 'kotlin']
])

const BUILD_MARKERS: Array<{ file: string; type: string }> = [
  { file: 'package.json', type: 'npm' },
  { file: 'pnpm-workspace.yaml', type: 'pnpm' },
  { file: 'pyproject.toml', type: 'python' },
  { file: 'setup.py', type: 'python' },
  { file: 'requirements.txt', type: 'python' },
  { file: 'go.mod', type: 'go' },
  { file: 'Cargo.toml', type: 'cargo' },
  { file: 'CMakeLists.txt', type: 'cmake' },
  { file: 'Makefile', type: 'make' },
  { file: 'pom.xml', type: 'maven' },
  { file: 'build.gradle', type: 'gradle' },
  { file: 'build.gradle.kts', type: 'gradle' }
]

export async function discoverProjectInventory(
  options: ProjectInventoryOptions
): Promise<ProjectInventory> {
  const rootDir = resolve(options.rootDir)
  const project = options.config?.project.name ?? basename(rootDir)
  const files: InventoryFile[] = []
  const buildSystems: InventoryBuildSystem[] = []
  const testPathMap = new Map<string, InventoryPath>()
  const docPathMap = new Map<string, InventoryPath>()
  const apiFileMap = new Map<string, InventoryPath>()

  await walk(rootDir, async (absolutePath, entryKind) => {
    const path = toProjectPath(rootDir, absolutePath)
    const name = basename(absolutePath)

    if (entryKind === 'directory') {
      if (['docs', 'doc', 'documentation'].includes(name.toLowerCase())) {
        docPathMap.set(path, { path, kind: 'docs' })
      }
      if (['test', 'tests', '__tests__'].includes(name.toLowerCase())) {
        testPathMap.set(path, { path, kind: 'test_directory' })
      }
      return
    }

    const fileStat = await stat(absolutePath)
    const language = languageForPath(path)
    files.push({ path, language, bytes: fileStat.size })

    const buildMarker = BUILD_MARKERS.find((marker) => marker.file === name)
    if (buildMarker) {
      buildSystems.push({ type: buildMarker.type, path })
    }

    if (isTestFile(path)) {
      testPathMap.set(path, { path, kind: 'test_file' })
    }
    if (isApiFile(path)) {
      apiFileMap.set(path, { path, kind: 'openapi' })
    }
  })

  const modules = buildModules(rootDir, buildSystems, files)
  const moduleByPath = modules
    .filter((module) => module.path !== '.')
    .sort((left, right) => right.path.length - left.path.length)

  for (const file of files) {
    file.moduleId = moduleByPath.find(
      (module) => file.path === module.path || file.path.startsWith(`${module.path}/`)
    )?.id ?? modules.find((module) => module.path === '.')?.id
  }

  for (const module of modules) {
    module.languages = unique(
      files
        .filter((file) => file.moduleId === module.id)
        .map((file) => file.language)
        .filter((language): language is string => Boolean(language))
    )
  }

  return {
    project,
    rootDir,
    generatedAt: new Date().toISOString(),
    languages: languageStats(files),
    buildSystems: uniqueBy(buildSystems, (buildSystem) => `${buildSystem.type}:${buildSystem.path}`),
    modules,
    files,
    testPaths: [...testPathMap.values()].sort(comparePath),
    docPaths: [...docPathMap.values()].sort(comparePath),
    apiFiles: [...apiFileMap.values()].sort(comparePath)
  }
}

export async function writeInventoryFile(
  inventory: ProjectInventory,
  outputDir: string
): Promise<void> {
  await mkdir(outputDir, { recursive: true })
  await writeFile(join(outputDir, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n')
}

export async function readInventoryFile(outputDir: string): Promise<ProjectInventory> {
  return JSON.parse(await readFile(join(outputDir, 'inventory.json'), 'utf8')) as ProjectInventory
}

async function walk(
  dir: string,
  visitor: (absolutePath: string, entryKind: 'file' | 'directory') => Promise<void>
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) {
      continue
    }

    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      await visitor(path, 'directory')
      await walk(path, visitor)
      continue
    }
    if (entry.isFile()) {
      await visitor(path, 'file')
    }
  }
}

function buildModules(
  rootDir: string,
  buildSystems: InventoryBuildSystem[],
  files: InventoryFile[]
): InventoryModule[] {
  const modules = new Map<string, InventoryModule>()

  for (const buildSystem of buildSystems) {
    const modulePath = dirname(buildSystem.path) === '.' ? '.' : dirname(buildSystem.path)
    modules.set(modulePath, {
      id: moduleId(modulePath),
      name: modulePath === '.' ? basename(rootDir) : basename(modulePath),
      path: modulePath,
      buildSystem: buildSystem.type,
      languages: []
    })
  }

  if (!modules.has('.')) {
    modules.set('.', {
      id: 'MODULE-root',
      name: basename(rootDir),
      path: '.',
      languages: []
    })
  }

  for (const file of files) {
    const parent = dirname(file.path)
    if (parent !== '.' && !modules.has(parent) && isLikelyStandaloneModule(parent)) {
      modules.set(parent, {
        id: moduleId(parent),
        name: basename(parent),
        path: parent,
        languages: []
      })
    }
  }

  return [...modules.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function languageStats(files: InventoryFile[]): InventoryLanguage[] {
  const stats = new Map<string, InventoryLanguage>()
  for (const file of files) {
    if (!file.language) {
      continue
    }
    const current = stats.get(file.language) ?? { name: file.language, files: 0, bytes: 0 }
    current.files += 1
    current.bytes += file.bytes
    stats.set(file.language, current)
  }
  return [...stats.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function languageForPath(path: string): string | undefined {
  const extension = path.match(/\.[^.]+$/)?.[0]
  return extension ? LANGUAGE_BY_EXTENSION.get(extension) : undefined
}

function isApiFile(path: string): boolean {
  return /(^|\/)(openapi|swagger)\.(ya?ml|json)$/i.test(path)
}

function isTestFile(path: string): boolean {
  return /(\.test\.[jt]sx?|\.spec\.[jt]sx?|_test\.go|(^|\/)test_[^/]+\.py|_test\.rs)$/i.test(path)
}

function isLikelyStandaloneModule(path: string): boolean {
  const parts = path.split('/')
  return parts.length === 2 && ['apps', 'packages', 'services', 'crates'].includes(parts[0]!)
}

function moduleId(path: string): string {
  return `MODULE-${slug(path === '.' ? 'root' : path)}`
}

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function toProjectPath(rootDir: string, absolutePath: string): string {
  const path = relative(rootDir, absolutePath).split('\\').join('/')
  return path.length === 0 ? '.' : path
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()]
}

function comparePath(left: InventoryPath, right: InventoryPath): number {
  return left.path.localeCompare(right.path)
}

