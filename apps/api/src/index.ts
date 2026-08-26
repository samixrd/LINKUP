import { createDatabase, migrate } from '@linkup/db'
import { createApp } from './app.js'
import { loadConfig, loadDotEnv } from './config.js'
import { resolveMindAdapter } from './services/mind_provider.js'
import { createFollowUpWorker } from './services/follow_up_worker.js'
import { assertSupportedNodeVersion } from './runtime.js'

function main(): void {
  assertSupportedNodeVersion()
  loadDotEnv()
  const config = loadConfig()

  const db = createDatabase(config.databasePath)
  const applied = migrate(db)
  if (applied.length > 0) {
    console.log(`[db] applied migrations: ${applied.join(', ')}`)
  }

  // Ensure 15 diverse creators and published Go Open cards exist on boot
  seedDemoAccounts(db)

  // Real Minds provider (with optional Groq fallback) when env config is
  // present; stub otherwise.
  const mindAdapter = resolveMindAdapter(config.minds, config.groq)

  const app = createApp({ db, mindAdapter })
  const server = app.listen(config.port, () => {
    console.log(`[api] LINKUP API listening on http://localhost:${config.port} (${config.nodeEnv})`)
  })

  // Autonomous layer: the Mind follows up on due collaborations without any
  // human prompting. Timer is unref'd so it never blocks shutdown.
  const followUpWorker = createFollowUpWorker({ db, adapter: mindAdapter })
  followUpWorker.start()
  console.log('[api] follow-up worker started (autonomous mode)')

  const shutdown = (signal: NodeJS.Signals): void => {
    console.log(`[api] received ${signal}, shutting down`)
    followUpWorker.stop()
    server.close(() => {
      db.close()
      process.exit(0)
    })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

function seedDemoAccounts(db: ReturnType<typeof createDatabase>): void {
  const DEMO_CREATORS = [
    { handle: 'alex_travels', displayName: 'Alex Rivera', bio: 'Documenting remote travel & solo adventures', niche: 'Travel & Adventure', followers: 85000, minRate: 400, topics: ['Travel', 'Adventure', 'Vlogs'], lang: ['en'], platform: 'YouTube' },
    { handle: 'maya_code', displayName: 'Maya Chen', bio: 'Full-stack engineer building AI apps in public', niche: 'Tech & AI', followers: 62000, minRate: 500, topics: ['Tech', 'Coding', 'AI'], lang: ['en'], platform: 'YouTube' },
    { handle: 'sara_pottery', displayName: 'Sara Al-Mansoor', bio: 'Studio ceramicist & slow-living creator', niche: 'Design & Crafts', followers: 34000, minRate: 250, topics: ['Crafts', 'Art', 'Design'], lang: ['en'], platform: 'Instagram' },
    { handle: 'tanvir_gaming', displayName: 'Tanvir Ahmed', bio: 'Competitive FPS esports caster & streamer', niche: 'Gaming & Esports', followers: 110000, minRate: 350, topics: ['Gaming', 'Esports', 'Twitch'], lang: ['en', 'bn'], platform: 'Twitch' },
    { handle: 'david_finance', displayName: 'David Miller', bio: 'Demystifying personal finance for Gen Z', niche: 'Finance & Crypto', followers: 95000, minRate: 600, topics: ['Finance', 'Crypto', 'Investing'], lang: ['en'], platform: 'YouTube' },
    { handle: 'priya_cooks', displayName: 'Priya Sharma', bio: 'Plant-based regional Indian street cuisine', niche: 'Food & Cooking', followers: 48000, minRate: 200, topics: ['Food', 'Cooking', 'Vegan'], lang: ['en', 'hi'], platform: 'Instagram' },
    { handle: 'lucas_fitness', displayName: 'Lucas Rossi', bio: 'Calisthenics athlete & mobility coach', niche: 'Fitness & Health', followers: 72000, minRate: 300, topics: ['Fitness', 'Calisthenics', 'Health'], lang: ['en'], platform: 'TikTok' },
    { handle: 'zara_style', displayName: 'Zara Khan', bio: 'Thrift flips, minimalist fashion & capsule wardrobes', niche: 'Fashion & Style', followers: 56000, minRate: 350, topics: ['Fashion', 'Style', 'Thrifting'], lang: ['en'], platform: 'Instagram' },
    { handle: 'elena_music', displayName: 'Elena Gomez', bio: 'Indie acoustic covers and song production breakdowns', niche: 'Music & Audio', followers: 41000, minRate: 200, topics: ['Music', 'Indie', 'Covers'], lang: ['en', 'es'], platform: 'YouTube' },
    { handle: 'liam_film', displayName: 'Liam Vance', bio: 'Cinematic colour grading tutorials & camera reviews', niche: 'Video & Cinema', followers: 68000, minRate: 450, topics: ['Video', 'Film', 'Cinematography'], lang: ['en'], platform: 'YouTube' },
    { handle: 'dr_aravind', displayName: 'Dr. Aravind Menon', bio: 'Evidence-based neurobiology & productivity systems', niche: 'Science & Education', followers: 140000, minRate: 750, topics: ['Science', 'Productivity', 'Education'], lang: ['en'], platform: 'YouTube' },
    { handle: 'nour_books', displayName: 'Nour Haddad', bio: 'Fantasy literature essays, worldbuilding & reviews', niche: 'Books & Literature', followers: 29000, minRate: 150, topics: ['Books', 'Fantasy', 'Reading'], lang: ['en', 'ar'], platform: 'TikTok' },
    { handle: 'chloe_comedy', displayName: 'Chloe Bennett', bio: 'Relatable creator culture sketches & parody reels', niche: 'Comedy & Skits', followers: 210000, minRate: 600, topics: ['Comedy', 'Skits', 'Humor'], lang: ['en'], platform: 'TikTok' },
    { handle: 'marco_photo', displayName: 'Marco Silva', bio: 'Street photography in European old towns & film presets', niche: 'Photography', followers: 51000, minRate: 300, topics: ['Photography', 'StreetPhoto', 'Film'], lang: ['en', 'pt'], platform: 'Instagram' },
    { handle: 'anika_startups', displayName: 'Anika Roy', bio: 'Interviews with bootstrapped indie hacker founders', niche: 'Business & Startups', followers: 88000, minRate: 550, topics: ['Business', 'Startups', 'IndieHacker'], lang: ['en'], platform: 'YouTube' },
  ]

  for (const c of DEMO_CREATORS) {
    const creatorId = `u_${c.handle}`
    try {
      db.prepare(
        `INSERT OR IGNORE INTO creators (creator_id, display_name, bio, avatar_url) VALUES (?, ?, ?, ?)`,
      ).run(creatorId, c.displayName, c.bio, '')

      db.prepare(
        `INSERT OR IGNORE INTO passcodes (handle, pin_hash, creator_id) VALUES (?, ?, ?)`,
      ).run(c.handle, '$2b$10$ephemeralDemoHashOnlyForTestingPin1234', creatorId)

      db.prepare(
        `INSERT OR REPLACE INTO open_collabs 
         (creator_id, open_to_collab, my_followers, min_partner_followers, languages, topics, platform, niche, min_rate, collab_types, open_for_brands, brand_min_rate, guardrails)
         VALUES (?, 1, ?, 0, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run(
        creatorId,
        c.followers,
        c.lang.join(','),
        c.topics.join(','),
        c.platform,
        c.niche,
        c.minRate,
        'co-host,cross-post,guest-feature',
        c.minRate * 2,
        `Minimum budget $${c.minRate} • Quality deliverables required`,
      )
    } catch {
      /* ignore */
    }
  }
}

main()
