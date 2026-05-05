interface ScoreIndicatorProps {
  score?: number | null;
  showLabel?: boolean;
  size?: 'sm' | 'md';
  thresholds?: { good: number; warning: number };
}

const BrainIcon = ({ size }: { size: number }) => (
  <svg
    width={size} height={size}
    fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"
  >
    <path d="M9.5 2A2.5 2.5 0 007 4.5v15A2.5 2.5 0 009.5 22h5a2.5 2.5 0 002.5-2.5v-15A2.5 2.5 0 0014.5 2h-5z"/>
    <path d="M7 4.5v15M17 4.5v15"/>
  </svg>
);

export default function ScoreIndicator({
  score,
  showLabel = false,
  size = 'sm',
  thresholds = { good: 75, warning: 55 },
}: ScoreIndicatorProps) {
  if (score == null) return null;

  const variant =
    score >= thresholds.good    ? 'success' :
    score >= thresholds.warning ? 'warning' : 'danger';

  const colorMap = {
    success: { pill: 'bg-[#F2FCE3] border-[#D9F99D] text-[#5A7A3A]', label: 'Apto' },
    warning: { pill: 'bg-[#FEF9C3] border-[#FDE047] text-[#B45309]', label: 'Atenção' },
    danger:  { pill: 'bg-[#FCF0F0] border-[#FECACA] text-[#943335]', label: 'Risco' },
  };

  const { pill, label } = colorMap[variant];
  const iconSize = size === 'sm' ? 10 : 12;
  const textClass = size === 'sm' ? 'text-[11px]' : 'text-xs';

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-mono font-bold shadow-sm ${textClass} ${pill}`}>
      <BrainIcon size={iconSize} />
      {score}%
      {showLabel && (
        <span className="ml-0.5 text-[10px] font-heading uppercase tracking-wide">{label}</span>
      )}
    </div>
  );
}
