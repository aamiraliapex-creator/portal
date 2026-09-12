'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
export default function NavLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  const path = usePathname()
  const active = path === href || (href !== '/dashboard' && path.startsWith(href))
  return <Link href={href} prefetch={false} className={'nav ' + (active ? 'active' : '')}><span className="nav-ico">{icon}</span>{label}</Link>
}
