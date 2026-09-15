import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// ---- CSV safety (Finding 7 & 8) -------------------------------------------
// lib/csv.ts is TypeScript; re-implement the import via a tiny transpile-free
// read of the exported logic is brittle, so we test the shipped behaviour
// through the same rules the module documents.
const csvSrc = fs.readFileSync(path.join(process.cwd(), 'lib/csv.ts'), 'utf8')

test('csv module neutralises formula-injection prefixes', () => {
  assert.match(csvSrc, /\^\[=\+\\-@\\t\\r\]/, 'risky-prefix regex must cover = + - @ tab CR')
  assert.match(csvSrc, /"'" \+ s/, 'risky text cells must be prefixed with a single quote')
})

test('csv module keeps finite numbers unquoted (numeric in Excel)', () => {
  assert.match(csvSrc, /typeof value === 'number' && Number\.isFinite\(value\)/)
})

test('no export path mislabels CSV as xls/xlsx', () => {
  const report = fs.readFileSync(path.join(process.cwd(), 'app/api/reports/route.ts'), 'utf8')
  assert.ok(!/vnd\.ms-excel/.test(report), 'must not send Excel MIME type for CSV bytes')
  assert.ok(!/\.xlsx?"/.test(report.replace(/\/\/.*$/gm, '')), 'must not use .xls/.xlsx filenames')
  assert.match(report, /text\/csv; charset=utf-8/)
})

// ---- Provisioning CLI (Finding 5) -----------------------------------------
test('scripts/setup.mjs exists and extracts the schema SQL', async () => {
  const { extractSql } = await import('../scripts/setup.mjs')
  const src = fs.readFileSync(path.join(process.cwd(), 'lib/schema.ts'), 'utf8')
  const { CREATE, ALTER, INDEXES } = extractSql(src)
  assert.match(CREATE, /create table if not exists users/)
  assert.match(ALTER, /session_version/)
  assert.ok(typeof INDEXES === 'string')
})

// ---- Fail-closed secrets (Finding 1) --------------------------------------
test('no insecure fallback secret or hardcoded admin password remains', () => {
  const files = ['lib/session.ts', 'proxy.ts', 'lib/schema.ts', 'lib/env.ts']
  for (const f of files) {
    const s = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
    assert.ok(!/dev-insecure-secret-change-me/.test(s), `${f} still contains a fallback secret`)
    assert.ok(!/KpZXiHVGCYuTanAa1/.test(s), `${f} still contains a hardcoded password`)
  }
  assert.ok(!fs.existsSync(path.join(process.cwd(), 'middleware.ts')), 'middleware.ts should be renamed to proxy.ts')
})
