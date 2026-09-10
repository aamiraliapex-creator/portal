import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import { getSession } from '@/lib/session'
import LogoutButton from './LogoutButton'
import DualClock from './DualClock'
import NavLink from './NavLink'

const NAV: [string, string, string][] = [
  ['▚', 'Dashboard', '/dashboard'], ['◧', 'Customers', '/customers'], ['▤', 'Cases', '/cases'],
  ['$', 'Payments', '/payments'], ['✓', 'Tasks', '/tasks'], ['⚖', 'Hearings', '/hearings'],
  ['▦', 'Calendar', '/calendar'], ['▧', 'Documents', '/documents'], ['◍', 'Agents / Team', '/agents'],
  ['▥', 'Reports', '/reports'], ['◔', 'Notifications', '/notifications'], ['🎉', 'US Holidays', '/holidays'],
]
const ADMIN: [string, string, string][] = [['◐', 'Team & Users', '/users'], ['▣', 'Audit Log', '/audit'], ['⚙', 'Settings', '/settings']]

async function alertCount(): Promise<number> {
  try {
    await ensureSchemaOnce()
    const sql = getSql()
    const [a] = await sql<{ n: number }[]>`
      select ((select count(*) from payments where status in ('Pending','Overdue'))
            + (select count(*) from cases k where k.fee is not null and k.fee > coalesce((select sum(p.amount) from payments p where p.case_id=k.id and p.status='Paid'),0)))::int as n`
    return a?.n || 0
  } catch { return 0 }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')
  const alerts = await alertCount()
  const initials = session.name.split(' ').map((s) => s[0]).slice(0, 2).join('')
  return (
    <div className="flex min-h-screen bg-slate-100">
      <aside className="hidden w-60 shrink-0 flex-col bg-ink-950 p-3 lg:flex">
        <div className="mb-4 flex items-center gap-3 border-b border-white/10 px-2 pb-4 pt-2">
          <img src="/logo.png" alt="CL" className="h-11 w-auto" />
          <div><p className="text-sm font-black leading-none text-white">CL PROTECTION</p><p className="mt-1 text-[10px] uppercase tracking-widest text-brand-500">Elite CDL Defense</p></div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto">
          {NAV.map(([icon, label, href]) => <NavLink key={href} href={href} label={label} icon={icon} />)}
          <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Administration</p>
          {ADMIN.map(([icon, label, href]) => <NavLink key={href} href={href} label={label} icon={icon} />)}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
          <DualClock />
          <div className="ml-auto flex items-center gap-3">
            <Link href="/notifications" className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Notifications">
              <span className="text-lg">🔔</span>
              {alerts > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">{alerts > 99 ? '99+' : alerts}</span>}
            </Link>
            <Link href="/profile" className="text-right leading-tight hover:opacity-80">
              <p className="text-sm font-medium text-slate-700">{session.name}</p>
              <p className="text-[11px] text-slate-400">{session.role.replace('_', ' ')}</p>
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-950 text-xs font-bold text-white">{initials}</div>
            <LogoutButton />
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  )
}
