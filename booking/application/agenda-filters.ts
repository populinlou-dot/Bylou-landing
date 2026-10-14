/**
 * Agenda filters (PRD ST-01 AC4): practice (class type) and modality, remembered per device.
 * Pure parsing of whatever the browser storage returns: unknown shapes fall back to "all".
 */
import type { Modality } from "../domain"
import type { ClassTypeView } from "./ports"

export const MODALITIES: readonly Modality[] = ["in_person", "online"]

export interface AgendaFilters {
  /** null = every practice. */
  classTypeId: string | null
  /** null = every modality. */
  modality: Modality | null
}

export const NO_AGENDA_FILTERS: AgendaFilters = { classTypeId: null, modality: null }

/** Class type ids are opaque tokens (uuid in Supabase, slugs in the mock). */
const CLASS_TYPE_ID = /^[A-Za-z0-9_-]{1,100}$/

const isModality = (value: unknown): value is Modality => MODALITIES.includes(value as Modality)

/** Accepts a stored JSON string (or null); anything malformed or tampered with becomes "all". */
export function parseAgendaFilters(raw: string | null): AgendaFilters {
  if (!raw) return NO_AGENDA_FILTERS
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return NO_AGENDA_FILTERS
  }
  if (typeof data !== "object" || data === null) return NO_AGENDA_FILTERS
  const { classTypeId, modality } = data as Record<string, unknown>
  return {
    classTypeId: typeof classTypeId === "string" && CLASS_TYPE_ID.test(classTypeId) ? classTypeId : null,
    modality: isModality(modality) ? modality : null,
  }
}

export function serializeAgendaFilters(filters: AgendaFilters): string {
  return JSON.stringify({ classTypeId: filters.classTypeId, modality: filters.modality })
}

/** A remembered practice that is no longer published falls back to "all" (otherwise no chip is pressed). */
export function reconcileAgendaFilters(filters: AgendaFilters, classTypes: readonly ClassTypeView[]): AgendaFilters {
  if (filters.classTypeId === null || classTypes.some((ct) => ct.id === filters.classTypeId)) return filters
  return { ...filters, classTypeId: null }
}
