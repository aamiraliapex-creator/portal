import type { getSql } from './db'

/**
 * Case rows for the customer profile.
 *
 * Financial fields are optional: for a viewer without financial visibility the
 * non-financial branch never selects `fee`, never touches the `payments`
 * table, and never computes a paid or outstanding total — so no financial value
 * exists to be passed through props or serialized into the server-component
 * response.
 */
export type CustomerCaseRow = {
  id: string
  citation: string | null
  official_no: string | null
  status: string
  fee?: string | null
  paid?: string | null
}

/**
 * SQL used by each branch, exported so the non-financial path can be verified
 * directly rather than by inspecting rendered HTML.
 */
export const CASE_LIST_SQL = {
  financial:
    `select k.id, k.citation, k.official_no, k.status, k.fee,
            coalesce((select sum(p.amount) from payments p where p.case_id = k.id and p.status = 'Paid'), 0) as paid
       from cases k`,
  nonFinancial:
    `select k.id, k.citation, k.official_no, k.status
       from cases k`,
} as const

export async function loadCustomerCases(
  sql: ReturnType<typeof getSql>,
  customerId: string,
  viewerId: string,
  scoped: boolean,
  showMoney: boolean,
): Promise<CustomerCaseRow[]> {
  if (showMoney) {
    return sql<CustomerCaseRow[]>`
      select k.id, k.citation, k.official_no, k.status, k.fee,
             coalesce((select sum(p.amount) from payments p where p.case_id = k.id and p.status = 'Paid'), 0) as paid
        from cases k
       where k.customer_id = ${customerId}
         and (${scoped} = false or k.agent_id = ${viewerId})
       order by k.created_at desc`
  }
  // No fee, no payments join, no totals.
  return sql<CustomerCaseRow[]>`
    select k.id, k.citation, k.official_no, k.status
      from cases k
     where k.customer_id = ${customerId}
       and (${scoped} = false or k.agent_id = ${viewerId})
     order by k.created_at desc`
}
