/** Neutral refusal shown instead of revealing whether a record exists. */
export default function NotAvailable({ note }: { note?: string }) {
  return (
    <div className="card p-10 text-center">
      <h1 className="text-lg font-semibold text-slate-900">Not available</h1>
      <p className="mt-2 text-sm text-slate-500">{note || 'You do not have access to this page.'}</p>
    </div>
  )
}
