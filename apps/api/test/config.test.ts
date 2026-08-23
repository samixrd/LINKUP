import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MINDS_REPLY_TIMEOUT_MS,
  MINDS_BUILDER_API_KEY_ENV,
  MINDS_MIND_ID_ENV,
  MINDS_REPLY_TIMEOUT_MS_ENV,
  loadConfig,
} from '../src/config.js'

describe('configuration hardening', () => {
  it('defaults the reply timeout when unset or blank', () => {
    expect(loadConfig({}).minds.replyTimeoutMs).toBe(DEFAULT_MINDS_REPLY_TIMEOUT_MS)
    expect(loadConfig({ [MINDS_REPLY_TIMEOUT_MS_ENV]: '' }).minds.replyTimeoutMs).toBe(
      DEFAULT_MINDS_REPLY_TIMEOUT_MS,
    )
    expect(loadConfig({ [MINDS_REPLY_TIMEOUT_MS_ENV]: '   ' }).minds.replyTimeoutMs).toBe(
      DEFAULT_MINDS_REPLY_TIMEOUT_MS,
    )
  })

  it('parses a positive integer timeout and trims surrounding whitespace', () => {
    expect(loadConfig({ [MINDS_REPLY_TIMEOUT_MS_ENV]: '5000' }).minds.replyTimeoutMs).toBe(5000)
    expect(loadConfig({ [MINDS_REPLY_TIMEOUT_MS_ENV]: ' 5000 ' }).minds.replyTimeoutMs).toBe(5000)
  })

  it('rejects malformed timeouts with a clear error naming the variable', () => {
    for (const bad of ['abc', '-1', '0', '1.5', '12,000', '1e1000']) {
      expect(() => loadConfig({ [MINDS_REPLY_TIMEOUT_MS_ENV]: bad }), bad).toThrow(
        MINDS_REPLY_TIMEOUT_MS_ENV,
      )
    }
  })

  it('never echoes unrelated env values (like the API key) in config errors', () => {
    const secret = 'sk-super-secret'
    try {
      loadConfig({ [MINDS_REPLY_TIMEOUT_MS_ENV]: 'abc', [MINDS_BUILDER_API_KEY_ENV]: secret })
      throw new Error('expected loadConfig to throw')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      expect(message).not.toContain(secret)
      expect(message).toContain(MINDS_REPLY_TIMEOUT_MS_ENV)
    }
  })

  it('trims credentials so whitespace-only values are treated as unset', () => {
    const config = loadConfig({
      [MINDS_BUILDER_API_KEY_ENV]: '   ',
      [MINDS_MIND_ID_ENV]: '\t',
    })
    expect(config.minds.builderApiKey).toBe('')
    expect(config.minds.mindId).toBe('')
  })
})
