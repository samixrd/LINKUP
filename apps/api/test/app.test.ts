import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCreatorProfile, createDatabase, migrate } from '@linkup/db'
import { createApp, jsonErrorHandler } from '../src/app.js'

describe('API error handling', () => {
  const db = createDatabase(':memory:')
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    migrate(db)
    createCreatorProfile(db, { creatorId: 'err_a', displayName: 'Err Ada' })
    server = createApp({ db }).listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => {
    server.close()
    db.close()
  })

  it('malformed JSON body → 400 JSON error, never HTML', async () => {
    const res = await fetch(`${baseUrl}/api/creators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type') ?? '').toContain('application/json')
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('request body must be valid JSON')
  })

  it('oversized JSON body → 413 JSON error', async () => {
    const res = await fetch(`${baseUrl}/api/creators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ big: 'x'.repeat(200 * 1024) }),
    })
    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('request body too large')
  })

  it('health endpoint still works through the middleware stack', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    expect(res.status).toBe(200)
  })
})

describe('terminal error handler', () => {
  it('masks unexpected errors as generic 500 JSON without internals', async () => {
    const app = express()
    app.get('/boom', () => {
      throw new Error('secret internal detail with password 123')
    })
    app.use(jsonErrorHandler)
    const server = app.listen(0)
    await new Promise<void>((r) => server.once('listening', r))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    const res = await fetch(`${base}/boom`)
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type') ?? '').toContain('application/json')
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('internal server error')
    expect(body.error).not.toContain('secret')
    expect(body.error).not.toContain('password')

    server.close()
  })
})
