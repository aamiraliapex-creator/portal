#!/usr/bin/env node
/**
 * One-off provisioning / migration CLI.
 *
 *   npm run db:setup
 *
 * Applies the schema (idempotent CREATE / ALTER / INDEX statements) and
 * optionally creates the first SUPER_ADMIN from SUPERADMIN_* env vars.
 *
 * The SQL is read directly out of lib/schema.ts so the CLI and the
 * application can never drift apart.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import bcrypt from 'bcryptjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Load .env (simple KEY=VALUE parser) without overriding real env vars.
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* .env is optional */ }

export function extractSql(source) {
  const grab = (name) => {
    const m = source.match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`'))
    if (!m) throw new Error(`Could not find SQL block "${name}" in lib/schema.ts`)
    return m[1]
  }
  return { CREATE: grab('CREATE'), ALTER: grab('ALTER'), INDEXES: grab('INDEXES') }
}

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) {
    console.error('✗ DATABASE_URL (or DIRECT_URL) must be set.')
    process.exit(1)
  }
  const { CREATE, ALTER, INDEXES } = extractSql(fs.readFileSync(path.join(root, 'lib', 'schema.ts'), 'utf8'))
  const sql = postgres(url, { ssl: url.includes('sslmode=disable') ? false : 'require', max: 1 })

  try {
    await sql.unsafe(CREATE)
    await sql.unsafe(ALTER)
    await sql.unsafe(INDEXES)
    console.log('✓ Schema applied')

    const email = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase()
    const password = process.env.SUPERADMIN_PASSWORD || ''
    if (!email || password.length < 12) {
      console.log('• Skipped admin creation (set SUPERADMIN_EMAIL and a SUPERADMIN_PASSWORD of 12+ chars to create one).')
    } else {
      const existing = await sql`select id from users where email = ${email} limit 1`
      const anySuper = await sql`select id from users where role = 'SUPER_ADMIN' and status = 'ACTIVE' limit 1`
      if (existing.length || anySuper.length) {
        console.log('• Super admin already exists — left untouched.')
      } else {
        const hash = await bcrypt.hash(password, 12)
        await sql`insert into users (name, email, password_hash, role, status)
          values (${process.env.SUPERADMIN_NAME || 'System Owner'}, ${email}, ${hash}, 'SUPER_ADMIN', 'ACTIVE')
          on conflict (email) do nothing`
        console.log(`✓ Created super admin: ${email}`)
        console.log('  Sign in, change this password immediately, then remove SUPERADMIN_PASSWORD from the environment.')
      }
    }
    console.log('Done.')
  } finally {
    await sql.end({ timeout: 5 })
  }
}

if (process.argv[1] && process.argv[1].endsWith('setup.mjs')) {
  main().catch((e) => { console.error('✗', e.message); process.exit(1) })
}
