import type { Metadata } from "next"
import { ClassTypesContainer } from "@/booking/admin"

export const metadata: Metadata = {
  title: "Prácticas",
}

/** A5 class types (`/admin/practicas/`): create, edit, archive. */
export default function AdminClassTypesPage() {
  return <ClassTypesContainer />
}
