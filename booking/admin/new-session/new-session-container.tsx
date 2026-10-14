"use client"

import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  DEFAULT_REPEAT_WEEKS,
  createSessions,
  getNewSessionForm,
  sessionOccurrences,
  validateSessionDraft,
  type AdminClassTypeView,
  type FieldErrors,
  type SessionDraft,
  type SessionField,
} from "../../application"
import { useReadyRuntime } from "../../ui/booking-context"
import { newIdempotencyKey } from "../../ui/idempotency"
import { useAdminRepository } from "../admin-context"
import { parseWholeNumber } from "../form-fields"
import { NewSessionView, type NewSessionLoadState, type NewSessionPhase, type NewSessionValues } from "./new-session-view"

/** Fresh values for a class type: its defaults, the given day, no time yet. */
export function initialValues(classType: AdminClassTypeView | undefined, date: string): NewSessionValues {
  return {
    classTypeId: classType?.id ?? "",
    date,
    time: "",
    duration: classType ? String(classType.durationMinutes) : "",
    capacity: classType ? String(classType.defaultCapacity) : "",
    modality: classType?.defaultModality ?? "in_person",
    address: "",
    locationLabel: "",
    meetingUrl: "",
    instructorName: "",
    repeat: false,
    weeks: String(DEFAULT_REPEAT_WEEKS),
  }
}

export function toSessionDraft(values: NewSessionValues): SessionDraft {
  return {
    classTypeId: values.classTypeId,
    localDate: values.date,
    localStart: values.time,
    durationMinutes: parseWholeNumber(values.duration),
    capacity: parseWholeNumber(values.capacity),
    modality: values.modality,
    locationLabel: values.locationLabel,
    address: values.address,
    meetingUrl: values.meetingUrl,
    instructorName: values.instructorName,
    repeatWeeks: values.repeat ? parseWholeNumber(values.weeks) : 1,
  }
}

const EMPTY_VALUES: NewSessionValues = {
  classTypeId: "",
  date: "",
  time: "",
  duration: "",
  capacity: "",
  modality: "in_person",
  address: "",
  locationLabel: "",
  meetingUrl: "",
  instructorName: "",
  repeat: false,
  weeks: String(DEFAULT_REPEAT_WEEKS),
}

/**
 * Creates one session or a weekly series in one server call (render behind <StaffGuard>).
 * The request key lives as long as this form: a retry after a timeout or a double click replays
 * the original call instead of publishing the series twice. It changes only for "Publicar otra".
 */
export function NewSessionContainer({ date }: { date: string | null }) {
  const { repository, clock } = useReadyRuntime()
  const admin = useAdminRepository()
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<NewSessionLoadState>({ status: "loading" })
  const [values, setValues] = useState<NewSessionValues>(EMPTY_VALUES)
  const [errors, setErrors] = useState<FieldErrors<SessionField>>({})
  const [phase, setPhase] = useState<NewSessionPhase>({ status: "idle" })
  const [requestKey, setRequestKey] = useState(newIdempotencyKey)
  const inFlight = useRef(false)

  useEffect(() => {
    let active = true
    setLoad({ status: "loading" })
    getNewSessionForm({ admin, repository, clock }, { date }).then(
      (form) => {
        if (!active) return
        setLoad({ status: "ready", form })
        setValues(initialValues(form.classTypes[0], form.defaultDate))
      },
      (error: unknown) => {
        if (!active) return
        console.error("[admin] new session form load failed", error)
        setLoad({ status: "error" })
      },
    )
    return () => {
      active = false
    }
  }, [admin, repository, clock, date, attempt])

  const timezone = load.status === "ready" ? load.form.timezone : null
  const occurrences = useMemo(() => {
    if (!timezone) return []
    const weeks = values.repeat ? parseWholeNumber(values.weeks) : 1
    return sessionOccurrences(values.date, values.time, weeks, timezone)
  }, [timezone, values.date, values.time, values.repeat, values.weeks])

  function onClassTypeChange(classTypeId: string) {
    if (load.status !== "ready") return
    const classType = load.form.classTypes.find((ct) => ct.id === classTypeId)
    // A new class type brings its defaults; date, time, place and repetition are kept.
    setValues((prev) => ({
      ...prev,
      classTypeId,
      duration: classType ? String(classType.durationMinutes) : prev.duration,
      capacity: classType ? String(classType.defaultCapacity) : prev.capacity,
      modality: classType?.defaultModality ?? prev.modality,
    }))
  }

  async function submit() {
    if (inFlight.current || load.status !== "ready") return
    const draft = toSessionDraft(values)
    const found = validateSessionDraft(draft, { now: clock.now(), timezone: load.form.timezone })
    setErrors(found)
    if (Object.keys(found).length > 0) return
    inFlight.current = true
    setPhase({ status: "pending" })
    const result = await createSessions({ admin, clock }, { ...draft, requestKey }, { timezone: load.form.timezone })
    inFlight.current = false
    if (result.ok) {
      setPhase({ status: "done", count: result.sessionIds.length, replayed: result.replayed, firstDate: draft.localDate })
      return
    }
    if (result.code === "unknown") console.error("[admin] create_session returned an unmapped result")
    setPhase({ status: "failed", code: result.code })
  }

  function another() {
    if (load.status !== "ready") return
    const classType = load.form.classTypes.find((ct) => ct.id === values.classTypeId) ?? load.form.classTypes[0]
    setRequestKey(newIdempotencyKey())
    setValues(initialValues(classType, values.date))
    setErrors({})
    setPhase({ status: "idle" })
  }

  return (
    <NewSessionView
      load={load}
      values={values}
      errors={errors}
      phase={phase}
      occurrences={occurrences}
      onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
      onClassTypeChange={onClassTypeChange}
      onSubmit={() => void submit()}
      onAnother={another}
      onRetryLoad={() => setAttempt((n) => n + 1)}
    />
  )
}

/** Route adapter: reads `?dia=YYYY-MM-DD` on the client. Render inside <Suspense> (static export). */
export function NewSessionFromSearchParams() {
  const date = useSearchParams().get("dia")
  return <NewSessionContainer key={date ?? ""} date={date} />
}
