"use client"

import { AlertCircle, Layers, Pencil, Plus, RotateCw } from "lucide-react"
import { useId } from "react"
import type { AdminClassTypeView } from "../../application"
import { useCopy } from "../../ui/booking-context"
import { cx } from "../../ui/format"
import { Badge, SkeletonBlock, StatusPanel, buttonClass } from "../../ui/primitives"
import { ModalityIcon } from "../../ui/session-meta"

export type ClassTypesLoadState = { status: "loading" } | { status: "error" } | { status: "ready"; types: AdminClassTypeView[] }

/** A5 class types (`/admin/practicas/`): presentational, data from ClassTypesContainer. */
export function ClassTypesView({
  load,
  notice,
  onRetry,
  onCreate,
  onEdit,
}: {
  load: ClassTypesLoadState
  notice: string | null
  onRetry: () => void
  onCreate: () => void
  onEdit: (type: AdminClassTypeView) => void
}) {
  const t = useCopy()

  if (load.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <p role="status" aria-live="polite" className="sr-only">
          {t("admin.classTypes.loading")}
        </p>
        <div aria-hidden="true" className="flex flex-col gap-3">
          <SkeletonBlock className="h-9 w-48" />
          <SkeletonBlock className="h-20 w-full rounded-[var(--radius-card)]" />
          <SkeletonBlock className="h-20 w-full rounded-[var(--radius-card)]" />
        </div>
      </div>
    )
  }

  if (load.status === "error") {
    return (
      <StatusPanel
        role="alert"
        titleAs="h1"
        icon={<AlertCircle className="size-5" />}
        title={t("admin.classTypes.error")}
        action={
          <button type="button" onClick={onRetry} className={buttonClass.primary}>
            <RotateCw aria-hidden="true" className="size-4" />
            {t("error.retry")}
          </button>
        }
      />
    )
  }

  return (
    <section className="flex flex-col gap-5" aria-labelledby="admin-class-types-title">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 id="admin-class-types-title" className="[font-family:var(--font-display)] text-[28px] font-medium leading-tight text-foreground">
            {t("admin.classTypes.title")}
          </h1>
          <button type="button" onClick={onCreate} className={buttonClass.primary}>
            <Plus aria-hidden="true" className="size-4" />
            {t("admin.classTypes.new")}
          </button>
        </div>
        <p className="text-[15px] text-muted-foreground">{t("admin.classTypes.intro")}</p>
      </header>

      <p role="status" aria-live="polite" className="text-[14.5px] font-semibold text-[color:var(--success)] empty:hidden">
        {notice ?? ""}
      </p>

      {load.types.length === 0 ? (
        <StatusPanel role="status" icon={<Layers className="size-5" />} title={t("admin.classTypes.empty")} />
      ) : (
        <ul role="list" className="flex flex-col gap-3">
          {load.types.map((type) => (
            <li key={type.id}>
              <ClassTypeRow type={type} onEdit={() => onEdit(type)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ClassTypeRow({ type, onEdit }: { type: AdminClassTypeView; onEdit: () => void }) {
  const t = useCopy()
  const titleId = useId()
  return (
    <article
      aria-labelledby={titleId}
      className={cx(
        "flex flex-col gap-2 rounded-[var(--radius-card)] border border-border p-4",
        type.isPublished ? "bg-card [box-shadow:var(--shadow-card)]" : "bg-muted",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* User-entered text: rendered as plain text only (React escapes it). */}
        <h2 id={titleId} className="text-[16px] font-semibold text-foreground">
          {type.name}
        </h2>
        {type.isPublished ? null : <Badge tone="neutral">{t("admin.classTypes.archived")}</Badge>}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <ModalityIcon modality={type.defaultModality} />
          {t(`admin.modality.${type.defaultModality}`)}
        </span>
        <span className="tabular-nums">{t("admin.classTypes.defaults", { min: type.durationMinutes, capacity: type.defaultCapacity })}</span>
      </p>
      {type.description ? <p className="line-clamp-3 whitespace-pre-line text-[14.5px] text-foreground">{type.description}</p> : null}
      <button
        type="button"
        onClick={onEdit}
        aria-label={t("admin.classTypes.editLabel", { name: type.name })}
        className={cx(buttonClass.link, "self-start")}
      >
        <Pencil aria-hidden="true" className="size-4" />
        {t("admin.classTypes.edit")}
      </button>
    </article>
  )
}
