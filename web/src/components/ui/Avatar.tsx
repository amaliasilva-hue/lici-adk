interface AvatarProps {
  name?: string;
  email?: string;
  size?: number;
  className?: string;
}

function getInitials(name?: string, email?: string): string {
  if (name && name.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }
  if (email) {
    return email.split('@')[0].slice(0, 2).toUpperCase();
  }
  return 'XE';
}

export default function Avatar({ name, email, size = 28, className = '' }: AvatarProps) {
  const initials = getInitials(name, email);
  const fontSize = Math.round(size * 0.38);

  return (
    <div
      className={`rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        fontSize,
        background: 'linear-gradient(135deg, #047EA9, #00BEFF)',
        boxShadow: '0 2px 8px rgba(4,126,169,0.25)',
      }}
      aria-label={name || email || 'Usuário'}
    >
      {initials}
    </div>
  );
}
