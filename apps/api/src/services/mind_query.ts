import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { buildMindContext, createMindInteraction, type MindAdapter, type MindContext } from '@linkup/db'

/** Options for `queryMind` / `buildContext`. Omitted fields use defaults. */
export interface MindQueryOptions {
  /**
   * Opt-in: search the creator's own memories for this query and attach the
   * ranked results as `memorySearch` on the context the adapter receives.
   */
  memorySearch?: string
}

/** Upper bound on a Mind query, in characters (abuse / payload hardening). */
export const MAX_QUERY_LENGTH = 10_000
/** Upper bound on the opt-in memory search query, in characters. */
export const MAX_MEMORY_SEARCH_LENGTH = 1_000

export interface MindQueryService {
  queryMind(creatorId: string, query: string, options?: MindQueryOptions): Promise<string>
  // Exposed for testing: allows inspection without re-building context
  buildContext(creatorId: string, options?: MindQueryOptions): MindContext
}

export interface MindQueryServiceOptions {
  db: Database.Database
  adapter: MindAdapter
}

/**
 * Small, pure service layer for Mind queries.
 * - Loads MindContext via buildMindContext (no direct SQL)
 * - Validates query string (and optional memorySearch)
 * - Delegates to MindAdapter with structured context
 *
 * Adapter is injected for testability; production defaults to stubMindAdapter.
 */
export function createMindQueryService({ db, adapter }: MindQueryServiceOptions): MindQueryService {
  return {
    buildContext(creatorId: string, options: MindQueryOptions = {}): MindContext {
      return buildMindContext(db, creatorId, options)
    },

    async queryMind(
      creatorId: string,
      query: string,
      options: MindQueryOptions = {},
    ): Promise<string> {
      if (typeof query !== 'string' || query.trim() === '') {
        throw new Error('query is required and must be a non-empty string')
      }
      if (query.length > MAX_QUERY_LENGTH) {
        throw new Error(`query must be at most ${MAX_QUERY_LENGTH} characters`)
      }
      if (options.memorySearch !== undefined) {
        if (
          typeof options.memorySearch !== 'string' ||
          options.memorySearch.trim() === ''
        ) {
          throw new Error('memorySearch must be a non-empty string when provided')
        }
        if (options.memorySearch.length > MAX_MEMORY_SEARCH_LENGTH) {
          throw new Error(`memorySearch must be at most ${MAX_MEMORY_SEARCH_LENGTH} characters`)
        }
      }
      // buildMindContext validates creatorId and existence
      const context = buildMindContext(db, creatorId, {
        memorySearch: options.memorySearch,
      })
      // Adapter receives structured context, not DB
      const answer = await adapter.query(context, query)
      if (typeof answer !== 'string' || answer.trim() === '') {
        throw new Error('adapter returned invalid answer')
      }
      // Persist both turns atomically after successful adapter call
      // Order matters: user first, then mind, chronological
      const persist = db.transaction(() => {
        createMindInteraction(db, {
          id: randomUUID(),
          creatorId,
          role: 'user',
          content: query,
        })
        createMindInteraction(db, {
          id: randomUUID(),
          creatorId,
          role: 'mind',
          content: answer,
        })
      })
      persist()
      return answer
    },
  }
}
