'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECTIONS = [
  {
    label: 'Módulos',
    items: [
      {
        href: '/',
        label: 'Pipeline B2G',
        icon: (
          <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <path d="M8 7v7M16 7v9M12 7v4"/>
          </svg>
        ),
      },
      {
        href: '/analises',
        label: 'Análises',
        icon: (
          <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
          </svg>
        ),
      },
      {
        href: '/historico',
        label: 'Histórico',
        icon: (
          <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Ferramentas',
    items: [
      {
        href: '/chat',
        label: 'Chat IA',
        icon: (
          <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="10" rx="2"/>
            <circle cx="12" cy="5" r="2"/>
            <path d="M12 7v4"/>
            <line x1="8" y1="16" x2="8" y2="16"/>
            <line x1="16" y1="16" x2="16" y2="16"/>
          </svg>
        ),
      },
      {
        href: '/upload',
        label: 'Novo Edital',
        icon: (
          <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        ),
      },
      {
        href: '/como-funciona',
        label: 'Como funciona',
        icon: (
          <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01"/>
          </svg>
        ),
      },
    ],
  },
];

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-4">
      {SECTIONS.map((section) => (
        <div key={section.label}>
          <div className="sidebar-section-label">{section.label}</div>
          <div className="flex flex-col gap-0.5">
            {section.items.map(({ href, label, icon }) => {
              const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  title={label}
                  className={`sidebar-nav-item ${isActive ? 'sidebar-nav-item-active' : ''}`}
                >
                  <span className="shrink-0">{icon}</span>
                  <span className="sidebar-nav-text text-sm font-heading font-medium hidden lg:block">{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
