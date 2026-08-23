import { loadEnvFile } from 'node:process'
import { defaultDatabasePath } from '@linkup/db'

const DEFAULT_PORT = 3001
const VALID_ENVIRONMENTS = ['development', 'test', 'production'] as const
export type NodeEnvironment = (typeof VALID_ENVIRONMENTS)[number]

/** Builder API key for the Hello Minds provider (matches SDK BUILDER_API_KEY_ENV). */
export const MINDS_BUILDER_API_KEY_ENV = 'MINDS_BUILDER_API_KEY'
/** Mind to message on the builder account (from the Minds console). */
export const MINDS_MIND_ID_ENV = 'MINDS_MIND_ID'
/** How long to wait for a Mind reply before giving up, in milliseconds. */
export const MINDS_REPLY_TIMEOUT_MS_ENV = 'MINDS_REPLY_TIMEOUT_MS'
export const DEFAULT_MINDS_REPLY_TIMEOUT_MS = 120_000

export interface MindsConfig {
  /** Trimmed value of MINDS_BUILDER_API_KEY; empty string when not set. */
  builderApiKey: string
  /** Trimmed value of MINDS_MIND_ID; empty string when not set. */
  mindId: string
  /** Reply wait timeout in milliseconds (positive integer, default 120000). */
  replyTimeoutMs: number
}

export interface ApiConfig {
  port: number
  nodeEnv: NodeEnvironment
  databasePath: string
  minds: MindsConfig
}

/**
 * Loads .env from the current working directory when present. Missing file is
 * fine (defaults apply); malformed files surface loudly.
 */
export function loadDotEnv(): void {
  try {
    loadEnvFile('.env')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const nodeEnv = env.NODE_ENV ?? 'development'
  if (!VALID_ENVIRONMENTS.includes(nodeEnv as NodeEnvironment)) {
    throw new Error(
      `Invalid NODE_ENV "${env.NODE_ENV}" — expected one of: ${VALID_ENVIRONMENTS.join(', ')}.`,
    )
  }

  const rawPort = env.PORT?.trim()
  const port = rawPort === undefined || rawPort === '' ? DEFAULT_PORT : parsePort(rawPort)

  const databasePath = env.DATABASE_PATH?.trim() || defaultDatabasePath

  const replyTimeoutMs = parsePositiveInteger(
    env[MINDS_REPLY_TIMEOUT_MS_ENV],
    MINDS_REPLY_TIMEOUT_MS_ENV,
    DEFAULT_MINDS_REPLY_TIMEOUT_MS,
  )

  return {
    port,
    nodeEnv: nodeEnv as NodeEnvironment,
    databasePath,
    minds: {
      builderApiKey: env[MINDS_BUILDER_API_KEY_ENV]?.trim() ?? '',
      mindId: env[MINDS_MIND_ID_ENV]?.trim() ?? '',
      replyTimeoutMs,
    },
  }
}

function parsePort(raw: string): number {
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT "${raw}" — expected an integer between 1 and 65535.`)
  }
  return port
}

function parsePositiveInteger(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${name} "${raw}" — expected a positive integer.`)
  }
  return value
}
