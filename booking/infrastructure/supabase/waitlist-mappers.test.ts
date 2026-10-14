import { describe, expect, it } from "vitest"
import { toWaitlistRosterEntry } from "./admin-mappers"
import { mapBookRpc, mapJoinWaitlistRpc, mapLeaveWaitlistRpc, mapMyWaitlistRpc } from "./mappers"

const SESSION = {
  id: "s1",
  class_type_id: "ct1",
  class_type_name: "Hatha",
  starts_at: "2026-10-17T13:00:00+00:00",
  ends_at: "2026-10-17T14:00:00+00:00",
  capacity: 8,
  modality: "in_person",
  status: "scheduled",
  instructor_name: "Lou",
}

describe("waitlist envelopes (migration 20261014001300)", () => {
  it("join_waitlist → entry, place and replay flag; refusals keep their code", () => {
    expect(mapJoinWaitlistRpc({ ok: true, code: null, replayed: false, entry_id: "w1", session_id: "s1", status: "waiting", position: 2 })).toEqual(
      { ok: true, entryId: "w1", status: "waiting", position: 2, replayed: false },
    )
    expect(mapJoinWaitlistRpc({ ok: true, entry_id: "w1", status: "promoted", position: null, replayed: true })).toEqual({
      ok: true,
      entryId: "w1",
      status: "promoted",
      position: null,
      replayed: true,
    })
    for (const code of [
      "session_not_full",
      "waitlist_closed",
      "waitlist_disabled",
      "already_booked",
      "too_many_changes",
      "profile_incomplete",
      "waitlist_full",
      "too_many_waitlists",
    ]) {
      expect(mapJoinWaitlistRpc({ ok: false, code })).toEqual({ ok: false, code })
    }
    expect(mapJoinWaitlistRpc({ ok: false, code: "surprise" })).toEqual({ ok: false, code: "unknown" })
    expect(mapJoinWaitlistRpc({ ok: true, entry_id: "w1", status: "weird" })).toEqual({ ok: false, code: "unknown" })
    expect(mapJoinWaitlistRpc(null)).toEqual({ ok: false, code: "unknown" })
  })

  it("leave_waitlist → latest status (a promotion is reported) and replay flag", () => {
    expect(mapLeaveWaitlistRpc({ ok: true, status: "left", replayed: false })).toEqual({ ok: true, status: "left", bookingId: null, replayed: false })
    expect(mapLeaveWaitlistRpc({ ok: true, status: "promoted", booking_id: "b9", replayed: true })).toEqual({
      ok: true,
      status: "promoted",
      bookingId: "b9",
      replayed: true,
    })
    expect(mapLeaveWaitlistRpc({ ok: false, code: "not_found" })).toEqual({ ok: false, code: "not_found" })
  })

  it("my_waitlist_entries → her entries; places only while waiting; malformed items dropped", () => {
    const entries = mapMyWaitlistRpc({
      ok: true,
      enabled: true,
      entries: [
        { entry_id: "w1", status: "waiting", position: 3, created_at: "2026-10-12T10:00:00+00:00", resolved_at: null, session: SESSION },
        {
          entry_id: "w2",
          status: "skipped",
          skip_reason: "no_valid_credit",
          position: 1,
          created_at: "2026-10-11T10:00:00+00:00",
          resolved_at: "2026-10-12T11:00:00+00:00",
          session: SESSION,
        },
        { entry_id: "w3", status: "waiting", created_at: "2026-10-12T10:00:00+00:00", session: { ...SESSION, modality: "ftp" } },
        "junk",
      ],
    })
    expect(entries).toEqual([
      {
        entryId: "w1",
        session: {
          id: "s1",
          classTypeId: "ct1",
          startsAt: "2026-10-17T13:00:00.000Z",
          endsAt: "2026-10-17T14:00:00.000Z",
          capacity: 8,
          modality: "in_person",
          status: "scheduled",
        },
        classTypeName: "Hatha",
        instructorName: "Lou",
        status: "waiting",
        skipReason: null,
        position: 3,
        bookingId: null,
        createdAt: "2026-10-12T10:00:00.000Z",
        resolvedAt: null,
      },
      expect.objectContaining({ entryId: "w2", status: "skipped", skipReason: "no_valid_credit", position: null }),
    ])
    for (const reason of ["profile_incomplete", "too_many_changes", "promotion_failed"]) {
      const [entry] = mapMyWaitlistRpc({
        ok: true,
        entries: [{ entry_id: "w", status: "skipped", skip_reason: reason, created_at: "2026-10-12T10:00:00+00:00", session: SESSION }],
      }) ?? []
      expect(entry?.skipReason).toBe(reason)
    }
    expect(mapMyWaitlistRpc({ ok: true, enabled: false, entries: [] })).toEqual([])
    expect(mapMyWaitlistRpc({ ok: false })).toBeNull()
  })

  it("book_session's profile_incomplete is a known code (required name)", () => {
    expect(mapBookRpc({ ok: false, code: "profile_incomplete" })).toEqual({ ok: false, code: "profile_incomplete" })
  })

  it("a staff waitlist row keeps raw names and canonical instants", () => {
    expect(
      toWaitlistRosterEntry({
        id: "w1",
        user_id: "u1",
        status: "waiting",
        skip_reason: null,
        created_at: "2026-10-12T10:00:00+00:00",
        resolved_at: null,
        profile: { display_name: "<b>Ana</b>", email: null },
      }),
    ).toEqual({
      entryId: "w1",
      userId: "u1",
      displayName: "<b>Ana</b>",
      email: null,
      status: "waiting",
      skipReason: null,
      joinedAt: "2026-10-12T10:00:00.000Z",
      resolvedAt: null,
    })
  })
})
