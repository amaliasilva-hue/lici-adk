import './globals.css';
import type { Metadata } from 'next';
import AppShell from '@/components/app-shell';

export const metadata: Metadata = {
  title: 'Lici · Xertica',
  description: 'Análise de licitações públicas com IA agêntica',
  icons: {
    icon:  'https://storage.googleapis.com/etp-bucket/Logos%20Xertica.ai%20(.png)/X%20-%20simbolo/Copy%20of%20X_symbol_variation4_Red_white.png',
    apple: 'https://storage.googleapis.com/etp-bucket/Logos%20Xertica.ai%20(.png)/X%20-%20simbolo/Copy%20of%20X_symbol_variation4_Red_white.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

