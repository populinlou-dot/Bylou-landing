/**
 * Remembers the student's last agenda filters on this device (PRD ST-01 AC4). A per-viewer
 * convenience only: storage can be missing or throw (private mode, blocked site data), and the
 * agenda must work exactly the same without it, so every access is wrapped.
 */
import { NO_AGENDA_FILTERS, parseAgendaFilters, serializeAgendaFilters, type AgendaFilters } from "../../application"

export const agendaFiltersKey = (brandId: string) => `booking:${brandId}:agenda-filters:v1`

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

export function loadAgendaFilters(brandId: string): AgendaFilters {
  try {
    return parseAgendaFilters(storage()?.getItem(agendaFiltersKey(brandId)) ?? null)
  } catch {
    return NO_AGENDA_FILTERS
  }
}

export function saveAgendaFilters(brandId: string, filters: AgendaFilters): void {
  try {
    storage()?.setItem(agendaFiltersKey(brandId), serializeAgendaFilters(filters))
  } catch {
    // Quota exceeded / storage disabled: the filter still applies for this visit.
  }
}
