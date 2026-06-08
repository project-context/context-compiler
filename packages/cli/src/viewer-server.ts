import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'
import { buildGraphViewerOverview, expandGraphTarget, explainGraphFact, getGraphScopeView, getLayeredSourceTrace, inspectGraphViewerTarget, searchGraphViewer } from '@context-compiler/core/runtime'

export interface ContextViewerServerOptions {
  outputDir: string
  viewerDistDir: string
  host?: string
  port?: number
}

export interface ContextViewerServerHandle {
  url: string
  host: string
  port: number
  close(): Promise<void>
}

export interface ContextViewerApiResult {
  status: number
  body: unknown
}

export async function startContextViewerServer(options: ContextViewerServerOptions): Promise<ContextViewerServerHandle> {
  await assertReadableFile(join(options.outputDir, 'manifest.json'), 'Compiled context manifest is missing. Run `context compile` before `context graph inspect`.')
  await assertReadableFile(join(options.viewerDistDir, 'index.html'), 'Graph inspector viewer assets are missing. Run `pnpm --filter @context-compiler/viewer build` first.')
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 0
  const server = createServer((request, response) => {
    void handleViewerRequest(request, response, options).catch((error) => writeJson(response, 500, {
      error: error instanceof Error ? error.message : String(error)
    }))
  })
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(port, host, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  const address = server.address()
  const resolvedPort = typeof address === 'object' && address ? address.port : port
  return {
    url: `http://${host}:${resolvedPort}`,
    host,
    port: resolvedPort,
    close: () => new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()))
  }
}

async function handleViewerRequest(request: IncomingMessage, response: ServerResponse, options: ContextViewerServerOptions): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://context-viewer.local')
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    writeJson(response, 405, { error: 'Method not allowed' })
    return
  }
  if (url.pathname.startsWith('/api/')) {
    await handleApiRequest(url, response, options.outputDir)
    return
  }
  await serveStatic(url.pathname, response, options.viewerDistDir)
}

async function handleApiRequest(url: URL, response: ServerResponse, outputDir: string): Promise<void> {
  const path = url.pathname
  const result = await readContextViewerApi(url, outputDir)
  writeJson(response, result.status, result.body)
}

export async function readContextViewerApi(url: URL, outputDir: string): Promise<ContextViewerApiResult> {
  const path = url.pathname
  if (path === '/api/manifest') {
    return { status: 200, body: JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8')) as unknown }
  }
  if (path === '/api/graph/overview') {
    return { status: 200, body: await buildGraphViewerOverview({
      outputDir,
      limitNodes: numberQuery(url, 'limitNodes'),
      limitEdges: numberQuery(url, 'limitEdges')
    }) }
  }
  if (path.startsWith('/api/scopes/')) {
    return { status: 200, body: await getGraphScopeView({
      outputDir,
      scopeId: decodePathParam(path.slice('/api/scopes/'.length)),
      limitNodes: numberQuery(url, 'limitNodes'),
      limitEdges: numberQuery(url, 'limitEdges'),
      limitChildScopes: numberQuery(url, 'limitChildScopes'),
      limitSourceRefs: numberQuery(url, 'limitSourceRefs'),
      limitEvidence: numberQuery(url, 'limitEvidence')
    }) }
  }
  if (path.startsWith('/api/expand/')) {
    return { status: 200, body: await expandGraphTarget({
      outputDir,
      targetId: decodePathParam(path.slice('/api/expand/'.length)),
      depth: numberQuery(url, 'depth'),
      limitNodes: numberQuery(url, 'limitNodes'),
      limitEdges: numberQuery(url, 'limitEdges'),
      limitChildScopes: numberQuery(url, 'limitChildScopes'),
      limitSourceRefs: numberQuery(url, 'limitSourceRefs'),
      limitEvidence: numberQuery(url, 'limitEvidence')
    }) }
  }
  if (path.startsWith('/api/trace/')) {
    return { status: 200, body: await getLayeredSourceTrace({
      outputDir,
      factId: decodePathParam(path.slice('/api/trace/'.length)),
      limitSources: numberQuery(url, 'limitSources')
    }) }
  }
  if (path.startsWith('/api/explain/')) {
    return { status: 200, body: await explainGraphFact({
      outputDir,
      factId: decodePathParam(path.slice('/api/explain/'.length)),
      limitSources: numberQuery(url, 'limitSources')
    }) }
  }
  if (path.startsWith('/api/inspect/')) {
    return { status: 200, body: await inspectGraphViewerTarget({
      outputDir,
      targetId: decodePathParam(path.slice('/api/inspect/'.length))
    }) }
  }
  if (path === '/api/search') {
    return { status: 200, body: await searchGraphViewer({
      outputDir,
      query: url.searchParams.get('q') ?? '',
      scopeId: url.searchParams.get('scopeId') ?? undefined,
      limit: numberQuery(url, 'limit')
    }) }
  }
  return { status: 404, body: { error: 'API route not found' } }
}

async function serveStatic(pathname: string, response: ServerResponse, viewerDistDir: string): Promise<void> {
  const filePath = resolveContextViewerStaticPath(viewerDistDir, pathname)
  if (!filePath) {
    writeJson(response, 404, { error: 'Not found' })
    return
  }
  const resolvedPath = await existingFile(filePath) ?? (await existingFile(join(viewerDistDir, 'index.html')))
  if (!resolvedPath) {
    writeJson(response, 404, { error: 'Not found' })
    return
  }
  response.writeHead(200, {
    'content-type': contentType(resolvedPath),
    'cache-control': basename(resolvedPath) === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable'
  })
  response.end(await readFile(resolvedPath))
}

export function resolveContextViewerStaticPath(root: string, pathname: string): string | undefined {
  let decoded = '/'
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  const relativePath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  if (relativePath.split('/').includes('..')) {
    return undefined
  }
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(resolvedRoot, relativePath)
  const rel = relative(resolvedRoot, resolvedPath)
  return rel.startsWith('..') || rel === '' ? (decoded === '/' ? join(resolvedRoot, 'index.html') : undefined) : resolvedPath
}

async function existingFile(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path)
    return info.isFile() ? path : undefined
  } catch {
    return undefined
  }
}

async function assertReadableFile(path: string, message: string): Promise<void> {
  if (!await existingFile(path)) {
    throw new Error(message)
  }
}

function numberQuery(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name)
  if (!raw) return undefined
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function decodePathParam(value: string): string {
  return decodeURIComponent(value)
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(`${JSON.stringify(value, null, 2)}\n`)
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.json':
      return 'application/json; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}
