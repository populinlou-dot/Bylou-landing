import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import type { BookingRepository, BookingRuntime } from "../../application"
import { availabilityAt, fakeRepository, fixedClock } from "../../application/test-support"
import { BookingProvider } from "../booking-context"
import { BookingShell } from "../booking-shell"
import { AgendaContainer } from "./agenda-container"

// Wednesday 2026-10-14 12:00 Buenos Aires; the week shown is Mon 12 → Sun 18 October.
const clock = fixedClock("2026-10-14T15:00:00.000Z")

const SESSIONS = [
  availabilityAt("2026-10-15T22:00:00.000Z", { id: "grupal-full", classTypeId: "ct-grupal", capacity: 8, confirmed: 8 }),
  availabilityAt("2026-10-16T13:00:00.000Z", { id: "individual-free", classTypeId: "ct-individual", capacity: 1 }),
  availabilityAt("2026-10-16T22:00:00.000Z", { id: "grupal-free", classTypeId: "ct-grupal", capacity: 8, confirmed: 6 }),
]

function renderWith(runtime: BookingRuntime, children: ReactNode = <AgendaContainer />) {
  return render(
    <BookingProvider brand={bylouBrand} runtime={runtime}>
      <BookingShell>{children}</BookingShell>
    </BookingProvider>,
  )
}

const ready = (repository: BookingRepository): BookingRuntime => ({ status: "ready", repository, clock, isDemo: true })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("AgendaContainer", () => {
  it("shows a loading state, then day groups with session cards", async () => {
    renderWith(ready(fakeRepository(SESSIONS)))

    expect(screen.getByRole("status").textContent).toBe("Cargando horarios…")
    expect(screen.getByTestId("agenda-skeleton")).toBeTruthy()

    expect(await screen.findByText("3 clases esta semana")).toBeTruthy()
    expect(screen.queryByTestId("agenda-skeleton")).toBeNull()
    expect(screen.getByRole("heading", { level: 2, name: "Jueves 15 de octubre" })).toBeTruthy()
    expect(screen.getByRole("heading", { level: 2, name: "Viernes 16 de octubre" })).toBeTruthy()
    expect(screen.getByText("Semana del 12 al 18 de octubre")).toBeTruthy()
  })

  it("renders a full session with the 'Completa' label and no booking button", async () => {
    renderWith(ready(fakeRepository(SESSIONS)))
    const fullCard = (await screen.findAllByRole("article")).find((card) => within(card).queryByText("Completa"))
    expect(fullCard).toBeTruthy()
    expect(within(fullCard!).getByText("19:00")).toBeTruthy()
    expect(within(fullCard!).getByText("Esta clase está completa.")).toBeTruthy()
    expect(within(fullCard!).queryByRole("button", { name: "Reservar" })).toBeNull()
  })

  it("shows an honest, non-functional 'Reservar' on available sessions", async () => {
    renderWith(ready(fakeRepository(SESSIONS)))
    const buttons = await screen.findAllByRole("button", { name: "Reservar" })
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      expect(button.getAttribute("aria-disabled")).toBe("true")
      const describedBy = button.getAttribute("aria-describedby") ?? ""
      const note = describedBy
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(" ")
      expect(note).toContain("Las reservas online se habilitan pronto.")
    }
    expect(screen.getByText("Queda 1 lugar")).toBeTruthy()
    expect(screen.getByText("Quedan 2 lugares")).toBeTruthy()
  })

  it("shows the empty-week state", async () => {
    renderWith(ready(fakeRepository([])))
    expect(await screen.findByRole("heading", { name: "No hay clases publicadas para esta semana." })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Ver próxima fecha" })).toBeTruthy()
  })

  it("shows an error with retry, and recovers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const repository = fakeRepository(SESSIONS)
    const listSessions = vi
      .spyOn(repository, "listSessions")
      .mockRejectedValueOnce(new Error("network down"))
    renderWith(ready(repository))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("No pudimos cargar los horarios.")
    fireEvent.click(within(alert).getByRole("button", { name: "Reintentar" }))

    expect(await screen.findByText("3 clases esta semana")).toBeTruthy()
    expect(listSessions).toHaveBeenCalledTimes(2)
  })

  it("filters by practice with keyboard-operable chips exposing aria-pressed", async () => {
    renderWith(ready(fakeRepository(SESSIONS)))
    await screen.findByText("3 clases esta semana")

    const group = screen.getByRole("group", { name: "Filtrar por práctica" })
    const all = within(group).getByRole("button", { name: "Todas" })
    const individual = within(group).getByRole("button", { name: "Clase individual" })
    expect(all.getAttribute("aria-pressed")).toBe("true")
    expect(individual.getAttribute("aria-pressed")).toBe("false")

    fireEvent.click(individual)
    expect(await screen.findByText("1 clase esta semana")).toBeTruthy()
    expect(individual.getAttribute("aria-pressed")).toBe("true")
    expect(all.getAttribute("aria-pressed")).toBe("false")
    expect(screen.queryByText("Completa")).toBeNull()
  })

  it("navigates weeks and returns to the current one", async () => {
    renderWith(ready(fakeRepository(SESSIONS)))
    await screen.findByText("3 clases esta semana")
    const thisWeek = screen.getByRole("button", { name: "Esta semana" }) as HTMLButtonElement
    expect(thisWeek.disabled).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Semana siguiente" }))
    expect(await screen.findByText("Semana del 19 al 25 de octubre")).toBeTruthy()
    expect(thisWeek.disabled).toBe(false)

    await act(async () => fireEvent.click(thisWeek))
    expect(await screen.findByText("Semana del 12 al 18 de octubre")).toBeTruthy()
  })
})

describe("BookingShell runtime states", () => {
  it("shows the persistent demo banner for the mock data source", async () => {
    renderWith(ready(fakeRepository(SESSIONS)))
    expect(screen.getByRole("note", { name: "Datos de demostración" })).toBeTruthy()
    await screen.findByText("3 clases esta semana")
  })

  it("renders a config error instead of any agenda when the data source is missing", () => {
    renderWith({ status: "config_error", reason: "missing", variable: "NEXT_PUBLIC_BOOKING_DATA_SOURCE", received: null })
    const alert = screen.getByRole("alert")
    expect(within(alert).getByRole("heading", { level: 1, name: "Las reservas no están configuradas" })).toBeTruthy()
    expect(alert.textContent).toContain("NEXT_PUBLIC_BOOKING_DATA_SOURCE")
    expect(screen.queryByRole("note", { name: "Datos de demostración" })).toBeNull()
    expect(screen.queryByText("Elegí tu próxima clase")).toBeNull()
  })

  it("says Supabase is not available yet, without demo data", () => {
    renderWith({ status: "unavailable", source: "supabase" })
    expect(screen.getByRole("heading", { level: 1, name: "Las reservas online llegan pronto" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Escribile a Lou" }).getAttribute("href")).toBe("https://ig.me/m/bylou.yoga")
    expect(screen.queryByRole("note", { name: "Datos de demostración" })).toBeNull()
  })
})
