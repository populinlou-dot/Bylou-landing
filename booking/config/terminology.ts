/**
 * Domain terms per studio. Spanish needs gender and plural, so both are stored.
 * Terms are labels only: full sentences live in the copy catalog. Never build
 * sentences by interpolating terms with articles.
 */

export type GrammaticalGender = "f" | "m" | "epicene"

export interface Term {
  singular: string
  plural: string
  gender: GrammaticalGender
}

export const TERM_KEYS = [
  "classType",
  "session",
  "instructor",
  "booking",
  "plan",
  "credit",
  "waitlist",
  "attendance",
] as const

export type TermKey = (typeof TERM_KEYS)[number]

export type Terminology = Record<TermKey, Term> & {
  location: { online: string; inPerson: string }
}
