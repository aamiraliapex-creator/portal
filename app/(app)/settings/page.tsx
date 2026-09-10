import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import SettingsForm from './SettingsForm'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export default async function Settings() {
  await ensureSchemaOnce()
  const sql = getSql()
  const rows = await sql<{ key: string; value: string }[]>`select key, value from settings`
  const initial: Record<string,string> = {}; rows.forEach((r)=>{ initial[r.key]=r.value })
  return (<div><h1 className="text-xl font-semibold text-slate-900">Settings</h1><p className="text-sm text-slate-500">Portal configuration.</p><SettingsForm initial={initial} /></div>)
}
