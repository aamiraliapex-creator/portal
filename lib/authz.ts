/**
 * Central role + permission definitions.
 * Every server-side write must go through hasPermission()/requirePermission().
 */
export const ROLES = [
  'SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT', 'SALES_AGENT', 'BILLING', 'DOCUMENT_STAFF', 'READ_ONLY',
] as const
export type Role = (typeof ROLES)[number]

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export function isRole(v: unknown): v is Role { return typeof v === 'string' && (ROLES as readonly string[]).includes(v) }
export function isUserStatus(v: unknown): v is UserStatus { return typeof v === 'string' && (USER_STATUSES as readonly string[]).includes(v) }

/** Lower number = more privileged. Used to stop lateral/upward management. */
export const ROLE_RANK: Record<Role, number> = {
  SUPER_ADMIN: 0, ADMIN: 1, MANAGER: 2,
  CASE_AGENT: 3, SALES_AGENT: 3, BILLING: 3, DOCUMENT_STAFF: 3, READ_ONLY: 4,
}

export const PERMISSIONS = [
  'customer.create', 'customer.update',
  'case.create', 'case.update',
  'payment.create',
  'task.create', 'task.update',
  'assignment.update',
  'settings.update',
  'user.manage',   // create / enable / disable
  'user.delete',   // hard delete
  'report.view',
  'report.export',
  'record.approve',
  'schema.migrate',
] as const
export type Permission = (typeof PERMISSIONS)[number]

/**
 * Permission matrix. READ_ONLY intentionally holds no write permission.
 * Assumption (documented): BILLING handles money, DOCUMENT_STAFF handles files,
 * SALES_AGENT owns customer intake, CASE_AGENT owns case work.
 */
const MATRIX: Record<Permission, Role[]> = {
  'customer.create':    ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  'customer.update':    ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  'case.create':        ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT'],
  'case.update':        ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT'],
  'payment.create':     ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'BILLING'],
  'task.create':        ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT', 'SALES_AGENT', 'BILLING', 'DOCUMENT_STAFF'],
  'task.update':        ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT', 'SALES_AGENT', 'BILLING', 'DOCUMENT_STAFF'],
  'assignment.update':  ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  'settings.update':    ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  'user.manage':        ['SUPER_ADMIN', 'ADMIN'],
  'user.delete':        ['SUPER_ADMIN'],
  'report.view':        ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT', 'SALES_AGENT', 'BILLING', 'DOCUMENT_STAFF', 'READ_ONLY'],
  'report.export':      ['SUPER_ADMIN', 'ADMIN'],
  'record.approve':     ['SUPER_ADMIN', 'ADMIN'],
  'schema.migrate':     ['SUPER_ADMIN'],
}

export function hasPermission(role: string | null | undefined, perm: Permission): boolean {
  if (!isRole(role)) return false
  return MATRIX[perm].includes(role)
}

/** Can `actor` create or modify an account whose role is `targetRole`? */
export function canManageRole(actorRole: string, targetRole: string): boolean {
  if (!isRole(actorRole) || !isRole(targetRole)) return false
  if (!hasPermission(actorRole, 'user.manage')) return false
  // Only a SUPER_ADMIN may create or touch another SUPER_ADMIN.
  if (targetRole === 'SUPER_ADMIN') return actorRole === 'SUPER_ADMIN'
  // Otherwise the actor must be strictly more privileged than the target.
  return ROLE_RANK[actorRole] < ROLE_RANK[targetRole]
}

/**
 * Roles that may own a customer or a case as its assigned agent.
 * Single source of truth: used by the customers, cases and assign APIs and by
 * the agent-selection queries that populate their dropdowns, so the UI can
 * never offer a user the API would reject.
 */
export const ASSIGNABLE_AGENT_ROLES: readonly Role[] = [
  'SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT', 'SALES_AGENT',
]

export function isAssignableAgentRole(role: unknown): role is Role {
  return isRole(role) && ASSIGNABLE_AGENT_ROLES.includes(role)
}

/* ---------------------------------------------------------------------------
 * Approval workflow
 * ------------------------------------------------------------------------- */
export const APPROVAL_STATUSES = ['ACTIVE', 'PENDING', 'REJECTED'] as const
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]
export function isApprovalStatus(v: unknown): v is ApprovalStatus {
  return typeof v === 'string' && (APPROVAL_STATUSES as readonly string[]).includes(v)
}

/** Roles whose new records go live immediately; everyone else's need approval. */
const AUTO_APPROVE_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN']

/** Records created by a Manager or Case Agent start life as PENDING. */
export function initialApprovalStatus(role: string): ApprovalStatus {
  return isRole(role) && AUTO_APPROVE_ROLES.includes(role) ? 'ACTIVE' : 'PENDING'
}

/* ---------------------------------------------------------------------------
 * Visibility scoping
 * ------------------------------------------------------------------------- */
/** Roles that see every record. Everyone else is scoped to their own work. */
const FULL_VISIBILITY: Role[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER']

export function seesAllRecords(role: string): boolean {
  return isRole(role) && FULL_VISIBILITY.includes(role)
}

/** True when the role may only see records assigned to them. */
export function isScopedToOwnWork(role: string): boolean {
  return isRole(role) && !FULL_VISIBILITY.includes(role)
}

/* ---------------------------------------------------------------------------
 * Financial visibility
 * ------------------------------------------------------------------------- */
/**
 * Roles allowed to see money: fees, payments, revenue and outstanding balances.
 * Case and Sales agents are deliberately excluded — they work cases and intake,
 * not billing. Assumption: READ_ONLY is an oversight/reporting role and keeps
 * financial visibility; change this list if that is not how you use it.
 */
const MONEY_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'BILLING', 'READ_ONLY']

export function canSeeMoney(role: string): boolean {
  return isRole(role) && MONEY_ROLES.includes(role)
}

/* ---------------------------------------------------------------------------
 * Financial-record SCOPE (distinct from financial VISIBILITY)
 *
 * canSeeMoney() answers "may this role see amounts at all?".
 * It is NOT proof that the role may see EVERY financial record.
 *
 * Documented policy:
 *  - SUPER_ADMIN / ADMIN / MANAGER : organisation-wide financial records
 *    (they already have full operational visibility).
 *  - BILLING : organisation-wide FINANCIAL records only. Billing must chase
 *    every unpaid invoice, so it needs company-wide money — but this helper
 *    deliberately does not widen its OPERATIONAL visibility, which stays
 *    scoped via isScopedToOwnWork().
 *  - READ_ONLY : organisation-wide financial OVERSIGHT, read-only. It is an
 *    audit/reporting role, so it sees company figures but holds no write
 *    permission anywhere (see the PERMISSIONS matrix).
 *  - CASE_AGENT / SALES_AGENT / DOCUMENT_STAFF : no financial visibility at
 *    all (canSeeMoney() is false), so the question does not arise.
 * ------------------------------------------------------------------------- */
const ALL_FINANCIAL_RECORD_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'BILLING', 'READ_ONLY']

/** True when the role may see EVERY financial record, not just its own. */
export function canSeeAllFinancialRecords(role: string): boolean {
  return isRole(role) && canSeeMoney(role) && ALL_FINANCIAL_RECORD_ROLES.includes(role)
}

/** True when a role with money access is nonetheless limited to its own records. */
export function isFinanciallyScoped(role: string): boolean {
  return canSeeMoney(role) && !canSeeAllFinancialRecords(role)
}

/**
 * Roles allowed to assign work (tasks) to somebody other than themselves.
 * Scoped roles may only create tasks for themselves.
 */
export function canAssignWorkToOthers(role: string): boolean {
  return isRole(role) && seesAllRecords(role)
}

/* ---------------------------------------------------------------------------
 * Report policy
 *
 * Financial access must NEVER grant organisation-wide OPERATIONAL access.
 * BILLING and READ_ONLY hold company-wide money, not company-wide casework.
 * ------------------------------------------------------------------------- */
export const FINANCIAL_REPORT_TYPES = ['method', 'outstanding'] as const
export const OPERATIONAL_REPORT_TYPES = ['status', 'agent', 'custagent', 'newcust', 'hearings'] as const

/** Every supported report type. Anything else is a bad request, not a report. */
export const REPORT_TYPES = [...OPERATIONAL_REPORT_TYPES, ...FINANCIAL_REPORT_TYPES] as const

export function isReportType(value: unknown): boolean {
  return typeof value === 'string' && (REPORT_TYPES as readonly string[]).includes(value)
}

/** Organisation-wide operational reports: cases, hearings, customers, agents. */
export function canSeeOperationalReports(role: string): boolean {
  return seesAllRecords(role)
}

/** Organisation-wide financial reports: payments by method, outstanding invoices. */
export function canSeeFinancialReports(role: string): boolean {
  return canSeeAllFinancialRecords(role)
}

/** True when the given report type is visible to the role. */
export function canViewReportType(role: string, reportType: string): boolean {
  return (FINANCIAL_REPORT_TYPES as readonly string[]).includes(reportType)
    ? canSeeFinancialReports(role)
    : canSeeOperationalReports(role)
}

/* ---------------------------------------------------------------------------
 * Task assignment policy
 *
 * Distinct from ASSIGNABLE_AGENT_ROLES, which governs who may OWN a customer
 * or case. Tasks are ordinary work items, so every role that holds task
 * permissions may receive one — including BILLING and DOCUMENT_STAFF.
 *
 * READ_ONLY is excluded: it holds no write permission anywhere, so it could
 * never action an assigned task. Add it here only with an explicit documented
 * business requirement.
 * ------------------------------------------------------------------------- */
export const TASK_ASSIGNEE_ROLES: Role[] = [
  'SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT', 'SALES_AGENT', 'BILLING', 'DOCUMENT_STAFF',
]

/** True when a task may be assigned to an account holding this role. */
export function isTaskAssignableRole(role: string): boolean {
  return isRole(role) && TASK_ASSIGNEE_ROLES.includes(role)
}
