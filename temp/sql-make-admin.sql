-- ============================================================================
-- 育人帮 · 一次性操作：把「爱河南99」设为管理员
-- 粘贴到 Supabase 控制台 → SQL Editor → New query → Run（可重复执行）
-- ============================================================================

-- §1 补装两个后台函数（若已存在则覆盖，不影响数据）
create or replace function public.admin_reset_password(p_username text, p_new text)
returns json
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_email text;
  v_uid   uuid;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using hint = '当前账号不是管理员';
  end if;
  if p_new is null or length(btrim(p_new)) < 6 then
    raise exception 'weak_password' using hint = '新密码至少 6 位';
  end if;
  v_email := 'u' || encode(convert_to(lower(btrim(p_username)), 'UTF8'), 'hex')
             || '@usr.yurenbang.cn';
  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is null then
    return json_build_object('ok', false, 'reason', 'user_not_found');
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(btrim(p_new), extensions.gen_salt('bf')),
         updated_at         = now()
   where id = v_uid;
  return json_build_object('ok', true, 'uid', v_uid);
end;
$$;

revoke all   on function public.admin_reset_password(text, text) from public;
revoke all   on function public.admin_reset_password(text, text) from anon;
grant execute on function public.admin_reset_password(text, text) to authenticated;

create or replace function public.yb_make_admin(p_username text)
returns json
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_email text;
  v_uid   uuid;
begin
  v_email := 'u' || encode(convert_to(lower(btrim(p_username)), 'UTF8'), 'hex')
             || '@usr.yurenbang.cn';
  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is null then
    return json_build_object('ok', false, 'reason', 'user_not_found', 'email', v_email);
  end if;
  insert into public.yb_admins (user_id) values (v_uid)
    on conflict (user_id) do nothing;
  return json_build_object('ok', true, 'uid', v_uid, 'username', btrim(p_username));
end;
$$;

revoke all on function public.yb_make_admin(text) from public;
revoke all on function public.yb_make_admin(text) from anon;
revoke all on function public.yb_make_admin(text) from authenticated;

-- §2 第一步：看看库里现在有哪些账号（确认「爱河南99」在列表里）
select
  case when u.email like 'u%@usr.yurenbang.cn'
       then convert_from(decode(substr(u.email, 2, strpos(u.email,'@') - 2), 'hex'), 'UTF8')
       else u.email end as 用户名,
  u.id,
  u.created_at as 注册时间
from auth.users u
order by u.created_at;

-- §3 第二步：把「爱河南99」设为管理员
select public.yb_make_admin('爱河南99') as 设为管理员的结果;

-- §4 第三步：确认结果
select '管理员人数' as 项,
       (select count(*)::text || ' 人' from public.yb_admins) as 结果
union all
select '你的账号是否在里面',
       case when exists (
              select 1 from public.yb_admins a
                join auth.users u on u.id = a.user_id
               where lower(u.email) = 'u' || encode(convert_to(lower('爱河南99'), 'UTF8'), 'hex')
                                   || '@usr.yurenbang.cn')
            then '✅ 是（回网站刷新后会出现管理入口）'
            else '❌ 否（把上面 §2 的账号列表截图发我）' end;
