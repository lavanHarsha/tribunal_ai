import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Fraunces, Hanken_Grotesk, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

/**
 * Self-hosted, distinctive type pairing — an editorial serif for display, a warm
 * grotesk for UI/body, and a mono for micro-labels. Loaded via next/font so there
 * is no layout shift and no third-party request at runtime.
 */
const fraunces = Fraunces({ subsets: ['latin'], variable: '--ff-serif', display: 'swap' })
const hanken = Hanken_Grotesk({ subsets: ['latin'], variable: '--ff-sans', display: 'swap' })
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--ff-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'TRIBUNAL — Think it through.',
  description: 'A clearer way to examine complex questions from every side.',
  generator: 'TRIBUNAL',
  icons: { icon: '/icon.svg' },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f3ef' },
    { media: '(prefers-color-scheme: dark)', color: '#181917' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${hanken.variable} ${plexMono.variable}`}>
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
