export interface FeatureFlags {
  /** Waitlist on full sessions (Phase 4). */
  waitlist: boolean
  /** Sessions with capacity > 1 offered to students. */
  groupSessions: boolean
  /** Separate practice catalog step before the agenda (studios with many class types). */
  showCatalogStep: boolean
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  waitlist: false,
  groupSessions: false,
  showCatalogStep: false,
}
