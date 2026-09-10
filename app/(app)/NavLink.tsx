'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
export default function NavLink({ href, label }: { href: string; label: string }) {
  const path = usePathname()
  const active = path === href || (href !== '/dashboard' && path.startsWith(href))
  return <Link href={href} className={'nav ' + (active ? 'active' : '')}>{label}</Link>
}
