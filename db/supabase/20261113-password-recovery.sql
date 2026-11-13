-- ============================================================================
-- 育人帮 · 迁移增量：家长自助找回密码（密保问题）
-- 适用：自建 Supabase 库（在 01-schema.sql / 02-recovery.sql 之后执行）
-- 用法：Supabase 控制台 → SQL Editor → New query → 全文粘贴 → Run
--       可重复执行（create table if not exists / create or replace），不破坏现有数据
-- ----------------------------------------------------------------------------
-- 背景：自建库没有短信通道，用户名映射的是伪邮箱（u<hex>@usr.yurenbang.cn），
--       收不到验证邮件 → 原来「忘记密码」只能由站长在后台代重置。
--       2026-11-13 增加密保问题：家长自己设一个问题+答案，答对即可自助重设。
--
-- 为什么单独建 yb_security 表，而不是给 yb_profiles 加列：
--   yb_profiles 是**公开可读**的（信息流要显示家长昵称，anon 能 select）。
--   答案哈希虽然不该被看到，但没必要让它暴露在公开表里 —— 单独一张表开 RLS
--   且不给任何 policy，只有下面的 SECURITY DEFINER 函数（以定义者身份运行）能读写。
--
-- 安全：
--   · 答案只存 bcrypt 哈希（pgcrypto crypt + gen_salt('bf')），库里看不到明文
--   · 比对用 crypt(输入, 存储哈希) = 存储哈希（与 GoTrue 的 bcrypt 同格式）
--   · 每个用户名 10 分钟内最多答错 5 次，超过锁定
--   · 查询问题不区分「用户名不存在」和「没设密保」，避免被用来枚举账号
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 密保表（RLS 打开、零 policy = 前端无论登录与否都读不到）
-- ----------------------------------------------------------------------------
create table if not exists public.yb_security (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  sec_q      text not null default '',
  sec_a      text not null default '',
  sec_try    int  not null default 0,
  sec_try_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.yb_security enable row level security;
revoke all on table public.yb_security from anon, authenticated;

comment on table  public.yb_security is '密保问题与答案哈希：只在 SECURITY DEFINER 函数内读写';
comment on column public.yb_security.sec_a is '答案 bcrypt 哈希，永不回传前端';


-- ----------------------------------------------------------------------------
-- §2 yb_sec_set —— 登录后设置 / 修改自己的密保问题
-- ----------------------------------------------------------------------------
create or replace function public.yb_sec_set(p_q text, p_a text)
returns json
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_q   text := btrim(coalesce(p_q, ''));
  v_a   text := btrim(coalesce(p_a, ''));
begin
  if v_uid is null then
    return json_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  if length(v_q) < 2 or length(v_q) > 40 then
    return json_build_object('ok', false, 'reason', 'bad_question');
  end if;
  if length(v_a) < 2 or length(v_a) > 40 then
    return json_build_object('ok', false, 'reason', 'bad_answer');
  end if;

  insert into public.yb_security (user_id, sec_q, sec_a, sec_try, sec_try_at, updated_at)
  values (v_uid, v_q, extensions.crypt(lower(v_a), extensions.gen_salt('bf')), 0, null, now())
  on conflict (user_id) do update
    set sec_q = excluded.sec_q,
        sec_a = excluded.sec_a,
        sec_try = 0,
        sec_try_at = null,
        updated_at = now();

  return json_build_object('ok', true);
end;
$$;

revoke all   on function public.yb_sec_set(text, text) from public;
revoke all   on function public.yb_sec_set(text, text) from anon;
grant execute on function public.yb_sec_set(text, text) to authenticated;


-- ----------------------------------------------------------------------------
-- §3 yb_sec_info —— 按用户名取密保问题（匿名可调，忘记密码第一步）
--   用户名不存在 / 没设过密保：统一返回 not_set，不泄露账号是否存在
-- ----------------------------------------------------------------------------
create or replace function public.yb_sec_info(p_username text)
returns json
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_name text := lower(btrim(coalesce(p_username, '')));
  v_row  public.yb_security%rowtype;
begin
  if length(v_name) < 2 then
    return json_build_object('ok', false, 'reason', 'not_set');
  end if;

  select s.* into v_row
    from public.yb_security s
    join public.yb_profiles p on p.user_id = s.user_id
   where p.user_name = v_name
   limit 1;

  if v_row.sec_q is null or v_row.sec_q = '' then
    return json_build_object('ok', false, 'reason', 'not_set');
  end if;
  if v_row.sec_try >= 5 and v_row.sec_try_at is not null
     and v_row.sec_try_at > now() - interval '10 minutes' then
    return json_build_object('ok', false, 'reason', 'locked');
  end if;

  return json_build_object('ok', true, 'q', v_row.sec_q);
end;
$$;

revoke all    on function public.yb_sec_info(text) from public;
grant execute on function public.yb_sec_info(text) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- §4 yb_sec_reset —— 答对密保 + 设新密码（匿名可调）
--   映射与 yb-sb.js 的 emailFor() 逐字一致：小写用户名 → u<UTF-8 hex>@usr.yurenbang.cn
-- ----------------------------------------------------------------------------
create or replace function public.yb_sec_reset(p_username text, p_a text, p_new text)
returns json
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_name  text := lower(btrim(coalesce(p_username, '')));
  v_ans   text := lower(btrim(coalesce(p_a, '')));
  v_new   text := btrim(coalesce(p_new, ''));
  v_email text;
  v_uid   uuid;
  v_sec   public.yb_security%rowtype;
begin
  if length(v_new) < 6 then
    return json_build_object('ok', false, 'reason', 'weak_password');
  end if;

  select s.* into v_sec
    from public.yb_security s
    join public.yb_profiles p on p.user_id = s.user_id
   where p.user_name = v_name
   limit 1;

  if not found or v_sec.sec_a is null or v_sec.sec_a = '' then
    return json_build_object('ok', false, 'reason', 'not_set');
  end if;

  if v_sec.sec_try >= 5 and v_sec.sec_try_at is not null
     and v_sec.sec_try_at > now() - interval '10 minutes' then
    return json_build_object('ok', false, 'reason', 'locked');
  end if;

  if extensions.crypt(v_ans, v_sec.sec_a) <> v_sec.sec_a then
    update public.yb_security
       set sec_try    = case when sec_try_at > now() - interval '10 minutes' then sec_try + 1 else 1 end,
           sec_try_at = now()
     where user_id = v_sec.user_id;
    return json_build_object('ok', false, 'reason', 'bad_answer');
  end if;

  v_email := 'u' || encode(convert_to(v_name, 'UTF8'), 'hex') || '@usr.yurenbang.cn';
  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is null then
    return json_build_object('ok', false, 'reason', 'not_set');
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(v_new, extensions.gen_salt('bf')),
         updated_at         = now()
   where id = v_uid;

  update public.yb_security set sec_try = 0, sec_try_at = null, updated_at = now()
   where user_id = v_sec.user_id;

  return json_build_object('ok', true);
end;
$$;

revoke all    on function public.yb_sec_reset(text, text, text) from public;
grant execute on function public.yb_sec_reset(text, text, text) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- §5 校验（执行完跑一下，看到 1 张表 + 3 个函数即为成功）
-- ----------------------------------------------------------------------------
-- select proname from pg_proc where proname in ('yb_sec_set','yb_sec_info','yb_sec_reset');
-- select count(*) as 已设密保人数 from public.yb_security;
