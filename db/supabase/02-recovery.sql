-- ============================================================================
-- 育人帮 · 迁移增量 02：密码重置 + 管理员引导
-- 适用：自建 Supabase 库（已在 01-schema.sql 之后执行）
-- 用法：Supabase 控制台 → SQL Editor → New query → 全文粘贴 → Run
--       可重复执行，出错重跑不会破坏数据
-- 背景：自建库没有短信通道，用户名映射的是伪邮箱（收不到信），
--       所以「忘记密码」只能由站长在后台代为重置。
-- ============================================================================


-- ============================================================================
-- §1 admin_reset_password —— 管理员改某个家长的登录密码
--   调用方：后台「🔑 重置家长密码」按钮（admin.js → rpc）
--   安全：SECURITY DEFINER + 先判 is_admin()；anon 无执行权限
--   映射：与前端 yb-sb.js 的 emailFor() 逐字一致
--         小写用户名 → u<UTF-8 十六进制>@usr.yurenbang.cn
-- ============================================================================
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


-- ============================================================================
-- §2 把某个家长设为管理员（一次性引导用）
--   在 SQL Editor 里把 '站长' 换成你要用的用户名，然后只执行下面这一条 select。
--   （前端没有「自己升管理员」的入口，这是故意的：管理员名单只能从数据库改。）
-- ----------------------------------------------------------------------------
-- select public.yb_make_admin('站长');
-- ============================================================================
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

-- 这个函数**只能**在 SQL Editor（postgres 身份）里调用：
-- 普通用户/匿名一律没有执行权限，否则任何人喊一声就能把自己变成管理员。
revoke all on function public.yb_make_admin(text) from public;
revoke all on function public.yb_make_admin(text) from anon;
revoke all on function public.yb_make_admin(text) from authenticated;


-- ============================================================================
-- §3 自检：函数就位、权限正确（跑完看一下这里的输出）
-- ============================================================================
select '重置密码函数' as 项,
       case when count(*) > 0 then '✅ 已就位' else '❌ 缺失' end as 结果
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'admin_reset_password'
union all
select '设为管理员函数',
       case when count(*) > 0 then '✅ 已就位' else '❌ 缺失' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'yb_make_admin'
union all
select '管理员人数',
       (select count(*)::text || ' 人（≥1 才能进后台）' from public.yb_admins)
union all
select 'auth.users 写权限',
       case when has_table_privilege(current_user, 'auth.users', 'UPDATE')
            then '✅ 可写（重置密码可用）'
            else '⚠️ 只读（重置密码会失败，把这句话告诉我）' end;
