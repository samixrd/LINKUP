// Vite env types for LINKUP web app.
// VITE_API_URL is set in Vercel dashboard and inlined at build time via import.meta.env.
interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
}
