import { describe, expect, it } from 'vitest'
import { DEFAULT_GRAPH_INSPECT_PORT, inspectOptionsFromArgs } from './index.js'

describe('graph inspect options', () => {
  it('uses 19527 as the default inspector port', () => {
    expect(DEFAULT_GRAPH_INSPECT_PORT).toBe(19527)
    expect(inspectOptionsFromArgs([])).toMatchObject({
      host: '127.0.0.1',
      port: 19527,
      open: false
    })
  })

  it('allows --port to override the default inspector port', () => {
    expect(inspectOptionsFromArgs(['--port', '0', '--open'])).toMatchObject({
      port: 0,
      open: true
    })
    expect(inspectOptionsFromArgs(['--host', '0.0.0.0', '--port', '19528'])).toMatchObject({
      host: '0.0.0.0',
      port: 19528
    })
  })
})
