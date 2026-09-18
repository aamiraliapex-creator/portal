import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { guarded } from '@/lib/auth-server'
import { getViewerScope, documentScopedFor } from '@/lib/ownership'
import { LIMITS, parseText, parseDateOnly, firstError } from '@/lib/validation'
export const runtime = 'nodejs'

/**
 * Sets or clears a document's expiry date.
 * Ownership is inside the UPDATE predicate: a scoped user may only touch a
 * document whose customer or case is assigned to them, so an unknown id and
 * someone else's id both return the same neutral 404.
 */
export const PATCH = guarded('document.update', async (req) => {
  const b = await req.json().catch(() => ({}))
  const id = typeof b.id === 'string' ? b.id.trim() : ''
  if (!id || id.length > LIMITS.shortText) {
    return NextResponse.json({ error: 'A document id is required.' }, { status: 400 })
  }
  const expiresOn = parseDateOnly(b.expiresOn, 'Expiry date')
  const bad = firstError(expiresOn)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  const scope = await getViewerScope()
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sql = getSql()
  const rows = await sql<{ id: string }[]>`
    update documents set expires_on = ${expiresOn.value ?? null}
     where id = ${id}
       and (${documentScopedFor(scope.user.role)} = false
            or exists (select 1 from customers c where c.id = documents.customer_id and c.agent_id = ${scope.viewerId})
            or exists (select 1 from cases k where k.id = documents.case_id and k.agent_id = ${scope.viewerId}))
    returning id`
  if (rows.length === 0) return NextResponse.json({ error: 'Not available' }, { status: 404 })
  return NextResponse.json({ ok: true })
})

/** Creates a document record with an optional validated expiry date. */
export const POST = guarded('document.create', async (req) => {
  const b = await req.json().catch(() => ({}))
  const category = parseText(b.category, LIMITS.shortText, 'Category')
  const fileName = parseText(b.fileName, LIMITS.shortText, 'File name')
  const expiresOn = parseDateOnly(b.expiresOn, 'Expiry date')
  const bad = firstError(category, fileName, expiresOn)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })
  if (!fileName.value) return NextResponse.json({ error: 'File name is required.' }, { status: 400 })

  const scope = await getViewerScope()
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const customerId = typeof b.customerId === 'string' && b.customerId.trim() !== '' ? b.customerId.trim() : null
  // A scoped user must not create an orphan document they could never see again.
  if (documentScopedFor(scope.user.role) && !customerId) {
    return NextResponse.json({ error: 'Select the customer this document belongs to.' }, { status: 400 })
  }
  const sql = getSql()
  if (customerId) {
    const [owned] = await sql<{ id: string }[]>`
      select id from customers where id = ${customerId}
        and (${documentScopedFor(scope.user.role)} = false or agent_id = ${scope.viewerId}) limit 1`
    if (!owned) return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }

  const [row] = await sql<{ id: string }[]>`
    insert into documents (customer_id, category, file_name, expires_on)
    values (${customerId}, ${category.value ?? 'Other'}, ${fileName.value}, ${expiresOn.value ?? null})
    returning id`
  return NextResponse.json({ ok: true, id: row.id })
})
