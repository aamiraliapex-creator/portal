import { requirePageAccess } from '@/lib/ownership'
import NotAvailable from '../../NotAvailable'
import UserForm from './UserForm'
export const dynamic = 'force-dynamic'

export default async function NewUser() {
  const scope = await requirePageAccess('user.manage')
  if (!scope) return <NotAvailable />
  return <UserForm />
}
