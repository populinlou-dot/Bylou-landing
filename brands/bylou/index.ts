import { DEFAULT_FEATURE_FLAGS, DEFAULT_STUDIO_RULES } from "../../booking/config"
import type { BrandConfig } from "../../booking/theme"
import { bylouCopy, bylouTerminology } from "./copy"
import { bylouTheme } from "./theme"

/** Contact and logo: app/page.tsx L9-10 (EMAIL, ig.me DM) and L993 (ginkgo logo). */
export const bylouBrand: BrandConfig = {
  id: "bylou",
  name: "Yoga ByLou",
  locale: "es-AR",
  logo: { src: "assets/ginkgo.png", alt: "Yoga ByLou", wordmark: "Yoga ByLou" },
  images: { emptyState: "assets/ginkgo.png" },
  contact: { instagramDm: "https://ig.me/m/bylou.yoga", email: "yoga.byloupopulin@gmail.com" },
  theme: bylouTheme,
  terminology: bylouTerminology,
  copy: bylouCopy,
  rules: { ...DEFAULT_STUDIO_RULES, bookingWindow: { ...DEFAULT_STUDIO_RULES.bookingWindow } },
  features: { ...DEFAULT_FEATURE_FLAGS },
}
