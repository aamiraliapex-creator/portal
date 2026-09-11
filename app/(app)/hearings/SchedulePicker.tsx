'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type CaseOption = { id: string; label: string }

export default function SchedulePicker({ options }: { options: CaseOption[] }) {
  const router = useRouter()
  const [caseId, setCaseId] = useState(options[0]?.id || '')
  if (options.length === 0) return null
  return (
    <div className="card flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
      <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className="inp sm:max-w-sm">
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <button onClick={() => caseId && router.push(`/hearings/${caseId}`)} className="btn btn-red whitespace-nowrap">+ Schedule hearing</button>
    </div>
  )
}
