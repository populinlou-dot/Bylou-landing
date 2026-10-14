# Booking System Reference Analysis

> Scope: observable public behavior of LuWeVa (primary functional reference) plus a short pattern check on Momence, Mindbody, Fitco and AgendaPro. Public pages only; no accounts, logins, or form submissions. All text paraphrased.
>
> Evidence levels: **Observed** = stated on a public page. **Inferred** = reasonable reading of public statements, not directly shown. **Not verified** = no public evidence found.

## TL;DR

- LuWeVa is a horizontal "management + reservations" SaaS (gyms, yoga/pilates, spas, medical, transport, coworking). Its public site is a thin marketing layer: feature bullets, a pricing table, and a gated demo. No public help center, no app listing, no visible booking portal.
- Booking-relevant claims that are **observed**: self-service booking with capacity caps tied to the client's plan, fixed weekly slots, waitlist with automatic notification, attendance recording, plan-expiry alerts, holiday blocking, bulk messages to booked students, Mercado Pago online payments, AFIP e-invoicing, multi-branch (higher tiers), role-based permissions, payroll by attendance/reservation.
- Everything about **how** these work (cancellation windows, waitlist promotion rules, credit consumption, notification channels, student UX) is **Not verified** publicly.
- Bylou today books via Instagram DM / email and coordinates manually. A small, opinionated, mobile-first flow (pack credits + fixed weekly slot + clear cancellation window + WhatsApp-friendly notifications + Mercado Pago) covers most of the value at a fraction of LuWeVa's surface.

## Capability Matrix

| Capability | Evidence (level + source) | Value for Bylou | MVP / V2 / Discard |
|---|---|---|---|
| Publish activities (class types) | Observed: "multiple activities/specialties" bookable [L2]; plan limits on number of specialties/agendas [LP] | High: 1:1, group, meditation, corporate | MVP |
| Weekly schedule / agenda | Observed: customizable agenda view [L2]; Inferred: recurring weekly grid | High | MVP |
| Capacity per class | Observed: capacity caps per activity [L2] | High (group classes are small) | MVP |
| Holiday / non-working-day blocking | Observed: partial or full-day blocks [L9] | Medium: avoids manual cancellations | MVP |
| Student self-booking | Observed: self-service booking [L2, LT] | High: replaces DM coordination | MVP |
| Booking limits enforced by plan | Observed: system limits reservations per the client's plan [L2] | High: maps to 4-class pack | MVP |
| Cancel / modify booking by student | Inferred: ToS mentions cancellation history stored [LT]; rules not shown | High | MVP |
| Cancellation window / late-cancel penalty | Not verified (LuWeVa). Observed elsewhere: studio-defined window, credit forfeit or fee [MO-G, MB] | High: protects small classes | MVP (simple: window + credit forfeit) |
| Fixed weekly slots ("turnos fijos") | Observed: same day/time each week; included in all tiers [L2, LP] | High: Bylou pack is 1 class/week | MVP |
| Waitlist | Observed: waitlist with auto-notification on freed spot [L2, LH] | Medium: useful once group demand exists | V2 |
| Waitlist auto-promotion / claim rules | Not verified (LuWeVa). Observed elsewhere: auto-add until cutoff, or first-to-claim via SMS [MB-W, MO-S] | Medium | V2 |
| Plans / memberships | Observed: plan-based limits, plan expiry alerts [L2, L9] | High | MVP |
| Packs / credits | Not verified (LuWeVa uses "plans"; credits not mentioned). Observed elsewhere: class credits vs. money credits [MO-G] | High: single class + 4-pack | MVP (class credits only) |
| Expirations | Observed: automatic plan-expiry alerts [L9]; expiry rules Not verified | High: 30-day pack validity | MVP |
| Membership freeze | Not verified (LuWeVa). Observed in Momence [MO-G] | Low-medium | V2 |
| Discount by time band | Observed for yoga/pilates [LH] | Low | Discard (for now) |
| Coupons / promotions / loyalty | Observed [L7, L9] | Medium: 20% meditation promo, trial class | V2 |
| Roles: admin / staff profiles | Observed: multiple user profiles with different permissions [L2] | Medium: Lou is sole instructor today | MVP (admin + student only) |
| Instructor role | Not verified (no instructor role named); payroll by attendance/reservation Observed [L8] | Low now | V2 |
| Student accounts | Observed: client users created automatically; 18+ account rules [L2, LT] | High | MVP |
| Attendance recording | Observed: staff can record attendance [L2] | Medium: feeds no-show policy | MVP (simple check) |
| Self check-in | Not verified (LuWeVa). Observed in Momence [MO-G] | Low (small classes) | Discard |
| No-show tracking | Not verified (LuWeVa). Observed elsewhere as fee/credit deduction [MB] | Medium | MVP (mark only) / V2 (penalties) |
| Notifications: channel | Observed: "automatic alerts" (channel unnamed) [L2, LP]; email marketing templates [L9]; WhatsApp only as a contact button | High: Bylou audience lives on WhatsApp/IG | MVP: email; V2: WhatsApp |
| Bulk message to booked students | Observed [L9] | Medium: class changes | V2 |
| Reports / KPIs | Observed: dashboard KPIs (active clients, income by activity), charts, Excel export [L1, L4] | Low-medium at Bylou scale | V2 (basic list exports in MVP) |
| Online payments (Mercado Pago) | Observed: MercadoPago integration for online payment [L9]; ToS says buyer is redirected to the provider [LT] | High: ARS market standard | MVP |
| E-invoicing (AFIP) | Observed: Business+ tiers [L9, LP] | Medium (fiscal need TBD) | V2 |
| Multi-location / branches | Observed: only Business and Corporate tiers [LP] | Low: studio/terrace/home are "places", not branches | Discard (model as class location field) |
| Virtual classes | Not verified (LuWeVa). Observed in Momence (online/hybrid) and Fitco (live + on-demand) [MO-G, FI] | High: Bylou offers online sessions | MVP (meeting link per class) |
| 1:1 appointments (availability-based) | Observed in LuWeVa medical vertical [LH]; Momence appointment boards [MO-G] | High: 1:1 is Bylou's core offer | MVP (request-based) / V2 (open slots) |
| Native mobile app | Not verified; LuWeVa states responsive web only [L9, LT] | Low: PWA/responsive is enough | Discard |
| Accounting, cash, stock, payroll | Observed [L3, L5, L6, L8] | None for Bylou | Discard |
| Branding (logo/colors) | Observed [LH, LP] | High: own brand site | MVP (native, not configurable) |
| Public booking page / marketplace | Not verified (LuWeVa). Observed: AgendaPro marketplace listing [AP] | Low | Discard |

## Sources Consulted

All accessed 2026-10-13.

| Key | URL | Notes |
|---|---|---|
| BY | https://bylou.com.ar/ | Current offer: 1:1, group, corporate, meditation; ARS single class and 4-class/30-day pack; booking via IG DM / email |
| LH | https://www.luweva.com/ | Home; vertical-specific feature bullets |
| L1 | https://www.luweva.com/func1.html | Dashboard KPIs |
| L2 | https://www.luweva.com/func2.html | Online reservations (main reference) |
| L3 | https://www.luweva.com/func3.html | Accounting (linked, not fetched in detail) |
| L4 | https://www.luweva.com/func4.html | Advanced reports |
| L5/L6 | https://www.luweva.com/func5.html, https://www.luweva.com/func6.html | Stock, cash (linked, not relevant) |
| L7 | https://www.luweva.com/func7.html | Marketing |
| L8 | https://www.luweva.com/func8.html | Payroll rules |
| L9 | https://www.luweva.com/func9.html | More features (Mercado Pago, expiry alerts, holiday blocks, bulk messages, e-invoicing) |
| LP | https://www.luweva.com/pricing.html | Tiers, limits, feature-by-tier table |
| LT | https://www.luweva.com/terms2.html | ToS: end-user accounts, booking/payment responsibilities |
| LS | https://www.luweva.com/soporte | Ticket-only support; no public knowledge base |
| LD | https://www.luweva.com/demo_test/index.php?lc&cP=6 | Demo is gated behind a lead form (not submitted) |
| LY | https://www.youtube.com/channel/UCfVCR2_gH3XCYPJUPtpcgfg | No usable public content retrieved |
| MO-G | https://help.momence.com/en/articles/7869547-momence-term-glossary | Credits, late-cancel refund options, check-in, online/hybrid, sales cut-off |
| MO-S | Momence-hosted studio pages surfaced by web search (e.g. https://momence.com/u/ours-studio-yXWJSe); policies paraphrased from search snippets, not tied to one page | Studio-defined waitlist cutoffs (30 min to 2 h) and late-cancel windows (2 to 24 h) |
| MB | https://www.mindbodyonline.com/business/scheduling | Late cancel / no-show fee or visit deduction |
| MB-W | https://www.mindbodyonline.com/business/education/product-waitlist-improvements | Auto-add vs. first-to-claim waitlist |
| FI | https://www.capterra.es/software/182579/fitco, https://apps.apple.com/us/app/-/id1232476908 | LatAm boutique SaaS; Mercado Pago/Stripe; live + on-demand |
| AP | https://agendapro.com/ar/planes | ARS pricing; WhatsApp reminders as paid add-on |

## Key Journeys Observed

Only the steps marked Observed are publicly evidenced; the rest is the minimal plausible flow.

1. **Admin setup** (Observed in parts [L2, L9, LP]): define activities -> configure agenda -> set capacity -> block holidays -> define plans with booking limits -> configure payment (Mercado Pago).
2. **Student books a class** (Observed: self-service + plan limits [L2]; Inferred: UI steps): account auto-created -> pick activity/time -> system checks plan allowance and capacity -> booking confirmed.
3. **Fixed weekly slot** (Observed [L2]): student holds the same day/time each week. How skips/cancellations on a single week work: Not verified.
4. **Class full -> waitlist** (Observed [L2]): student joins waitlist -> spot frees -> automatic notification. Whether the student is auto-enrolled or must claim: Not verified.
5. **Pay online** (Observed [L9, LT]): student is redirected to the payment provider; refunds handled by the studio, not the platform.
6. **Plan expiring** (Observed [L9]): automatic alert to the student before expiry.
7. **Attendance + payroll** (Observed [L2, L8]): staff records attendance; payroll can be computed per attendance or per reservation.

## UX Friction & Improvement Opportunities for Bylou

| Friction (observed or likely) | Opportunity for Bylou |
|---|---|
| LuWeVa is horizontal (remises, medical, stock, payroll); terminology and settings are generic [LH] | Single-purpose yoga flow; Bylou vocabulary (practice, pack, 1:1) |
| No public docs or student-facing preview; demo gated [LS, LD] | Public schedule visible without login; account only at booking time |
| Notification channel unspecified; WhatsApp is a contact button, not a channel [L2, LH]; WhatsApp is a paid add-on elsewhere [AP] | Booking confirmation + "add to calendar"; WhatsApp deep link for reminders in MVP (no API cost), API-based in V2 |
| Cancellation and waitlist rules invisible to buyers [L2] | Show cancellation window and credit impact on the booking button itself |
| Fixed slots and packs are separate concepts in most tools | Bylou 4-pack = "reserve my weekly slot for 4 weeks" in one step |
| Payment redirect breaks flow [LT] | Mercado Pago Checkout Pro with return to a clear "pack active, next class" screen |
| 1:1 and corporate still need human coordination | Keep a "request a time" path (form -> Lou confirms) instead of forcing slot booking |
| Online vs in-person not modeled as first-class in LuWeVa (Not verified) | Each class carries mode (online/in person) + location or meeting link revealed after booking |
| Free 15-min call and trial class currently via DM [BY] | Bookable "first conversation" slot with no payment |

## Open Questions

1. Does Bylou need group classes with fixed capacity now, or is the near-term volume mostly 1:1?
2. Cancellation window: how many hours, and does a late cancel forfeit the credit?
3. Pack rules: is the 4-pack strictly one per week, or 4 credits usable freely within 30 days? Can unused credits roll over?
4. Payments: Mercado Pago only, or also bank transfer with manual confirmation? Is AFIP e-invoicing required?
5. Notifications: is email enough for MVP, or is WhatsApp a hard requirement?
6. Where do online sessions run (Zoom, Meet), and should the link be per class or per student?
7. Will other instructors join (instructor role, payroll), or is Lou the only teacher for the foreseeable future?
8. Corporate programs: in scope for the booking system, or kept as a quote-based manual process?
9. LuWeVa behaviors behind the gated demo (credit consumption, waitlist promotion, student UI) remain unknown; is a sanctioned demo request acceptable to the team?
