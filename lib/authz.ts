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
  'report.export',
  'schema.migrate',
] as const
export type Permission = (typeof PERMISSIONS)[number]

/**
 * Permission matrix. READ_ONLY intentionally holds no write permission.
 * Assumption (documented): BILLING handles money, DOCUMENT_STAFF handles files,
 * SALES_AGENT owns customer intake, CASE_AGENT owns case work.
 */
const MATRIX: Record<Permission, Role[]> = {
  'customer.create':    ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SALES_AGENT', 'CASE_AGENT'],
  'customer.update':    ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SALES_AGENT', 'CASE_AGENT'],
  'case.create':        ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT'],
  'case.update':        ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT'],
  'payment.create':     ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'BILLING'],
  'task.create':        ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT', 'SALES_AGENT', 'BILLING', 'DOCUMENT_STAFF'],
  'task.update':        ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT', 'SALES_AGENT', 'BILLING', 'DOCUMENT_STAFF'],
  'assignment.update':  ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  'settings.update':    ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  'user.manage':        ['SUPER_ADMIN', 'ADMIN'],
  'user.delete':        ['SUPER_ADMIN'],
  'report.export':      ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'BILLING', 'CASE_AGENT', 'SALES_AGENT', 'DOCUMENT_STAFF', 'READ_ONLY'],
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
