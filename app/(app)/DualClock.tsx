'use client'
import { useEffect, useState } from 'react'
function fmt(now: Date, tz: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(now)
}
export default function DualClock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  const Cell = ({ label, tz, dot }: { label: string; tz: string; dot: string }) => (
    <div className="flex flex-col justify-center px-3 py-1">
      <div className="flex items-center gap-1.5">
        <span className="relative flex h-1.5 w-1.5">
          <span className={'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ' + dot} />
          <span className={'relative inline-flex h-1.5 w-1.5 rounded-full ' + dot} />
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-400">{label}</span>
      </div>
      <span className="font-mono text-sm font-semibold tabular-nums text-white leading-none">{now ? fmt(now, tz) : '--:--:--'}</span>
    </div>
  )
  return (
    <div className="hidden items-stretch rounded-lg bg-ink-950 sm:flex">
      <Cell label="California · PT" tz="America/Los_Angeles" dot="bg-brand-500" />
      <div className="my-1.5 w-px bg-white/10" />
      <Cell label="Pakistan · PKT" tz="Asia/Karachi" dot="bg-emerald-500" />
    </div>
  )
}
