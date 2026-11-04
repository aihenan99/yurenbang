-- ============================================================================
-- 补装「云端深度体检」三个函数（2026-11-02）
-- 背景：管理后台点「☁️ 云端深度体检」报
--       Could not find the function public.yb_admin_health
-- 原因：这三个函数旧云平台自带，迁移 Supabase 时 01-schema 里漏装了
-- 用法：Supabase → SQL Editor → New query → 粘贴 → Run
-- ============================================================================

-- 1/3 yb_admin_health()：数据规模 + 表清单与 RLS 防线
create or replace function public.yb_admin_health()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare t json;
begin
  if not public.is_admin() then
    return json_build_object('error', '需要管理员权限');
  end if;
  select coalesce(json_agg(json_build_object('name', tablename, 'rls', rowsecurity) order by tablename), '[]'::json)
    into t
    from pg_tables
   where schemaname = 'public' and tablename like 'yb_%';
  return json_build_object(
    'posts',      (select count(*) from public.yb_posts),
    'comments',   (select count(*) from public.yb_comments),
    'cases',      (select count(*) from public.yb_cases),
    'errlog',     (select count(*) from public.yb_errlog),
    'errlog24h',  (select count(*) from public.yb_errlog where created_at > now() - interval '24 hours'),
    'tables',     t,
    'checked_at', to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI')
  );
end;
$$;

-- 2/3 yb_admin_recent_errs(p_limit)：最近用户端错误明细（默认 20 条）
create or replace function public.yb_admin_recent_errs(p_limit int default 20)
returns setof public.yb_errlog
language sql
security definer
set search_path = public
as $$
  select * from public.yb_errlog
   where public.is_admin()
   order by created_at desc
   limit greatest(least(coalesce(p_limit, 20), 100), 1);
$$;

-- 3/3 yb_admin_clear_errs(p_days)：清理 N 天前错误日志，返回删除条数
create or replace function public.yb_admin_clear_errs(p_days int default 7)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare n bigint;
begin
  if not public.is_admin() then
    return -1;
  end if;
  delete from public.yb_errlog
   where created_at < now() - make_interval(days => greatest(coalesce(p_days, 7), 1));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 收紧匿名执行口子
revoke execute on function public.yb_admin_health() from anon;
revoke execute on function public.yb_admin_recent_errs(int) from anon;
revoke execute on function public.yb_admin_clear_errs(int) from anon;

-- 通知 API 层刷新函数缓存（上次改函数签名后踩过缓存坑，这里主动刷）
notify pgrst, 'reload schema';

-- ═══ 自检：应列出 3 行，参数列要和上面定义一致 ═══
select p.proname  as 函数名,
       pg_get_function_arguments(p.oid) as 参数定义,
       case when p.prosecdef then 'SECURITY DEFINER ✅' else '❌' end as 安全属性
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('yb_admin_health','yb_admin_recent_errs','yb_admin_clear_errs')
 order by p.proname;
