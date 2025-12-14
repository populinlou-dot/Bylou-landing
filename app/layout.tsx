import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google"
import "./globals.css"

// Analytics solo en Vercel (no en GitHub Pages)
// En GitHub Pages no hay VERCEL env var, así que Analytics no se carga
let Analytics: React.ComponentType | null = null
if (process.env.VERCEL || (typeof process !== "undefined" && process.env.VERCEL_ENV)) {
  try {
    const analyticsModule = require("@vercel/analytics/next")
    Analytics = analyticsModule.Analytics
  } catch {
    // Ignore if not available (e.g., in GitHub Pages)
  }
}

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
})

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
})

export const metadata: Metadata = {
  title: "ByLou Yoga - Regulá tu sistema nervioso con yoga + neurociencia",
  description:
    "Clases de yoga con base científica. Regulá tu sistema nervioso, mejorá tu atención y gestioná el estrés con neurociencia práctica.",
  generator: "v0.app",
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} ${playfairDisplay.variable}`}>
      <head>
        {/* Carga explícita de Playfair Display para que se vea igual en producción */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased">
        {children}
        {Analytics && <Analytics />}
      </body>
    </html>
  )
}
