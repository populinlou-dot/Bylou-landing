"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { adminStudentsHref, normalizeStudentQuery, searchStudents } from "../../application"
import { useReadyRuntime } from "../../ui/booking-context"
import { useAdminRepository } from "../admin-context"
import { StudentsView, type StudentsLoadState } from "./students-view"

/** Student search for staff (render behind <StaffGuard>). The query lives in `?q=` (deep link, back button). */
export function StudentsContainer({ initialQuery }: { initialQuery: string }) {
  const admin = useAdminRepository()
  const { repository } = useReadyRuntime()
  const router = useRouter()
  const [query, setQuery] = useState(initialQuery)
  const [submitted, setSubmitted] = useState(() => normalizeStudentQuery(initialQuery))
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<StudentsLoadState>({ status: "loading" })

  useEffect(() => {
    let active = true
    setLoad({ status: "loading" })
    Promise.all([repository.getStudioRules(), searchStudents({ admin }, submitted)]).then(
      ([rules, students]) => {
        if (active) setLoad({ status: "ready", query: submitted, timezone: rules.timezone, students })
      },
      (error: unknown) => {
        if (!active) return
        console.error("[admin] student search failed", error)
        setLoad({ status: "error" })
      },
    )
    return () => {
      active = false
    }
  }, [admin, repository, submitted, attempt])

  function onSubmit() {
    const next = normalizeStudentQuery(query)
    if (next === submitted) setAttempt((n) => n + 1)
    else setSubmitted(next)
    router.replace(adminStudentsHref(next))
  }

  return (
    <StudentsView
      query={query}
      load={load}
      onQueryChange={setQuery}
      onSubmit={onSubmit}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  )
}

/** Route adapter: reads `?q=` on the client. Render inside <Suspense> (static export). */
export function StudentsFromSearchParams() {
  const q = useSearchParams().get("q") ?? ""
  return <StudentsContainer initialQuery={q} />
}
