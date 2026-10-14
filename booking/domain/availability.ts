import type { Booking, Session } from "./types"

export interface Availability {
  capacity: number
  booked: number
  spotsLeft: number
  isFull: boolean
}

/** Only confirmed bookings of this session take a spot. Client-side this is a preview (ADR-005). */
export function availability(session: Session, bookings: readonly Booking[]): Availability {
  const booked = bookings.filter((b) => b.sessionId === session.id && b.status === "confirmed").length
  const spotsLeft = Math.max(0, session.capacity - booked)
  return { capacity: session.capacity, booked, spotsLeft, isFull: spotsLeft === 0 }
}
