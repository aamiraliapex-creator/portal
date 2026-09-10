import Link from 'next/link'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import { getSession } from '@/lib/session'
import UserActions from './UserActions'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type U = { id: string; name: string; email: string; role: string; status: string; last_login_at: string | null }

export default async function Users() {
  await ensureSchemaOnce()
  const s = await getSession()
  const sql = getSql()
  const rows = await sql<U[]>`select id, name, email, role, status, last_login_at from users order by created_at desc`
  const isSuper = s?.role === 'SUPER_ADMIN'
  const canManage = s?.role === 'SUPER_ADMIN' || s?.role === 'ADMIN'
  return (
    <div>
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-semibold text-slate-900">Team &amp; Users</h1><p className="text-sm text-slate-500">Staff accounts. Only a Super Admin can delete.</p></div>
        {canManage && <Link href="/users/new" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">+ Add user</Link>}
      </div>
      <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Last login</th><th className="px-4 py-3"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-3"><span className="font-medium text-slate-800">{u.name}</span><div className="text-slate-500">{u.email}</div></td>
                <td className="px-4 py-3 text-slate-600">{u.role.replace('_',' ')}</td>
                <td className="px-4 py-3"><span className={u.status==='ACTIVE'?'text-emerald-600':'text-rose-600'}>{u.status}</span></td>
                <td className="px-4 py-3 text-slate-500">{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'}</td>
                <td className="px-4 py-3">{canManage ? <UserActions id={u.id} status={u.status} canDelete={isSuper && u.id !== s?.id} /> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
