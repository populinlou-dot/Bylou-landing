import type { Metadata } from "next"
import { MyBookingsContainer } from "@/booking/ui"

export const metadata: Metadata = {
  title: "Mis reservas",
}

/** `/reservas/mis-reservas/` — upcoming + history + pack balance (signed-in students). */
export default function MyBookingsPage() {
  return <MyBookingsContainer />
}
