import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeCell, toCsv } from '../lib/csv'

test('formula-triggering prefixes are neutralized on text cells', () => {
  assert.equal(sanitizeCell('=SUM(A1:A9)'), "'=SUM(A1:A9)")
  assert.equal(sanitizeCell('+1+1'), "'+1+1")
  assert.equal(sanitizeCell('-2+3'), "'-2+3")
  assert.equal(sanitizeCell('@SUM(1,2)'), "'@SUM(1,2)")
  assert.equal(sanitizeCell('\t=evil()'), "'\t=evil()")
})

test('ordinary text is left untouched', () => {
  assert.equal(sanitizeCell('John Doe'), 'John Doe')
  assert.equal(sanitizeCell('Pierce County'), 'Pierce County')
  assert.equal(sanitizeCell(''), '')
})

test('numeric cells are never stringified or prefixed, even if "dangerous"-looking', () => {
  assert.equal(sanitizeCell(42), 42)
  assert.equal(sanitizeCell(-5), -5) // a real negative number must stay a number, not become text
  assert.equal(typeof sanitizeCell(-5), 'number')
})

test('toCsv preserves numeric totals as real numbers and escapes quotes', () => {
  const out = toCsv([
    ['Name', 'Amount'],
    ['=cmd|calc', -12.5],
    ['Say "hi"', 3],
  ])
  const lines = out.split('\n')
  assert.equal(lines[1], `"'=cmd|calc","-12.5"`)
  assert.equal(lines[2], `"Say ""hi""","3"`)
})
