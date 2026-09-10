'use client'
import { useEffect, useState } from 'react'

function useNow() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  return now
}
function fmt(now: Date, tz: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(now)
}
export default function DualClock() {
  const now = useNow()
  const Cell = ({ label, tz, dot }: { label: string; tz: string; dot: string }) => (
    <div className="flex items-center gap-1.5">
      <span className={'inline-block h-1.5 w-1.5 animate-pulse rounded-full ' + dot} />
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
      <span className="tabular-nums text-[11px] font-semibold text-slate-800">{now ? fmt(now, tz) : '—'}</span>
    </div>
  )
  return (
    <div className="hidden items-center gap-4 sm:flex">
      <Cell label="California" tz="America/Los_Angeles" dot="bg-brand-500" />
      <Cell label="Pakistan" tz="Asia/Karachi" dot="bg-emerald-500" />
    </div>
  )
}
