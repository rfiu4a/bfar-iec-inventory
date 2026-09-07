import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BFAR IEC Inventory',
  description: 'IEC materials inventory and distribution management',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
