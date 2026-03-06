import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sift — AI Schedule Planner',
  description: 'AI-powered schedule planner for people with ADHD',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="antialiased">
          {children}
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  );
}
