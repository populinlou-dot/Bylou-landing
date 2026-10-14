"use client"

import { AlertCircle, CalendarClock, ChevronRight, RotateCw, Search, Users } from "lucide-react"
import Link from "next/link"
import { useId, type FormEvent } from "react"
import { STUDENT_QUERY_MAX, adminStudentHref, type StudentSummary } from "../../application"
import { useBooking, useCopy } from "../../ui/booking-context"
import { SkeletonBlock, StatusPanel, buttonClass } from "../../ui/primitives"
import { inputClass } from "../form-fields"
import { balanceLabel, sessionWhen, studentName } from "./student-format"

/** The server returns at most this many rows per search (admin_search_students p_limit). */
export const STUDENT_SEARCH_LIMIT = 50

export type StudentsLoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; query: string; timezone: string; students: StudentSummary[] }

/** A4 students (`/admin/alumnas/?q=`): search box + results (presentational). */
export function StudentsView({
  query,
  load,
  onQueryChange,
  onSubmit,
  onRetry,
}: {
  query: string
  load: StudentsLoadState
  onQueryChange: (value: string) => void
  onSubmit: () => void
  onRetry: () => void
}) {
  const t = useCopy()
  const inputId = useId()
  const hintId = useId()

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <section className="flex flex-col gap-5" aria-labelledby="admin-students-title">
      <header className="flex flex-col gap-2">
        <h1 id="admin-students-title" className="[font-family:var(--font-display)] text-[28px] font-medium leading-tight text-foreground">
          {t("admin.students.title")}
        </h1>
        <p className="text-[15px] text-muted-foreground">{t("admin.students.intro")}</p>
      </header>

      <form role="search" noValidate onSubmit={submit} className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-[14.5px] font-semibold text-foreground">
          {t("admin.students.search")}
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-describedby={hintId}
            maxLength={STUDENT_QUERY_MAX}
            autoComplete="off"
            className={inputClass}
          />
          <button type="submit" className={`${buttonClass.primary} shrink-0`}>
            <Search aria-hidden="true" className="size-4" />
            {t("admin.students.submit")}
          </button>
        </div>
        <p id={hintId} className="text-[13.5px] text-muted-foreground">
          {t("admin.students.searchHint")}
        </p>
      </form>

      <StudentsResults load={load} onRetry={onRetry} />
    </section>
  )
}

function StudentsResults({ load, onRetry }: { load: StudentsLoadState; onRetry: () => void }) {
  const t = useCopy()

  if (load.status === "loading") {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <p role="status" aria-live="polite" className="sr-only">
          {t("admin.students.loading")}
        </p>
        <SkeletonBlock className="h-20 w-full rounded-[var(--radius-card)]" />
        <SkeletonBlock className="h-20 w-full rounded-[var(--radius-card)]" />
      </div>
    )
  }

  if (load.status === "error") {
    return (
      <StatusPanel
        role="alert"
        icon={<AlertCircle className="size-5" />}
        title={t("admin.students.error")}
        action={
          <button type="button" onClick={onRetry} className={buttonClass.primary}>
            <RotateCw aria-hidden="true" className="size-4" />
            {t("error.retry")}
          </button>
        }
      />
    )
  }

  if (load.students.length === 0) {
    return (
      <StatusPanel
        role="status"
        icon={<Users className="size-5" />}
        title={load.query ? t("admin.students.noResults", { q: load.query }) : t("admin.students.empty")}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p role="status" aria-live="polite" className="text-[14px] text-muted-foreground">
        {t("admin.students.results", { n: load.students.length })}
        {load.students.length >= STUDENT_SEARCH_LIMIT ? ` ${t("admin.students.limit", { n: STUDENT_SEARCH_LIMIT })}` : ""}
      </p>
      <ul role="list" className="flex flex-col gap-3">
        {load.students.map((student) => (
          <li key={student.userId}>
            <StudentRow student={student} timezone={load.timezone} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function StudentRow({ student, timezone }: { student: StudentSummary; timezone: string }) {
  const { brand } = useBooking()
  const t = useCopy()
  const name = studentName(student, t)
  const showEmail = Boolean(student.displayName?.trim() && student.email)
  return (
    <Link
      href={adminStudentHref(student.userId)}
      className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4 text-foreground [box-shadow:var(--shadow-card)] hover:border-primary"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {/* User-entered text: plain text only (React escapes it). */}
        <span className="truncate text-[16px] font-semibold">{name}</span>
        {showEmail ? <span className="truncate text-[14px] text-muted-foreground">{student.email}</span> : null}
        <span className="text-[14.5px] font-semibold text-primary">{balanceLabel(student.balance, t)}</span>
        <span className="flex items-center gap-1.5 text-[14px] text-muted-foreground">
          <CalendarClock aria-hidden="true" className="size-4 shrink-0" />
          {student.nextBooking
            ? t("admin.student.next", {
                date: `${sessionWhen(student.nextBooking.startsAt, timezone, brand.locale)} · ${student.nextBooking.classTypeName}`,
              })
            : t("admin.student.noNext")}
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
    </Link>
  )
}
