'use client'
import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('Fatal error:', error) }, [error])
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-800">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-3xl">⚠️</p>
          <h1 className="mt-3 text-lg font-bold text-slate-900">The portal hit an unexpected error</h1>
          <p className="mt-2 text-sm text-slate-500">Try again, or reload the page if it keeps happening.</p>
          {error.digest && <p className="mt-2 text-xs text-slate-400">Reference: {error.digest}</p>}
          <div className="mt-5 flex justify-center gap-2">
            <button onClick={() => reset()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Try again</button>
            <button onClick={() => window.location.reload()} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Reload page</button>
          </div>
        </div>
      </body>
    </html>
  )
}
