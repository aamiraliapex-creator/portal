import { redirect } from 'next/navigation'
import { getCurrentUser, canManageUsers, ROLES, canManageRole } from '@/lib/authz'
import UserForm from './UserForm'
export const dynamic = 'force-dynamic'

export default async function NewUser() {
  const actor = await getCurrentUser()
  if (!canManageUsers(actor)) redirect('/users')
  // Only offer roles this actor is actually allowed to grant — an ADMIN submitting
  // ADMIN/SUPER_ADMIN would just get a 403 back from the server, so we don't show those
  // options in the first place. A SUPER_ADMIN sees the full list.
  const allowedRoles = ROLES.filter((r) => canManageRole(actor!, r))
  return <UserForm allowedRoles={allowedRoles} />
}
