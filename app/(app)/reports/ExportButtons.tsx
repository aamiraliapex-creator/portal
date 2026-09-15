'use client'
export default function ExportButtons({ r }: { r: string }) {
  return (
    <div className="flex items-center gap-2">
      <a href={`/api/reports?r=${r}`} className="chip">↓ CSV</a>
      <button onClick={() => window.print()} className="chip">Print / PDF</button>
      <span className="text-[11px] text-slate-400">CSV opens in Excel &amp; Sheets</span>
    </div>
  )
}
