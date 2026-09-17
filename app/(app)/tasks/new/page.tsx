import { requirePageAccess } from '@/lib/ownership'
import { canAssignWorkToOthers, TASK_ASSIGNEE_ROLES } from '@/lib/authz'
import { getSql } from '@/lib/db'
import NotAvailable from '../../NotAvailable'
import TaskForm from './TaskForm'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function NewTask() {
  const scope = await requirePageAccess('task.create')
  if (!scope) return <NotAvailable note="You do not have permission to create tasks." />

  const sql = getSql()
  // Scoped roles may only assign work to themselves; managers pick from active,
  // permitted accounts. The list is built server-side so the form cannot offer
  // an option the API would reject.
  const assignees = canAssignWorkToOthers(scope.user.role)
    ? await sql<{ id: string; name: string }[]>`
        select id, name from users
         where status = 'ACTIVE' and role = any(${TASK_ASSIGNEE_ROLES as unknown as string[]})
         order by name`
    : [{ id: scope.user.id, name: scope.user.name }]

  return <TaskForm assignees={assignees} currentUserId={scope.user.id} />
}
