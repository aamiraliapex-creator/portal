import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'CL Protection USA — Portal',
  description: 'Traffic / CDL Case Management Portal',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-100 text-slate-800">{children}</body>
    </html>
  )
}
