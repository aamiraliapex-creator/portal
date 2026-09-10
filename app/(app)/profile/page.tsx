import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import ProfileForm from './ProfileForm'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export default async function Profile() {
  const s = await getSession(); if (!s) redirect('/login')
  return (<div><h1 className="text-xl font-semibold text-slate-900">My Profile</h1><ProfileForm name={s.name} email={s.email} role={s.role} /></div>)
}
