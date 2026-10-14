import type { BookingTheme } from "./types"

/**
 * Maps a theme to CSS custom properties for the `[data-booking-theme]` wrapper (ADR-008).
 * Color/radius names match the shadcn variables that `app/globals.css` `@theme inline`
 * already wires into Tailwind (bg-primary, border-input, rounded-lg, ...).
 *
 * Fonts use NEW names (--font-display/--font-body): globals.css declares --font-sans and
 * --font-serif inside `@theme inline`, so Tailwind inlines their literal values and a
 * wrapper override of those names would not reach the font-sans/font-serif utilities.
 */
export function themeToCssVars(theme: BookingTheme): Record<string, string> {
  const { palette: p, fonts, radii, shadows, motion } = theme
  const vars: Record<string, string> = {
    "--background": p.canvas,
    "--foreground": p.text,
    "--card": p.surface,
    "--card-foreground": p.surfaceText,
    "--popover": p.surface,
    "--popover-foreground": p.surfaceText,
    "--primary": p.primary,
    "--primary-foreground": p.onPrimary,
    "--primary-hover": p.primaryHover,
    "--secondary": p.subtle,
    "--secondary-foreground": p.subtleText,
    "--muted": p.muted,
    "--muted-foreground": p.textSecondary,
    "--accent": p.highlight,
    "--accent-foreground": p.highlightText,
    "--destructive": p.danger,
    "--destructive-foreground": p.onDanger,
    "--border": p.border,
    "--input": p.controlBorder,
    "--ring": p.focus,
    "--success": p.success,
    "--warning": p.warning,
    "--inverse": p.inverseSurface,
    "--inverse-foreground": p.onInverse,
    "--font-display": fonts.display,
    "--font-body": fonts.body,
    "--radius": radii.base,
    "--radius-button": radii.button,
    "--radius-card": radii.card,
    "--radius-media": radii.media,
    "--shadow-card": shadows.card,
    "--shadow-raised": shadows.raised,
    "--ease": motion.ease,
    "--dur": `${motion.durationMs}ms`,
  }
  if (p.decorative !== null) vars["--accent-expressive"] = p.decorative
  return vars
}
