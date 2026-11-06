import type { CopyCatalog } from "../config/copy"
import type { FeatureFlags } from "../config/features"
import type { Terminology } from "../config/terminology"
import type { StudioRules } from "../domain"

/** Semantic color roles (UX_DESIGN.md §6). Values are CSS colors. */
export interface ThemePalette {
  canvas: string
  text: string
  surface: string
  surfaceText: string
  primary: string
  onPrimary: string
  primaryHover: string
  subtle: string
  subtleText: string
  muted: string
  textSecondary: string
  highlight: string
  highlightText: string
  border: string
  /** Form-control boundary, must reach 3:1 against canvas/surface. */
  controlBorder: string
  focus: string
  danger: string
  onDanger: string
  success: string
  warning: string
  inverseSurface: string
  onInverse: string
  /** Non-text decorative accent; null when the brand has none. */
  decorative: string | null
}

export interface BookingTheme {
  palette: ThemePalette
  fonts: {
    /** CSS font-family list for headings. */
    display: string
    /** CSS font-family list for body/UI text. */
    body: string
    /** Brand headings put one emphasis word in italic. */
    italicEmphasis: boolean
  }
  radii: { base: string; button: string; card: string; media: string }
  shadows: { card: string; raised: string }
  motion: { ease: string; durationMs: number }
}

export interface BrandLogo {
  /** Path relative to the site base path (e.g. "assets/ginkgo.png"), or null for a text wordmark. */
  src: string | null
  alt: string
  wordmark: string
}

export interface BrandContact {
  instagramDm: string | null
  email: string | null
}

export interface BrandConfig {
  /** Slug used in `[data-booking-theme]`. */
  id: string
  name: string
  locale: string
  /** DNS domain of the studio site (no scheme), e.g. "bylou.com.ar". Calendar event UIDs and the .ics PRODID use it. */
  domain: string
  logo: BrandLogo
  /** Optional imagery by slot (e.g. emptyState). Paths relative to the base path. */
  images: Record<string, string>
  contact: BrandContact
  theme: BookingTheme
  terminology: Terminology
  copy: CopyCatalog
  rules: StudioRules
  features: FeatureFlags
}
