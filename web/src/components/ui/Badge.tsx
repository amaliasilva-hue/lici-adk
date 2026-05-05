import React from 'react';

export type BadgeVariant =
  | 'success' | 'warning' | 'danger' | 'info'
  | 'neutral' | 'mono'
  | 'apto' | 'ressalvas' | 'inapto' | 'nogo';

interface BadgeProps {
  variant?: BadgeVariant;
  /** For kanban phase badges — pass { color, bg } from STAGES array */
  phase?: { color: string; bg: string };
  size?: 'sm' | 'md';
  children: React.ReactNode;
  className?: string;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success:   'bg-[rgba(127,168,86,0.08)]  text-[#5A7A3A]  border-[rgba(127,168,86,0.3)]',
  warning:   'bg-[rgba(245,158,11,0.08)]  text-[#92400E]  border-[rgba(245,158,11,0.3)]',
  danger:    'bg-[rgba(148,51,53,0.08)]   text-[#943335]  border-[rgba(148,51,53,0.3)]',
  info:      'bg-[rgba(4,126,169,0.06)]   text-[#047EA9]  border-[rgba(4,126,169,0.2)]',
  neutral:   'bg-[rgba(100,116,139,0.08)] text-[#475569]  border-[rgba(100,116,139,0.25)]',
  mono:      'bg-slate-100 text-slate-600 border-slate-200',
  // Status específicos de análise
  apto:      'bg-[rgba(127,168,86,0.08)]  text-[#5A7A3A]  border-[rgba(127,168,86,0.3)]',
  ressalvas: 'bg-[rgba(245,158,11,0.08)]  text-[#92400E]  border-[rgba(245,158,11,0.3)]',
  inapto:    'bg-[rgba(148,51,53,0.08)]   text-[#943335]  border-[rgba(148,51,53,0.3)]',
  nogo:      'bg-[rgba(100,116,139,0.08)] text-[#475569]  border-[rgba(100,116,139,0.25)]',
};

const SIZE_CLASSES = {
  sm: 'text-[10px] px-1.5 py-0.5',
  md: 'text-[11px] px-2 py-0.5',
};

export default function Badge({
  variant = 'neutral',
  phase,
  size = 'sm',
  children,
  className = '',
}: BadgeProps) {
  const base = `inline-flex items-center font-bold uppercase tracking-wider rounded border leading-none ${SIZE_CLASSES[size]}`;

  if (phase) {
    return (
      <span
        className={`${base} ${className}`}
        style={{ backgroundColor: phase.bg, color: phase.color, borderColor: phase.color }}
      >
        {children}
      </span>
    );
  }

  return (
    <span className={`${base} ${VARIANT_CLASSES[variant]} ${className}`}>
      {children}
    </span>
  );
}
