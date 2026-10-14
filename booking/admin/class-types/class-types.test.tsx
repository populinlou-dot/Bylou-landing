import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import { demoStudioBrand } from "../../../brands/demo-studio"
import type { SaveClassTypeResult } from "../../application"
import { ADMIN_CLASS_TYPES, TEST_USER, fakeAdminRepository, fakeAuth } from "../../application/test-support"
import { renderAdmin } from "../test-support"
import { ClassTypesContainer } from "./class-types-container"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/practicas/",
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const XSS = '<img src=x onerror=alert(1)>'

function setup(brand = bylouBrand) {
  const admin = fakeAdminRepository({
    classTypes: [...ADMIN_CLASS_TYPES, { ...ADMIN_CLASS_TYPES[0], id: "ct-xss", name: XSS, description: "<script>x</script>", sortOrder: 9 }],
  })
  const view = renderAdmin(<ClassTypesContainer />, { brand, admin, auth: fakeAuth(TEST_USER) })
  return { admin, ...view }
}

const dialog = () => screen.getByRole("dialog")
const field = (name: string) => within(dialog()).getByLabelText(name) as HTMLInputElement

describe("Class types (AD-02)", () => {
  it("lists published first, marks archived ones in text, and renders names as plain text", async () => {
    const { container } = setup()
    expect(await screen.findByRole("heading", { name: "Prácticas", level: 1 })).toBeTruthy()
    const titles = screen.getAllByRole("article").map((a) => within(a).getByRole("heading").textContent)
    expect(titles).toEqual(["Clase individual", "Clase grupal", XSS, "Práctica archivada"])
    expect(within(screen.getAllByRole("article")[3]).getByText("Archivada")).toBeTruthy()
    expect(screen.getByText("75 min · cupo 8")).toBeTruthy()
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("script")).toBeNull()
  })

  it("validates before saving and keeps the dialog open", async () => {
    const { admin } = setup()
    fireEvent.click(await screen.findByRole("button", { name: "Nueva práctica" }))
    fireEvent.change(field("Duración en minutos"), { target: { value: "5" } })
    fireEvent.click(within(dialog()).getByRole("button", { name: "Guardar" }))
    expect(field("Nombre").getAttribute("aria-invalid")).toBe("true")
    expect(within(dialog()).getByText("Completá este dato.")).toBeTruthy()
    expect(within(dialog()).getByText("Tiene que ser un número entero entre 10 y 480.")).toBeTruthy()
    expect(admin.calls.some((c) => c.startsWith("saveClassType"))).toBe(false)
  })

  it("shows pending, then saves with one client id and reloads the list", async () => {
    const { admin } = setup()
    let resolve!: (r: SaveClassTypeResult) => void
    const save = vi.spyOn(admin, "saveClassType").mockImplementation(() => new Promise((r) => (resolve = r)))
    fireEvent.click(await screen.findByRole("button", { name: "Nueva práctica" }))
    fireEvent.change(field("Nombre"), { target: { value: "  Yin  " } })
    fireEvent.click(within(dialog()).getByRole("button", { name: "Guardar" }))
    const pendingButton = within(dialog()).getByRole("button", { name: "Guardando…" }) as HTMLButtonElement
    expect(pendingButton.disabled).toBe(true)
    fireEvent.click(pendingButton)
    expect(save).toHaveBeenCalledTimes(1)
    const sent = save.mock.calls[0][0]
    expect(sent).toMatchObject({ name: "Yin", description: null, durationMinutes: 60, defaultCapacity: 8, isPublished: true })
    expect(sent.id).toMatch(/^[0-9a-f-]{36}$/)

    resolve({ ok: true, classTypeId: sent.id, created: true, isPublished: true, upcomingSessions: 0 })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.getByText("Práctica guardada.")).toBeTruthy()
    await waitFor(() => expect(admin.calls.filter((c) => c === "listClassTypes")).toHaveLength(2))
  })

  it("server error: message + retry reuses the same id (no duplicate)", async () => {
    const { admin } = setup()
    const save = vi.spyOn(admin, "saveClassType").mockResolvedValueOnce({ ok: false, code: "network_error" })
    fireEvent.click(await screen.findByRole("button", { name: "Nueva práctica" }))
    fireEvent.change(field("Nombre"), { target: { value: "Yin" } })
    fireEvent.click(within(dialog()).getByRole("button", { name: "Guardar" }))
    expect((await within(dialog()).findByRole("alert")).textContent).toBe("No pudimos guardar la práctica. Probá de nuevo.")
    fireEvent.click(within(dialog()).getByRole("button", { name: "Reintentar" }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1][0].id).toBe(save.mock.calls[0][0].id)
  })

  it("archiving explains what happens to the agenda and existing bookings", async () => {
    const { admin } = setup()
    vi.spyOn(admin, "saveClassType").mockResolvedValue({
      ok: true,
      classTypeId: "ct-grupal",
      created: false,
      isPublished: false,
      upcomingSessions: 3,
    })
    fireEvent.click(await screen.findByRole("button", { name: "Editar Clase grupal" }))
    expect(field("Nombre").value).toBe("Clase grupal")
    fireEvent.click(within(dialog()).getByLabelText(/Publicada/))
    fireEvent.click(within(dialog()).getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(admin.saveClassType).toHaveBeenCalledWith(expect.objectContaining({ id: "ct-grupal", isPublished: false }))
    expect(
      screen.getByText(
        "Práctica archivada: ya no se ve en la agenda ni se puede reservar. Las reservas que ya existen se mantienen. Clases ya programadas que quedaron ocultas: 3.",
      ),
    ).toBeTruthy()
  })

  it("uses the demo-studio vocabulary", async () => {
    setup(demoStudioBrand)
    expect(await screen.findByRole("heading", { name: "Actividades", level: 1 })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Nueva actividad" })).toBeTruthy()
  })
})
