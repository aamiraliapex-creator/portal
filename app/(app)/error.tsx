'use client'
import { useEffect } from 'react'

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('Page error:', error) }, [error])
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <div className="card max-w-md p-8">
        <p className="text-3xl">⚠️</p>
        <h1 className="mt-3 text-lg font-bold text-slate-900">Something went wrong loading this page</h1>
        <p className="mt-2 text-sm text-slate-500">This is usually temporary. Try again, or reload the page if it keeps happening.</p>
        {error.digest && <p className="mt-2 text-xs text-slate-400">Reference: {error.digest}</p>}
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={() => reset()} className="btn btn-red">Try again</button>
          <button onClick={() => window.location.reload()} className="btn btn-ghost">Reload page</button>
        </div>
      </div>
    </div>
  )
}
