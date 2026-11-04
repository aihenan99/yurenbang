-- 修复：管理密码函数补默认参数（跑完回网站重新点「设置并进入」即可）
create or replace function public.admin_set_password(p_new text, p_old text default null)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare r public.yb_admin_guard; v int;
begin
  if not public.is_admin() then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  if p_new is null or length(p_new) < 8 then
    return json_build_object('ok', false, 'reason', 'weak');
  end if;
  select * into r from public.yb_admin_guard where id = 1;
  if coalesce(r.pwd_hash, '') <> '' then
    if crypt(p_old, r.pwd_hash) <> r.pwd_hash then
      return json_build_object('ok', false, 'reason', 'bad_old');
    end if;
  end if;
  insert into public.yb_admin_guard (id, pwd_hash, failed_count, locked_until, updated_at)
  values (1, crypt(p_new, gen_salt('bf', 10)), 0, null, now())
  on conflict (id) do update
    set pwd_hash = excluded.pwd_hash,
        failed_count = 0,
        locked_until = null,
        updated_at = now();
  get diagnostics v = row_count;
  return json_build_object('ok', v > 0);
end;
$$;

revoke execute on function public.admin_set_password(text, text) from anon;
