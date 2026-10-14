import type { Metadata } from "next"
import { MyBookingsContainer } from "@/booking/ui"
import { routeCopy } from "../../_booking/route-copy"

export const metadata: Metadata = {
  title: routeCopy("mine.title"),
}

/** `/reservas/mis-reservas/` — upcoming + history + pack balance (signed-in students). */
export default function MyBookingsPage() {
  return <MyBookingsContainer />
}
