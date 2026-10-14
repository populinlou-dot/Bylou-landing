import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import type { CreateSessionsResult } from "../../application"
import { ADMIN_CLASS_TYPES, TEST_USER, fakeAdminRepository, fakeAuth } from "../../application/test-support"
import { renderAdmin } from "../test-support"
import { NewSessionContainer } from "./new-session-container"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/nueva-clase/",
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// now = Wed 2026-10-14 12:00 Buenos Aires (renderAdmin's fixed clock).
function setup(date: string | null = "2026-10-15", classTypes = ADMIN_CLASS_TYPES) {
  const admin = fakeAdminRepository({ classTypes })
  const view = renderAdmin(<NewSessionContainer date={date} />, { brand: bylouBrand, admin, auth: fakeAuth(TEST_USER) })
  return { admin, ...view }
}

const input = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement
const change = (label: string | RegExp, value: string) => fireEvent.change(input(label), { target: { value } })

async function ready() {
  return screen.findByRole("heading", { name: "Nueva clase", level: 1 })
}

describe("New session form (AD-03)", () => {
  it("prefills the day from ?dia= and the class type's defaults; offers only published types", async () => {
    setup()
    await ready()
    expect(input("Fecha").value).toBe("2026-10-15")
    const select = input("Práctica") as unknown as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.text)).toEqual(["Clase individual", "Clase grupal"])
    expect(input("Duración en minutos").value).toBe("60")
    expect(input("Cupo").value).toBe("1")
    expect(input("Link de la videollamada")).toBeTruthy()

    fireEvent.change(select, { target: { value: "ct-grupal" } })
    expect(input("Duración en minutos").value).toBe("75")
    expect(input("Cupo").value).toBe("8")
    expect(input("Dirección")).toBeTruthy()
    expect(screen.queryByLabelText("Link de la videollamada")).toBeNull()
  })

  it("shows field errors and does not call the server", async () => {
    const { admin } = setup()
    await ready()
    change("Cupo", "0")
    change("Link de la videollamada", "http://inseguro.example.test")
    fireEvent.click(screen.getByRole("button", { name: "Publicar clase" }))
    expect(input("Hora de inicio").getAttribute("aria-invalid")).toBe("true")
    expect(screen.getByText("Completá este dato.")).toBeTruthy()
    expect(screen.getByText("Tiene que ser un número entero entre 1 y 100.")).toBeTruthy()
    expect(screen.getByText("Pegá un link que empiece con https://")).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toBe("Revisá los datos marcados.")
    expect(admin.calls.some((c) => c.startsWith("createSessions"))).toBe(false)
  })

  it("rejects a start that already passed (studio time)", async () => {
    setup("2026-10-14")
    await ready()
    change("Hora de inicio", "11:30")
    change("Link de la videollamada", "https://meet.example.test/x")
    fireEvent.click(screen.getByRole("button", { name: "Publicar clase" }))
    expect(screen.getByText("Ese horario ya pasó. Elegí una fecha y hora futuras.")).toBeTruthy()
  })

  it("previews the weekly series in studio time and publishes it in one call", async () => {
    const { admin } = setup()
    await ready()
    let resolve!: (r: CreateSessionsResult) => void
    const create = vi.spyOn(admin, "createSessions").mockImplementation(() => new Promise((r) => (resolve = r)))
    change("Hora de inicio", "18:00")
    change("Link de la videollamada", " https://meet.example.test/x ")
    fireEvent.click(screen.getByLabelText("Repetir todas las semanas"))
    expect(input("Cantidad de semanas (máximo 12)").value).toBe("4")
    expect(screen.getByText("Se van a publicar 4 clases, cada una independiente:")).toBeTruthy()
    const preview = screen.getAllByRole("listitem").map((li) => li.textContent)
    expect(preview).toEqual([
      "Jueves 15 de octubre · 18:00",
      "Jueves 22 de octubre · 18:00",
      "Jueves 29 de octubre · 18:00",
      "Jueves 5 de noviembre · 18:00",
    ])

    fireEvent.click(screen.getByRole("button", { name: "Publicar 4 clases" }))
    const pending = screen.getByRole("button", { name: "Publicando…" }) as HTMLButtonElement
    expect(pending.disabled).toBe(true)
    fireEvent.click(pending)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toMatchObject({
      classTypeId: "ct-individual",
      localDate: "2026-10-15",
      localStart: "18:00",
      repeatWeeks: 4,
      modality: "online",
      meetingUrl: "https://meet.example.test/x",
      address: null,
    })

    resolve({ ok: true, sessionIds: ["a", "b", "c", "d"], replayed: false })
    expect(await screen.findByText("Listo: publicaste 4 clases. Ya se ven en la agenda.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Ver el día" }).getAttribute("href")).toMatch(/^\/admin\/?\?dia=2026-10-15$/)
  })

  it("server failure: explains it and retries with the SAME request key (no duplicate series)", async () => {
    const { admin } = setup()
    await ready()
    const create = vi
      .spyOn(admin, "createSessions")
      .mockResolvedValueOnce({ ok: false, code: "network_error" })
      .mockResolvedValueOnce({ ok: true, sessionIds: ["a"], replayed: true })
    change("Hora de inicio", "18:00")
    change("Link de la videollamada", "https://meet.example.test/x")
    fireEvent.click(screen.getByRole("button", { name: "Publicar clase" }))
    expect((await screen.findByRole("alert")).textContent).toBe(
      "No pudimos publicar la clase. Revisá tu conexión y probá de nuevo.",
    )
    fireEvent.click(screen.getByRole("button", { name: "Publicar clase" }))
    expect(await screen.findByText("Estas clases ya estaban publicadas: no se duplicó nada.")).toBeTruthy()
    expect(create.mock.calls[1][0].requestKey).toBe(create.mock.calls[0][0].requestKey)
  })

  it("'Publicar otra clase' starts a new form with a new request key", async () => {
    const { admin } = setup()
    await ready()
    const create = vi.spyOn(admin, "createSessions")
    change("Hora de inicio", "18:00")
    change("Link de la videollamada", "https://meet.example.test/x")
    fireEvent.click(screen.getByRole("button", { name: "Publicar clase" }))
    fireEvent.click(await screen.findByRole("button", { name: "Publicar otra clase" }))
    expect(input("Hora de inicio").value).toBe("")
    change("Hora de inicio", "19:00")
    change("Link de la videollamada", "https://meet.example.test/y")
    fireEvent.click(screen.getByRole("button", { name: "Publicar clase" }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(create.mock.calls[1][0].requestKey).not.toBe(create.mock.calls[0][0].requestKey)
  })

  it("asks for a published class type first when there is none", async () => {
    setup(null, [ADMIN_CLASS_TYPES[2]])
    expect(await screen.findByText("Para publicar una clase, primero creá una práctica publicada.")).toBeTruthy()
    expect(within(screen.getByRole("status")).getByRole("link", { name: "Nueva práctica" }).getAttribute("href")).toMatch(
      /^\/admin\/practicas\/?$/,
    )
  })
})
