'use client'
export default function ExportButtons({ r }: { r: string }) {
  return (
    <div className="flex gap-2">
      <a href={`/api/reports?r=${r}`} className="chip">↓ CSV</a>
      <button onClick={() => window.print()} className="chip">↓ PDF</button>
    </div>
  )
}
