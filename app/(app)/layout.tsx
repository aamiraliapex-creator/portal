import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import LogoutButton from './LogoutButton'

const NAV = [
  ['Dashboard', '/dashboard'], ['Customers', '/customers'], ['Cases', '/cases'],
  ['Hearings', '/hearings'], ['Calendar', '/calendar'], ['Tasks', '/tasks'],
  ['Documents', '/documents'], ['Payments', '/payments'], ['Agents / Team', '/agents'],
  ['Reports', '/reports'], ['Notifications', '/notifications'], ['US Holidays', '/holidays'],
]
const ADMIN_NAV = [['Team & Users', '/users'], ['Audit Log', '/audit'], ['Settings', '/settings']]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col bg-ink-950 p-3 lg:flex">
        <div className="mb-4 flex items-center gap-3 border-b border-white/10 px-2 pb-4 pt-2">
          <img src="/logo.png" alt="CL" className="h-10 w-auto" />
          <div><p className="text-sm font-black text-white leading-none">CL PROTECTION</p><p className="mt-1 text-[10px] uppercase tracking-widest text-brand-500">Elite CDL Defense</p></div>
        </div>
        <nav className="flex-1 space-y-1">
          {NAV.map(([label, href]) => (
            <Link key={href} href={href} className="block rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white">{label}</Link>
          ))}
          <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Administration</p>
          {ADMIN_NAV.map(([label, href]) => (
            <Link key={href} href={href} className="block rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white">{label}</Link>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right leading-tight">
              <p className="text-sm font-medium text-slate-700">{session.name}</p>
              <p className="text-[11px] text-slate-400">{session.role.replace('_', ' ')}</p>
            </div>
<LogoutButton />
          </div>
        </header>
        <main className="p-4 sm:p-6">{children}</main>
      </div>
    </div>
  )
}
