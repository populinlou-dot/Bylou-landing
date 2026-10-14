import { describe, expect, it } from "vitest"
import { NO_AGENDA_FILTERS, parseAgendaFilters, reconcileAgendaFilters, serializeAgendaFilters } from "./agenda-filters"
import { CLASS_TYPES } from "./test-support"

describe("agenda filters (ST-01 AC4)", () => {
  it("round-trips practice + modality", () => {
    const filters = { classTypeId: "ct-grupal", modality: "online" as const }
    expect(parseAgendaFilters(serializeAgendaFilters(filters))).toEqual(filters)
  })

  it.each([null, "", "not json", "null", "[]", "42", '{"classTypeId":"<script>","modality":"zoom"}', '{"classTypeId":7}'])(
    "falls back to 'all' for %j",
    (raw) => {
      expect(parseAgendaFilters(raw)).toEqual(NO_AGENDA_FILTERS)
    },
  )

  it("keeps the valid half of a partially valid value", () => {
    expect(parseAgendaFilters('{"classTypeId":"ct-1","modality":"zoom"}')).toEqual({ classTypeId: "ct-1", modality: null })
  })

  it("forgets a remembered practice that is no longer published", () => {
    const kept = { classTypeId: "ct-grupal", modality: "in_person" as const }
    expect(reconcileAgendaFilters(kept, CLASS_TYPES)).toBe(kept)
    expect(reconcileAgendaFilters({ classTypeId: "ct-gone", modality: "online" }, CLASS_TYPES)).toEqual({
      classTypeId: null,
      modality: "online",
    })
  })
})
