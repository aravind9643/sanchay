-- 0041_admin_delete_audit_logs.sql
--
-- Developer maintenance RPC to delete audit log entries.
--
-- Background:
-- audit_log is protected by trg_audit_immutable, which raises an exception on
-- any UPDATE or DELETE statement.
-- For superadmin / developer housekeeping (e.g. purging test run logs),
-- direct REST DELETE calls fail with 42501 (insufficient_privilege).
--
-- This SECURITY DEFINER function temporarily disables trg_audit_immutable
-- to delete the requested rows by id, then immediately re-enables the trigger.
-- It is restricted to service_role only.

create or replace function admin_delete_audit_logs(p_ids bigint[])
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
begin
  if p_ids is null or array_length(p_ids, 1) = 0 then
    return 0;
  end if;

  alter table audit_log disable trigger trg_audit_immutable;
  delete from audit_log where id = any(p_ids);
  get diagnostics v_count = row_count;
  alter table audit_log enable trigger trg_audit_immutable;

  return v_count;
exception
  when others then
    -- Ensure trigger is always re-enabled if any error occurs
    alter table audit_log enable trigger trg_audit_immutable;
    raise;
end $$;

revoke all on function admin_delete_audit_logs(bigint[]) from public, anon, authenticated;
grant execute on function admin_delete_audit_logs(bigint[]) to service_role;
