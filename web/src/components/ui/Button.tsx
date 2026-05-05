import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ai';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  loading?: boolean;
  children?: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-r from-[#047EA9] to-[#038CBC] text-white shadow-[0_2px_8px_rgba(4,126,169,0.3)] hover:from-[#058ec0] hover:to-[#30d4ff] hover:-translate-y-px active:translate-y-0',
  secondary:
    'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-sm',
  ghost:
    'bg-transparent text-[#047EA9] hover:bg-[rgba(4,126,169,0.07)]',
  danger:
    'bg-[#E14849] text-white shadow-[0_2px_8px_rgba(225,72,73,0.25)] hover:bg-[#c73e3f]',
  ai:
    'bg-[#E6F7FF] text-[#047EA9] border border-[#BAE6FD] hover:bg-[#047EA9] hover:text-white hover:border-[#047EA9]',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-sm gap-2',
};

const SpinnerIcon = () => (
  <svg
    className="animate-spin"
    width={14} height={14} fill="none" viewBox="0 0 24 24"
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
  </svg>
);

export default function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center font-heading font-semibold rounded-lg transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#047EA9] focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none';

  return (
    <button
      className={`${base} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <SpinnerIcon /> : icon}
      {children}
    </button>
  );
}
