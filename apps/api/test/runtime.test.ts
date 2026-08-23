import { describe, expect, it } from 'vitest'
import { assertSupportedNodeVersion, isSupportedNodeVersion, MIN_NODE_VERSION } from '../src/runtime.js'

describe('runtime prerequisite', () => {
  it('requires Node >= 22 (the Minds SDK floor)', () => {
    expect(MIN_NODE_VERSION).toBe('22.0.0')
  })

  it('accepts modern Node versions', () => {
    expect(isSupportedNodeVersion('22.0.0')).toBe(true)
    expect(isSupportedNodeVersion('22.17.0')).toBe(true)
    expect(isSupportedNodeVersion('23.1.0')).toBe(true)
    expect(isSupportedNodeVersion('24.5.2')).toBe(true)
    // Pre-release strings still compare on the numeric parts
    expect(isSupportedNodeVersion('22.0.0-rc.1')).toBe(true)
  })

  it('rejects old Node versions', () => {
    expect(isSupportedNodeVersion('20.19.0')).toBe(false)
    expect(isSupportedNodeVersion('18.20.4')).toBe(false)
    expect(isSupportedNodeVersion('21.7.3')).toBe(false)
  })

  it('assertSupportedNodeVersion throws a clear message for old Node', () => {
    expect(() => assertSupportedNodeVersion('20.19.0')).toThrow(/requires Node\.js >= 22\.0\.0/)
    expect(() => assertSupportedNodeVersion('20.19.0')).toThrow(/20\.19\.0/)
  })

  it('assertSupportedNodeVersion passes on the running runtime', () => {
    expect(() => assertSupportedNodeVersion()).not.toThrow()
  })
})
