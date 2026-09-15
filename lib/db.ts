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

/**
 * TLS mode derived from the connection string.
 * Defaults to 'require' (managed Postgres such as Neon), but honours an
 * explicit sslmode=disable so a local/self-hosted instance without TLS can be
 * used for development and tests. Previously ssl was hardcoded to 'require',
 * which made any sslmode=disable URL fail to connect.
 */
function sslModeFor(url: string): 'require' | false {
  return /[?&]sslmode=disable(&|$)/i.test(url) ? false : 'require'
}

export function getSql() {
  const url = pickUrl()
  if (!url) throw new Error('No database URL found. Set DATABASE_URL in the deployment environment.')
  if (!global._sql) {
    global._sql = postgres(url, { ssl: sslModeFor(url), prepare: false, max: 10, idle_timeout: 20, connect_timeout: 30 })
  }
  return global._sql
}
