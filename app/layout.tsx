import type React from "react"
import type { Metadata } from "next"
import Script from "next/script"
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

// BasePath para iconos (usar variable de entorno del cliente)
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ""

export const metadata: Metadata = {
  title: "ByLou Yoga - Regulá tu sistema nervioso con yoga + neurociencia",
  description:
    "Clases de yoga con base científica. Regulá tu sistema nervioso, mejorá tu atención y gestioná el estrés con neurociencia práctica.",
  generator: "v0.app",
  icons: {
    icon: `${basePath}/icon.png`,
    apple: `${basePath}/apple-icon.png`,
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
        {/* Favicon con basePath correcto */}
        <link rel="icon" type="image/png" sizes="32x32" href={`${basePath}/icon.png`} />
        <link rel="apple-touch-icon" href={`${basePath}/apple-icon.png`} />
        {/* Carga explícita de Playfair Display para que se vea igual en producción */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased">
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '1132708312685401');
            fbq('track', 'PageView');
          `}
        </Script>
        <noscript>
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            src="https://www.facebook.com/tr?id=1132708312685401&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
        {children}
        {Analytics && <Analytics />}
      </body>
    </html>
  )
}
