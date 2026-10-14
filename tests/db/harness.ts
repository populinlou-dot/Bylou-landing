/**
 * Multi-connection harness for DB concurrency tests (DATA_MODEL §7, §12 journeys B/C/D).
 *
 * LOCAL ONLY: connects to the Supabase local stack (`supabase start`). Refuses any non-loopback host.
 * Each "actor" is its own Postgres connection impersonating a user exactly like PostgREST does:
 * `set role authenticated` + `request.jwt.claims`. RPC calls run in autocommit, one transaction each.
 *
 * Determinism: a gate connection holds the contended row lock (`select … for update`), every racer is
 * fired, the harness waits until pg_stat_activity shows ALL racers blocked on a Lock, then the gate
 * rolls back. Every racer therefore contends; only the lock-queue order varies.
 */
import { randomUUID } from "node:crypto"
import pg from "pg"

/** Supabase CLI local default (not a secret). Override with BOOKING_DB_URL (must stay local). */
const LOCAL_DEFAULT_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

export function databaseUrl(): string {
  const url = process.env.BOOKING_DB_URL ?? LOCAL_DEFAULT_URL
  const host = new URL(url).hostname
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error(`DB tests only run against a local database; refusing host "${host}"`)
  }
  return url
}

export type RpcResult = Record<string, unknown> & { ok: boolean; code: string | null }

export class Actor {
  private constructor(
    readonly userId: string,
    readonly client: pg.Client,
    readonly pid: number,
  ) {}

  static async connect(userId: string): Promise<Actor> {
    const client = new pg.Client({ connectionString: databaseUrl() })
    await client.connect()
    await client.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ])
    await client.query("set role authenticated")
    const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid")
    return new Actor(userId, client, rows[0].pid)
  }

  async book(sessionId: string, key: string = randomUUID()): Promise<RpcResult> {
    const { rows } = await this.client.query<{ r: RpcResult }>("select public.book_session($1, $2) as r", [sessionId, key])
    return rows[0].r
  }

  async cancel(bookingId: string): Promise<RpcResult> {
    const { rows } = await this.client.query<{ r: RpcResult }>("select public.cancel_booking($1, $2) as r", [
      bookingId,
      randomUUID(),
    ])
    return rows[0].r
  }

  /** Staff-only RPC (AD-05.1); a student actor gets 42501 forbidden. */
  async updateCapacity(sessionId: string, capacity: number): Promise<RpcResult> {
    const { rows } = await this.client.query<{ r: RpcResult }>("select public.admin_update_session($1, $2) as r", [
      sessionId,
      capacity,
    ])
    return rows[0].r
  }

  /** Staff-only RPC (AD-10): book a student into a session, bypassing the booking window. */
  async bookFor(userId: string, sessionId: string, key: string = randomUUID()): Promise<RpcResult> {
    const { rows } = await this.client.query<{ r: RpcResult }>("select public.admin_book_for($1, $2, $3) as r", [
      userId,
      sessionId,
      key,
    ])
    return rows[0].r
  }

  /** Staff-only RPC (AD-08.2): ± credits on one pack with a reason. */
  async adjust(grantId: string, delta: number, key: string = randomUUID()): Promise<RpcResult> {
    const { rows } = await this.client.query<{ r: RpcResult }>("select public.admin_adjust_credits($1, $2, $3, $4) as r", [
      grantId,
      delta,
      "race test",
      key,
    ])
    return rows[0].r
  }

  end(): Promise<void> {
    return this.client.end()
  }
}

/** Owner connection (role postgres) for fixtures, gates and assertions. */
export class Admin {
  private constructor(readonly client: pg.Client) {}

  static async connect(): Promise<Admin> {
    const client = new pg.Client({ connectionString: databaseUrl() })
    await client.connect()
    return new Admin(client)
  }

  async one<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T> {
    const { rows } = await this.client.query<T>(sql, params)
    return rows[0]
  }

  /** Fake local user (example.test); the auth trigger creates the student profile. */
  async createUser(): Promise<string> {
    const id = randomUUID()
    await this.client.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                               raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(),
               '{"provider":"email","providers":["email"]}', '{}', now(), now())`,
      [id, `race-${id}@example.test`],
    )
    return id
  }

  async staffId(): Promise<string> {
    const row = await this.one<{ id: string }>("select id from public.profiles where role = 'staff' order by created_at limit 1")
    if (!row) throw new Error("No staff profile: run `supabase db reset` to load seed.sql")
    return row.id
  }

  /** Grant + its ledger 'grant' row (keeps credits_remaining = Σ ledger). */
  async grant(userId: string, credits: number, validDays = 40): Promise<string> {
    const staff = await this.staffId()
    const { id } = await this.one<{ id: string }>(
      `with g as (
         insert into public.credit_grants (user_id, credits_total, credits_remaining, valid_from, expires_at,
                                           granted_by, idempotency_key)
         values ($1, $2, $2, now() - interval '1 day', now() + make_interval(days => $3), $4, gen_random_uuid())
         returning id)
       insert into public.credit_ledger (user_id, grant_id, reason, delta, actor_id)
       select $1, g.id, 'grant', $2, $4 from g returning grant_id as id`,
      [userId, credits, validDays, staff],
    )
    return id
  }

  async session(capacity: number, startsInHours = 72): Promise<string> {
    const { id } = await this.one<{ id: string }>(
      `insert into public.sessions (class_type_id, starts_at, ends_at, capacity, modality)
       select ct.id, now() + make_interval(hours => $2), now() + make_interval(hours => $2 + 1), $1, 'in_person'
         from public.class_types ct where ct.is_published order by ct.sort_order limit 1
       returning id`,
      [capacity, startsInHours],
    )
    return id
  }

  /**
   * Barrier: hold `select … for update` on one row, start every racer, wait until all of them are
   * blocked on a Lock, release, and collect the results.
   */
  async race<T>(lockSql: string, lockParams: unknown[], racers: Actor[], fire: (a: Actor) => Promise<T>): Promise<T[]> {
    await this.client.query("begin")
    try {
      await this.client.query(lockSql, lockParams)
      const pending = racers.map((a) => fire(a))
      // Avoid unhandled rejections while we wait; errors surface in Promise.all below.
      pending.forEach((p) => p.catch(() => undefined))
      await this.waitForLockWaiters(racers.map((a) => a.pid))
      await this.client.query("rollback")
      return await Promise.all(pending)
    } catch (error) {
      await this.client.query("rollback").catch(() => undefined)
      throw error
    }
  }

  private async waitForLockWaiters(pids: number[], timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const { n } = await this.one<{ n: number }>(
        "select count(*)::int as n from pg_stat_activity where pid = any($1) and wait_event_type = 'Lock'",
        [pids],
      )
      if (n === pids.length) return
      if (Date.now() > deadline) throw new Error(`Barrier timeout: ${n}/${pids.length} racers blocked on a lock`)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  /** I1/I2/I6 for the given sessions and users. Returns violations (empty = consistent). */
  async invariantViolations(sessionIds: string[], userIds: string[]): Promise<string[]> {
    const { rows } = await this.client.query<{ v: string }>(
      `select 'session ' || s.id || ': count ' || s.confirmed_count || ' vs ' ||
              (select count(*) from public.bookings b where b.session_id = s.id and b.status = 'confirmed') ||
              ' cap ' || s.capacity as v
         from public.sessions s
        where s.id = any($1)
          and (s.confirmed_count <> (select count(*) from public.bookings b where b.session_id = s.id and b.status = 'confirmed')
               or s.confirmed_count > s.capacity)
       union all
       select 'grant ' || g.id || ': remaining ' || g.credits_remaining || ' vs ledger ' ||
              (select coalesce(sum(l.delta), 0) from public.credit_ledger l where l.grant_id = g.id)
         from public.credit_grants g
        where g.user_id = any($2)
          and g.credits_remaining <> (select coalesce(sum(l.delta), 0) from public.credit_ledger l where l.grant_id = g.id)`,
      [sessionIds, userIds],
    )
    return rows.map((r) => r.v)
  }

  end(): Promise<void> {
    return this.client.end()
  }
}

export const LOCK_SESSION = "select 1 from public.sessions where id = $1 for update"
export const LOCK_GRANT = "select 1 from public.credit_grants where id = $1 for update"
