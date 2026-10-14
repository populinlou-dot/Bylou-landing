import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import type { BookingRepository, BookingRuntime, SessionAvailability } from "../../application"
import { TEST_USER, availabilityAt, fakeAuth, fakeRepository, fixedClock } from "../../application/test-support"
import { BookingProvider } from "../booking-context"
import { BookingShell } from "../booking-shell"
import { AgendaContainer } from "./agenda-container"
import { agendaFiltersKey } from "./filter-storage"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams() }))

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

const ready = (repository: BookingRepository): BookingRuntime => ({
  status: "ready",
  repository,
  clock,
  isDemo: true,
  auth: fakeAuth(null),
})

/**
 * In-memory Web Storage installed on `window` per test: the runtime's own `localStorage` may be
 * missing or non-functional (e.g. Node's experimental global without a backing file).
 */
function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  }
}

function installStorage(storage: Storage | (() => never)) {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    ...(typeof storage === "function" ? { get: storage } : { value: storage }),
  })
}

beforeEach(() => installStorage(memoryStorage()))

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

  it("shows a real 'Reservar' on available sessions that sends signed-out users to sign in", async () => {
    router.push.mockClear()
    renderWith(ready(fakeRepository(SESSIONS)))
    const buttons = await screen.findAllByRole("button", { name: "Reservar" })
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      expect(button.getAttribute("aria-disabled")).toBeNull()
      const describedBy = button.getAttribute("aria-describedby") ?? ""
      const note = describedBy
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(" ")
      expect(note).toMatch(/Queda|Quedan/)
    }
    expect(screen.queryByText("Las reservas online se habilitan pronto.")).toBeNull()
    expect(screen.getByText("Queda 1 lugar")).toBeTruthy()
    expect(screen.getByText("Quedan 2 lugares")).toBeTruthy()

    fireEvent.click(buttons[0])
    expect(router.push).toHaveBeenCalledWith(
      `/reservas/ingresar/?returnTo=${encodeURIComponent("/reservas/sesion/?id=individual-free&reservar=1")}`,
    )
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

const signedIn = (repository: BookingRepository): BookingRuntime => ({
  status: "ready",
  repository,
  clock,
  isDemo: true,
  auth: fakeAuth(TEST_USER),
})

const cardOf = async (title: RegExp) =>
  (await screen.findAllByRole("article")).find((card) => title.test(card.textContent ?? ""))!

describe("Past sessions read as past (UX backlog #1)", () => {
  // Monday 12 and Tuesday 13 are already over at Wednesday 12:00.
  const PAST = [
    availabilityAt("2026-10-12T13:00:00.000Z", { id: "attended", myBookingId: "b1", myAttendance: "attended" }), // Mon 10:00
    availabilityAt("2026-10-12T22:00:00.000Z", { id: "absent", myBookingId: "b2", myAttendance: "no_show" }), // Mon 19:00
    availabilityAt("2026-10-13T13:00:00.000Z", { id: "booked", myBookingId: "b3" }), // Tue 10:00
    availabilityAt("2026-10-13T22:00:00.000Z", { id: "not-mine", confirmed: 2 }), // Tue 19:00
    availabilityAt("2026-10-16T22:00:00.000Z", { id: "upcoming-mine", myBookingId: "b4" }), // Fri 19:00
  ]

  it.each([
    ["10:00", "Lunes", "Asististe"],
    ["19:00", "Lunes", "No asististe"],
    ["10:00", "Martes", "Reservada"],
  ])("%s on %s: 'Finalizada' + '%s', no CTA and no 'already booked' note", async (time, day, outcome) => {
    renderWith(signedIn(fakeRepository(PAST)))
    await screen.findByText("5 clases esta semana")
    const section = screen.getByRole("heading", { level: 2, name: new RegExp(day) }).closest("section")!
    const card = within(section)
      .getAllByRole("article")
      .find((c) => within(c).queryByText(time))!
    expect(within(card).getByText("Finalizada")).toBeTruthy()
    expect(within(card).getByText(outcome)).toBeTruthy()
    expect(within(card).queryByText("Ya tenés esta clase reservada.")).toBeNull()
    expect(within(card).queryByRole("button", { name: "Reservar" })).toBeNull()
    expect(within(card).queryByRole("link", { name: "Ver mis reservas" })).toBeNull()
  })

  it("a past session the student did not book shows only 'Finalizada'", async () => {
    renderWith(signedIn(fakeRepository(PAST)))
    await screen.findByText("5 clases esta semana")
    const section = screen.getByRole("heading", { level: 2, name: /Martes/ }).closest("section")!
    const card = within(section)
      .getAllByRole("article")
      .find((c) => within(c).queryByText("19:00"))!
    expect(within(card).getByText("Finalizada")).toBeTruthy()
    expect(within(card).queryByText(/Asististe|No asististe|Reservada/)).toBeNull()
  })

  it("an upcoming booked session still says 'Ya tenés esta clase reservada' with a link to Mis reservas", async () => {
    renderWith(signedIn(fakeRepository(PAST)))
    await screen.findByText("5 clases esta semana")
    const section = screen.getByRole("heading", { level: 2, name: /Viernes/ }).closest("section")!
    const card = within(section).getByRole("article")
    expect(within(card).getByText("Ya tenés esta clase reservada.")).toBeTruthy()
    expect(within(card).getByRole("link", { name: "Ver mis reservas" })).toBeTruthy()
  })
})

describe("A full session the student booked (UX backlog)", () => {
  it("keeps the 'Completa' badge and shows only the booked state, not 'Esta clase está completa.'", async () => {
    const items = [
      availabilityAt("2026-10-15T22:00:00.000Z", { id: "full-mine", capacity: 8, confirmed: 8, myBookingId: "b-full" }),
    ]
    renderWith(signedIn(fakeRepository(items)))
    const card = within(await cardOf(/Ya tenés esta clase reservada/))
    expect(card.getByText("Completa")).toBeTruthy()
    expect(card.getByText("Ya tenés esta clase reservada.")).toBeTruthy()
    expect(card.getByRole("link", { name: "Ver mis reservas" })).toBeTruthy()
    expect(card.queryByText("Esta clase está completa.")).toBeNull()
    expect(card.queryByRole("button", { name: "Reservar" })).toBeNull()
  })

  it("a full session the student did not book still explains it is full", async () => {
    renderWith(signedIn(fakeRepository([availabilityAt("2026-10-15T22:00:00.000Z", { id: "full", capacity: 8, confirmed: 8 })])))
    const card = within(await cardOf(/Completa/))
    expect(card.getByText("Esta clase está completa.")).toBeTruthy()
    expect(card.queryByText("Ya tenés esta clase reservada.")).toBeNull()
  })
})

describe("Spots refresh after booking (UX backlog #2)", () => {
  /** Fake whose `book` changes what the repository returns next, like the backend would. */
  function bookingRepository(items: SessionAvailability[]) {
    const repository = fakeRepository(items)
    vi.spyOn(repository, "book").mockImplementation(async (cmd) => {
      const item = items.find((i) => i.session.id === cmd.sessionId)!
      item.confirmedCount += 1
      item.myBookingId = "b-new"
      item.myAttendance = "unknown"
      return { ok: true, bookingId: "b-new", replayed: false, remainingCredits: 2 }
    })
    return repository
  }

  it("re-reads the booked session from the repository while the sheet is still open, then focuses 'Ver mis reservas'", async () => {
    const items = [
      availabilityAt("2026-10-16T22:00:00.000Z", { id: "grupal-free", capacity: 8, confirmed: 6 }),
      availabilityAt("2026-10-17T13:00:00.000Z", { id: "other", capacity: 8, confirmed: 1 }),
    ]
    const repository = bookingRepository(items)
    renderWith(signedIn(repository))
    const card = await cardOf(/Quedan 2 lugares/)
    fireEvent.click(within(card).getByRole("button", { name: "Reservar" }))
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByText("Usás 1 de tus 3 clases.")
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar reserva" })))

    expect(await screen.findByRole("dialog", { name: "¡Listo! Tu clase quedó reservada." })).toBeTruthy()
    // Behind the open sheet, the same card already shows the backend's new count.
    await waitFor(() => expect(within(card).getByText("Queda 1 lugar")).toBeTruthy())
    expect(within(card).getByText("Ya tenés esta clase reservada.")).toBeTruthy()
    expect(repository.calls).toContain("getSession grupal-free")
    // Only the affected session was re-read; the week was not reloaded.
    expect(repository.calls.filter((c) => c.startsWith("listSessions"))).toHaveLength(1)
    expect(screen.getByText("Quedan 7 lugares")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Volver" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(within(card).getByRole("link", { name: "Ver mis reservas" })))
  })

  it("falls back to a silent week reload when the single-session re-read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const items = [availabilityAt("2026-10-16T22:00:00.000Z", { id: "grupal-free", capacity: 8, confirmed: 6 })]
    const repository = bookingRepository(items)
    vi.spyOn(repository, "getSession").mockRejectedValueOnce(new Error("network down"))
    renderWith(signedIn(repository))
    const card = await cardOf(/Quedan 2 lugares/)
    fireEvent.click(within(card).getByRole("button", { name: "Reservar" }))
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByText("Usás 1 de tus 3 clases.")
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar reserva" })))

    await waitFor(() => expect(within(card).getByText("Queda 1 lugar")).toBeTruthy())
    expect(repository.calls.filter((c) => c.startsWith("listSessions"))).toHaveLength(2)
  })
})

describe("Modality filter, remembered per device (UX backlog #3, ST-01 AC4)", () => {
  const MIXED = [
    availabilityAt("2026-10-15T22:00:00.000Z", { id: "g-online", classTypeId: "ct-grupal", modality: "online" }),
    availabilityAt("2026-10-16T13:00:00.000Z", { id: "i-studio", classTypeId: "ct-individual", capacity: 1, modality: "in_person" }),
    availabilityAt("2026-10-16T22:00:00.000Z", { id: "g-studio", classTypeId: "ct-grupal", modality: "in_person" }),
  ]
  const KEY = agendaFiltersKey(bylouBrand.id)

  it("filters by modality with Todas / Presencial / Online chips", async () => {
    renderWith(ready(fakeRepository(MIXED)))
    await screen.findByText("3 clases esta semana")
    const group = screen.getByRole("group", { name: "Filtrar por modalidad" })
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Todas", "Presencial", "Online"])
    expect(within(group).getByRole("button", { name: "Todas" }).getAttribute("aria-pressed")).toBe("true")

    fireEvent.click(within(group).getByRole("button", { name: "Presencial" }))
    expect(await screen.findByText("2 clases esta semana")).toBeTruthy()
    expect(within(group).getByRole("button", { name: "Presencial" }).getAttribute("aria-pressed")).toBe("true")

    // Combined with the practice filter.
    fireEvent.click(within(screen.getByRole("group", { name: "Filtrar por práctica" })).getByRole("button", { name: "Clase grupal" }))
    expect(await screen.findByText("1 clase esta semana")).toBeTruthy()
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ classTypeId: "ct-grupal", modality: "in_person" })
  })

  it("restores the last practice + modality on the next visit", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ classTypeId: "ct-grupal", modality: "online" }))
    const repository = fakeRepository(MIXED)
    renderWith(ready(repository))
    expect(await screen.findByText("1 clase esta semana")).toBeTruthy()
    const modality = screen.getByRole("group", { name: "Filtrar por modalidad" })
    const practice = screen.getByRole("group", { name: "Filtrar por práctica" })
    expect(within(modality).getByRole("button", { name: "Online" }).getAttribute("aria-pressed")).toBe("true")
    expect(within(practice).getByRole("button", { name: "Clase grupal" }).getAttribute("aria-pressed")).toBe("true")
    // The remembered filter applied to the first request (no unfiltered flash).
    expect(repository.calls.filter((c) => c.startsWith("listSessions"))).toHaveLength(1)
  })

  it("forgets a remembered practice that no longer exists", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ classTypeId: "ct-archived", modality: "in_person" }))
    renderWith(ready(fakeRepository(MIXED)))
    expect(await screen.findByText("2 clases esta semana")).toBeTruthy()
    const practice = screen.getByRole("group", { name: "Filtrar por práctica" })
    expect(within(practice).getByRole("button", { name: "Todas" }).getAttribute("aria-pressed")).toBe("true")
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ classTypeId: null, modality: "in_person" })
  })

  it("ignores a tampered stored value", async () => {
    window.localStorage.setItem(KEY, "{not json")
    renderWith(ready(fakeRepository(MIXED)))
    expect(await screen.findByText("3 clases esta semana")).toBeTruthy()
  })

  it("works when every storage call throws (quota / blocked site data)", async () => {
    const storage = memoryStorage()
    const getItem = vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError")
    })
    const setItem = vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError")
    })
    installStorage(storage)
    renderWith(ready(fakeRepository(MIXED)))
    expect(await screen.findByText("3 clases esta semana")).toBeTruthy()
    fireEvent.click(within(screen.getByRole("group", { name: "Filtrar por modalidad" })).getByRole("button", { name: "Online" }))
    expect(await screen.findByText("1 clase esta semana")).toBeTruthy()
    expect(getItem).toHaveBeenCalled()
    expect(setItem).toHaveBeenCalled()
  })

  it("works when merely touching localStorage throws (Safari private mode)", async () => {
    installStorage(() => {
      throw new DOMException("denied", "SecurityError")
    })
    renderWith(ready(fakeRepository(MIXED)))
    expect(await screen.findByText("3 clases esta semana")).toBeTruthy()
    fireEvent.click(within(screen.getByRole("group", { name: "Filtrar por modalidad" })).getByRole("button", { name: "Presencial" }))
    expect(await screen.findByText("2 clases esta semana")).toBeTruthy()
  })
})
