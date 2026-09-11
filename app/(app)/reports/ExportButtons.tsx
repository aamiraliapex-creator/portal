'use client'
export default function ExportButtons({ r }: { r: string }) {
  return (
    <div className="flex gap-2">
      <a href={`/api/reports?r=${r}&format=csv`} className="chip">↓ CSV</a>
      <a href={`/api/reports?r=${r}&format=xlsx`} className="chip">↓ XLSX</a>
      <button onClick={() => window.print()} className="chip">↓ PDF</button>
    </div>
  )
}
