import { getSql } from './db'
import { getCurrentUser, type CurrentUser } from './auth-server'
import { isScopedToOwnWork, canSeeMoney, canSeeAllFinancialRecords, hasPermission, type Permission } from './authz'

/**
 * One place that answers "what may this viewer see?", so pages and API routes
 * cannot drift apart. Never copy these conditions inline.
 */
export type ViewerScope = {
  user: CurrentUser
  /** true when the viewer may only see records assigned to them */
  scoped: boolean
  /** the viewer's id, used as the ownership key (customers.agent_id / cases.agent_id) */
  viewerId: string
  /** true when the viewer may see fees, payments and balances at all */
  showMoney: boolean
  /** true when the viewer may see EVERY financial record, not just their own */
  allMoney: boolean
}

export async function getViewerScope(): Promise<ViewerScope | null> {
  const user = await getCurrentUser()
  if (!user) return null
  return {
    user,
    scoped: isScopedToOwnWork(user.role),
    viewerId: user.id,
    showMoney: canSeeMoney(user.role),
    allMoney: canSeeAllFinancialRecords(user.role),
  }
}

/** Neutral result for a scoped viewer asking for someone else's record. */
export const NOT_AVAILABLE = 'Not available'

export class NotAvailableError extends Error {
  constructor() { super(NOT_AVAILABLE); this.name = 'NotAvailableError' }
}

/**
 * Loads a case the viewer is allowed to act on.
 *
 * Returns null when the case does not exist OR belongs to another agent, so an
 * unauthorised caller cannot distinguish the two (no record-existence oracle).
 */
export async function loadOwnedCase(
  scope: ViewerScope,
  caseId: string,
  opts: { requireActive?: boolean } = {},
): Promise<{ id: string; customer_id: string; agent_id: string | null; approval_status: string; state: string | null } | null> {
  const sql = getSql()
  const [row] = await sql<{ id: string; customer_id: string; agent_id: string | null; approval_status: string; state: string | null }[]>`
    select id, customer_id, agent_id, coalesce(approval_status,'ACTIVE') as approval_status, state
      from cases where id = ${caseId} limit 1`
  if (!row) return null
  if (scope.scoped && row.agent_id !== scope.viewerId) return null
  if (opts.requireActive && row.approval_status !== 'ACTIVE') return null
  return row
}

/** Loads a customer the viewer is allowed to act on. Same neutral-null rule. */
export async function loadOwnedCustomer(
  scope: ViewerScope,
  customerId: string,
  opts: { requireActive?: boolean } = {},
): Promise<{ id: string; agent_id: string | null; approval_status: string } | null> {
  const sql = getSql()
  const [row] = await sql<{ id: string; agent_id: string | null; approval_status: string }[]>`
    select id, agent_id, coalesce(approval_status,'ACTIVE') as approval_status
      from customers where id = ${customerId} limit 1`
  if (!row) return null
  if (scope.scoped && row.agent_id !== scope.viewerId) return null
  if (opts.requireActive && row.approval_status !== 'ACTIVE') return null
  return row
}

/** Guard for server components: returns the scope or a reason to refuse. */
export async function requirePageAccess(
  perm?: Permission,
  opts: { money?: boolean } = {},
): Promise<ViewerScope | null> {
  const scope = await getViewerScope()
  if (!scope) return null
  if (perm && !hasPermission(scope.user.role, perm)) return null
  if (opts.money && !scope.showMoney) return null
  return scope
}

/**
 * Loads a task the viewer may act on. Scoped viewers only own tasks whose
 * assignee_id is their own id. Missing and not-yours are indistinguishable.
 */
export async function loadOwnedTask(
  scope: ViewerScope,
  taskId: string,
): Promise<{ id: string; assignee_id: string | null } | null> {
  const sql = getSql()
  const [row] = await sql<{ id: string; assignee_id: string | null }[]>`
    select id, assignee_id from tasks where id = ${taskId} limit 1`
  if (!row) return null
  if (scope.scoped && row.assignee_id !== scope.viewerId) return null
  return row
}
