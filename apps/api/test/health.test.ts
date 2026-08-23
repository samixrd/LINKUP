import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase } from '@linkup/db'
import { createApp } from '../src/app.js'

describe('health endpoint', () => {
  const db = createDatabase(':memory:')
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    server = createApp({ db }).listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => {
    server.close()
    db.close()
  })

  it('reports ok with a healthy database', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      status: string
      service: string
      database: { ok: boolean }
    }
    expect(body.status).toBe('ok')
    expect(body.service).toBe('linkup-api')
    expect(body.database.ok).toBe(true)
  })

  it('returns 404 for unknown API routes', async () => {
    const res = await fetch(`${baseUrl}/api/does-not-exist`)
    expect(res.status).toBe(404)
  })
})
