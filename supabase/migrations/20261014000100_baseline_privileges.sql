-- Booking core · migration 1/7 · baseline_privileges
-- DATA_MODEL §2.0, §5, §11 #1.
-- private schema (not exposed by the Data API), default-deny privileges, shared helpers.

create schema if not exists private;
revoke all on schema private from public;
-- Needed so RLS policies (evaluated as the caller) can run private.is_staff().
grant usage on schema private to authenticated;

-- Supabase grants new tables/functions in `public` to anon + authenticated by default.
-- Turn that off: every grant in this design is explicit.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
-- Note: Postgres' global "EXECUTE to PUBLIC" default cannot be removed per schema, so every
-- function below (and in later migrations) revokes EXECUTE from public explicitly.

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Statement-level guard for append-only tables (credit_ledger). Blocks even the table owner.
create function private.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

-- Business rejection envelope: { ok: false, code, ...extra }. Rejections never write.
create function private.fail(p_code text, p_extra jsonb default '{}'::jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok', false, 'code', p_code) || coalesce(p_extra, '{}'::jsonb)
$$;

revoke execute on function private.touch_updated_at() from public;
revoke execute on function private.forbid_mutation() from public;
revoke execute on function private.fail(text, jsonb) from public;

-- rollback (local only; production fixes forward):
--   drop schema private cascade;
--   alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
--   alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated;
--   alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated;
