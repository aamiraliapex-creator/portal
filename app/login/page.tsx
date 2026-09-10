import { Suspense } from 'react'
import LoginForm from './LoginForm'

export const dynamic = 'force-dynamic'

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 p-4">
      <Suspense fallback={<div className="text-slate-400">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
