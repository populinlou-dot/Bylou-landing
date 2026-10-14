import type { Metadata } from "next"
import { ClassTypesContainer } from "@/booking/admin"
import { routeCopy } from "../../_booking/route-copy"

export const metadata: Metadata = {
  title: routeCopy("admin.nav.classTypes"),
}

/** A5 class types (`/admin/practicas/`): create, edit, archive. */
export default function AdminClassTypesPage() {
  return <ClassTypesContainer />
}
