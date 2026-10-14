"use client"

import { useCallback, useEffect, useState } from "react"
import { listAdminClassTypes, type AdminClassTypeView, type SaveClassTypeResult } from "../../application"
import { useCopy } from "../../ui/booking-context"
import { useAdminRepository } from "../admin-context"
import { ClassTypeFormSheet } from "./class-type-form"
import { ClassTypesView, type ClassTypesLoadState } from "./class-types-view"

type Editor = { mode: "create" } | { mode: "edit"; type: AdminClassTypeView } | null

/** A5 class types for staff (render behind <StaffGuard>). Saves are server-confirmed, then reloaded. */
export function ClassTypesContainer() {
  const admin = useAdminRepository()
  const t = useCopy()
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<ClassTypesLoadState>({ status: "loading" })
  const [editor, setEditor] = useState<Editor>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoad({ status: "loading" })
    listAdminClassTypes({ admin }).then(
      (types) => {
        if (active) setLoad({ status: "ready", types })
      },
      (error: unknown) => {
        if (!active) return
        console.error("[admin] class types load failed", error)
        setLoad({ status: "error" })
      },
    )
    return () => {
      active = false
    }
  }, [admin, attempt])

  /** Background refresh after a save: keeps the list on screen; a failure keeps the old list. */
  const refresh = useCallback(() => {
    listAdminClassTypes({ admin }).then(
      (types) => setLoad({ status: "ready", types }),
      (error: unknown) => console.error("[admin] class types refresh failed", error),
    )
  }, [admin])

  function onSaved(result: Extract<SaveClassTypeResult, { ok: true }>) {
    setEditor(null)
    const archived = !result.isPublished
    const hidden = archived && result.upcomingSessions > 0 ? ` ${t("admin.classTypes.hiddenSessions", { n: result.upcomingSessions })}` : ""
    setNotice(archived ? `${t("admin.classTypes.archivedNotice")}${hidden}` : t("admin.classTypes.saved"))
    refresh()
  }

  return (
    <>
      <ClassTypesView
        load={load}
        notice={notice}
        onRetry={() => setAttempt((n) => n + 1)}
        onCreate={() => {
          setNotice(null)
          setEditor({ mode: "create" })
        }}
        onEdit={(type) => {
          setNotice(null)
          setEditor({ mode: "edit", type })
        }}
      />
      {editor ? (
        <ClassTypeFormSheet
          key={editor.mode === "edit" ? editor.type.id : "new"}
          initial={editor.mode === "edit" ? editor.type : null}
          onClose={() => setEditor(null)}
          onSaved={onSaved}
        />
      ) : null}
    </>
  )
}
