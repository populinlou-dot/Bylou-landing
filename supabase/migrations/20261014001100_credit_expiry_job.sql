-- Booking core · migration 11 · credit_expiry_job (DATA_MODEL §6.8, §8 "Expiry", test D10)
-- Forward-only: earlier files untouched.
--
-- Expiry is already LAZY for correctness: every balance read (private.usable_balance) and every debit
-- filters by expires_at, and refunds into an expired pack are skipped (refunded = false /
-- refund_skipped). What was missing is the audit row: an expired pack still had credits_remaining > 0
-- and no ledger entry explaining why those credits no longer count. This job closes that gap:
--
--   for every pack that expired with unused credits: credits_remaining := 0 and ONE `expiry` ledger row
--   with delta = −(unused credits), actor_id = null (system), note = null (the UI labels it by kind).
--
-- Afterwards, per student, Σ ledger delta = Σ credits_remaining = private.usable_balance (packs that are
-- valid now) — the ledger explains every credit, including the ones that expired.
--
-- What it does NOT touch:
--   * Bookings. A confirmed booking already debited its credit (booking_debit row, not part of
--     credits_remaining), so zeroing the unused remainder leaves it confirmed and paid for.
--   * A later cancel of such a booking: every refund path refunds only `where expires_at > now()`, so on
--     an expired pack it already reports refunded = false / refund_skipped and writes nothing.
--     credits_remaining stays 0, inside grants_remaining_bounds.
--   * admin_adjust_credits refuses expired packs (grant_expired), so nothing changes them afterwards.
--
-- Safety margins:
--   * Lock order (DATA_MODEL §5.1): grants only, one statement, ordered by id, FOR UPDATE SKIP LOCKED.
--     It never waits on anything, so it cannot deadlock; a pack locked by an in-flight booking/refund is
--     skipped and expired on the next run.
--   * Cut-off = least(p_now, now()) − 5 minutes. p_now can only move the cut-off EARLIER: a pack that is
--     still valid is never zeroed. The 5-minute grace outlasts any RPC transaction that started while the
--     pack was still valid (its now() < expires_at) and could still refund into it.
--   * Idempotent: the `credits_remaining > 0` filter plus the existing unique index
--     ledger_one_expiry_per_grant (migration 4): a pack is expired at most once; a second run writes
--     nothing and returns 0.
--
-- Schedule: hourly with pg_cron when the extension can be enabled (bundled with Supabase, local and
-- hosted). If it cannot, the migration still succeeds (balances stay correct; only the audit row waits)
-- and SUPABASE_SETUP.md lists the owner step.

-- (a) Job function ---------------------------------------------------------------------------------------
create function private.expire_credit_grants(p_now timestamptz default now()) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_cutoff timestamptz := least(coalesce(p_now, now()), now()) - interval '5 minutes';
  v_count  int;
begin
  with due as (
    -- LOCK 4 only (grants, one statement, ordered by id). FOR UPDATE re-checks the row it locks, so a
    -- refund or a concurrent run that committed meanwhile is seen (credits_remaining re-evaluated).
    select g.id, g.user_id, g.credits_remaining
      from public.credit_grants g
     where g.expires_at <= v_cutoff
       and g.credits_remaining > 0
       and not exists (select 1 from public.credit_ledger l where l.grant_id = g.id and l.reason = 'expiry')
     order by g.id
       for update of g skip locked
  ), zeroed as (
    update public.credit_grants g set credits_remaining = 0
      from due where g.id = due.id
    returning due.id, due.user_id, due.credits_remaining
  ), logged as (
    insert into public.credit_ledger (user_id, grant_id, reason, delta, actor_id, note)
    select z.user_id, z.id, 'expiry', -z.credits_remaining, null, null from zeroed z
    returning 1
  )
  select count(*)::int into v_count from logged;
  return v_count;
end $$;

-- System job only: never callable through the Data API.
revoke execute on function private.expire_credit_grants(timestamptz) from public, anon, authenticated;

-- (b) Hourly schedule (pg_cron) --------------------------------------------------------------------------
-- Supabase form: the extension lives in pg_catalog and creates the `cron` schema. cron.schedule with a job
-- name upserts, so re-running this block keeps exactly one job. Never fails the migration.
do $cron$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise notice 'pg_cron not available (%): run private.expire_credit_grants() hourly by other means (SUPABASE_SETUP.md)', sqlerrm;
    return;
  end;
  perform cron.schedule('expire-credit-grants', '7 * * * *', 'select private.expire_credit_grants()');
exception when others then
  raise notice 'pg_cron schedule failed (%): schedule private.expire_credit_grants() by hand (SUPABASE_SETUP.md)', sqlerrm;
end
$cron$;

-- rollback (local only; production fixes forward):
--   select cron.unschedule('expire-credit-grants');        -- if pg_cron is installed
--   drop function private.expire_credit_grants(timestamptz);
--   (expiry ledger rows are append-only history and stay.)
