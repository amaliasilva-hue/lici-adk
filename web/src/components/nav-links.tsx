'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/',               label: 'Pipeline' },
  { href: '/historico',      label: 'Histórico' },
  { href: '/chat',           label: 'Chat IA' },
  { href: '/como-funciona',  label: 'Como funciona' },
];

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="hidden sm:flex items-center gap-0.5">
      {NAV.map(({ href, label }) => {
        const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 relative ${
              isActive
                ? 'text-[#047EA9] nav-active'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
