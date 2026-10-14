import type { BookingTheme } from "../../booking/theme"

/**
 * Bylou booking theme built from the REAL landing tokens (not the unused v0 shadcn
 * defaults in app/globals.css). Sources, app/page.tsx unless noted:
 * - #4A0000 ink, #FDECEC blush: L692 (body); #A41D2D / #8B1A28 link + hover: L693-694
 * - #6B0505 ink-soft, #F3DADA card border, card shadow: L284-287 (plan card tokens)
 * - #FFF5F5 blush-soft: L319; #FFF8F8 canvas (hero/meditation bg): L1158, L1606
 * - #FCF7E8 butter-wash, #D75B86 fucsia, --r-sm 7px / --r-md 11px: L702-737 (:root)
 * - raised shadow: L1047 (nav panel); focus outline #A41D2D: L845; EASE: L12
 * - fonts: app/layout.tsx L18-31 (next/font vars --font-geist-sans, --font-playfair)
 * Not on the landing (UX_DESIGN.md §5.1, contrast-derived): controlBorder #A86B74,
 * danger #B42318, success #1E6B3A, warning #8A5A00.
 */
export const bylouTheme: BookingTheme = {
  palette: {
    canvas: "#FFF8F8",
    text: "#4A0000",
    surface: "#FFFFFF",
    surfaceText: "#4A0000",
    primary: "#A41D2D",
    onPrimary: "#FFFFFF",
    primaryHover: "#8B1A28",
    subtle: "#FDECEC",
    subtleText: "#A41D2D",
    muted: "#FFF5F5",
    textSecondary: "#6B0505",
    highlight: "#FCF7E8",
    highlightText: "#4A0000",
    border: "#F3DADA",
    controlBorder: "#A86B74",
    focus: "#A41D2D",
    danger: "#B42318",
    onDanger: "#FFFFFF",
    success: "#1E6B3A",
    warning: "#8A5A00",
    inverseSurface: "#4A0000",
    onInverse: "#FFFFFF",
    decorative: "#D75B86",
  },
  fonts: {
    display: 'var(--font-playfair), "Playfair Display", Georgia, serif',
    body: 'var(--font-geist-sans), "Geist", ui-sans-serif, system-ui, sans-serif',
    italicEmphasis: true,
  },
  radii: {
    base: "0.6875rem",
    button: "999px",
    card: "22px",
    media: "280px 280px 30px 30px",
  },
  shadows: {
    card: "0 22px 50px -34px rgba(74,0,0,.5)",
    raised: "0 30px 70px -34px rgba(74,0,0,.5)",
  },
  motion: { ease: "cubic-bezier(.22,.61,.36,1)", durationMs: 240 },
}
