// Pure role/permission logic — no React, no database, no Next.js imports. Kept separate
// from lib/authz.ts (which adds the DB-backed getCurrentUser()) so this half can be unit
// tested directly under a plain Node test runner instead of needing the full Next.js
// server-component bundling pipeline just to import a permission check.

// ---------------------------------------------------------------------------
// Role model
// ---------------------------------------------------------------------------
// This is the single allowlist of valid roles/statuses in the system. Any role or
// status string that isn't in these lists is treated as invalid everywhere — API
// routes must reject it, and getCurrentUser() (lib/authz.ts) refuses to authenticate a
// user row with an unrecognized role rather than guessing.
export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT', 'SALES_AGENT', 'BILLING', 'DOCUMENT_STAFF', 'READ_ONLY'] as const
export type Role = (typeof ROLES)[number]
export const STATUSES = ['ACTIVE', 'DISABLED'] as const
export type Status = (typeof STATUSES)[number]

export function isRole(v: unknown): v is Role { return typeof v === 'string' && (ROLES as readonly string[]).includes(v) }
export function isStatus(v: unknown): v is Status { return typeof v === 'string' && (STATUSES as readonly string[]).includes(v) }

// Higher number = more privilege. Roles sharing a rank are peers — none can manage
// another peer's account (only strictly-higher ranks can, except SUPER_ADMIN which can
// manage anyone including other SUPER_ADMINs — see canManageRole below).
//
// ASSUMPTION: the app does not currently implement domain-specific silos between
// CASE_AGENT / SALES_AGENT / BILLING / DOCUMENT_STAFF (e.g. BILLING isn't restricted to
// payments-only). Historically none of these roles were ever treated differently for
// business-data writes, and re-scoping that is a product decision, not a vulnerability
// fix — so they're kept as peers here to preserve existing legitimate workflows. Only
// the READ_ONLY vs everyone-else boundary (the actual reported bug) and the user-management
// hierarchy (ADMIN vs SUPER_ADMIN) are newly enforced.
const RANK: Record<Role, number> = {
  READ_ONLY: 0,
  DOCUMENT_STAFF: 1, BILLING: 1, SALES_AGENT: 1, CASE_AGENT: 1,
  MANAGER: 2,
  ADMIN: 3,
  SUPER_ADMIN: 4,
}
export const rankOf = (role: string): number => (isRole(role) ? RANK[role] : -1)

export type CurrentUser = { id: string; name: string; email: string; role: Role; tokenVersion: number }

// ---------------------------------------------------------------------------
// Permission matrix
// ---------------------------------------------------------------------------
// READ_ONLY (rank 0) can view everything but write nothing. Every other active,
// non-disabled role (rank >= 1) can perform normal business-data writes.
export function canWriteBusinessData(user: CurrentUser | null): boolean {
  return !!user && rankOf(user.role) >= 1
}
// Settings changes affect the whole org — restricted to MANAGER and above, matching
// the threshold this app already used before this review.
export function canManageSettings(user: CurrentUser | null): boolean {
  return !!user && rankOf(user.role) >= 2
}
// User/account management — ADMIN and SUPER_ADMIN only, matching existing behavior.
export function canManageUsers(user: CurrentUser | null): boolean {
  return !!user && rankOf(user.role) >= 3
}
// Only a SUPER_ADMIN can delete accounts (existing behavior, preserved).
export function canDeleteUsers(user: CurrentUser | null): boolean {
  return !!user && user.role === 'SUPER_ADMIN'
}
/**
 * Can `actor` assign a given role to a user, or otherwise manage a user who currently
 * holds `targetRole`? SUPER_ADMIN can manage anyone (including other SUPER_ADMINs).
 * Everyone else can only manage strictly-lower-ranked accounts — this is what stops an
 * ADMIN from creating or editing another ADMIN or a SUPER_ADMIN account.
 */
export function canManageRole(actor: CurrentUser, targetRole: string): boolean {
  if (actor.role === 'SUPER_ADMIN') return true
  return rankOf(targetRole) < rankOf(actor.role)
}
