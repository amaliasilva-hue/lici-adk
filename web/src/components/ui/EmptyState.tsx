import Link from 'next/link';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  compact?: boolean;
}

const DefaultIcon = () => (
  <svg
    width={40} height={40}
    fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"
    className="text-slate-300"
  >
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
  </svg>
);

export default function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: EmptyStateProps) {
  const wrapper = compact
    ? 'flex flex-col items-center justify-center py-8 px-4 gap-2 text-center'
    : 'flex flex-col items-center justify-center py-16 px-6 gap-3 text-center';

  const titleClass = compact ? 'text-sm font-heading font-semibold text-slate-500' : 'text-base font-heading font-semibold text-slate-600';
  const descClass  = compact ? 'text-xs text-slate-400 max-w-[180px]' : 'text-sm text-slate-400 max-w-xs leading-relaxed';

  return (
    <div className={wrapper}>
      <div className={compact ? 'opacity-60' : 'opacity-50 mb-1'}>
        {icon ?? <DefaultIcon />}
      </div>

      <p className={titleClass}>{title}</p>

      {description && (
        <p className={descClass}>{description}</p>
      )}

      {action && (
        action.href ? (
          <Link
            href={action.href}
            className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-heading font-semibold rounded-lg bg-[#047EA9] text-white hover:bg-[#038CBC] transition-colors"
          >
            {action.label}
          </Link>
        ) : (
          <button
            onClick={action.onClick}
            className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-heading font-semibold rounded-lg bg-[#047EA9] text-white hover:bg-[#038CBC] transition-colors"
          >
            {action.label}
          </button>
        )
      )}
    </div>
  );
}
