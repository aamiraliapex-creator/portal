import postgres from 'postgres'

declare global {
  // eslint-disable-next-line no-var
  var _sql: ReturnType<typeof postgres> | undefined
}

function pickUrl(): string | undefined {
  const raw =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING
  if (!raw) return undefined
  // channel_binding=require breaks the postgres.js driver — remove it
  let url = raw
    .replace(/([?&])channel_binding=require&?/i, '$1')
    .replace(/[?&]$/,'')
  return url
}

export function getSql() {
  const url = pickUrl()
  if (!url) throw new Error('No database URL found. Set DATABASE_URL in Vercel → Settings → Environment Variables, then Redeploy.')
  if (!global._sql) {
    global._sql = postgres(url, { ssl: 'require', prepare: false, max: 1 })
  }
  return global._sql
}
