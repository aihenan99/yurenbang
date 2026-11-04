-- ============================================================================
-- 育人帮 · Supabase 自建库 全量初始化脚本（v1，2026-11-01）
-- ============================================================================
--
-- 【怎么用】
--   1. 打开 Supabase 控制台 → 左侧 SQL Editor → New query
--   2. 把本文件全部内容粘贴进去 → 点 Run（约 2~5 秒）
--   3. 输出里不应出现 ERROR；末尾会打印一张已建对象的清单
--   可重复执行（幂等）：所有 CREATE 均带 IF NOT EXISTS / OR REPLACE，
--   所有策略先 DROP 再建，重复 Run 只会重建同名对象，不会产生重复数据。
--
-- 【执行前必须在控制台改一个设置】
--   Authentication → Sign In / Providers → Email → 把 "Confirm email" 关掉
--   （我们用「用户名+密码」映射成 <用户名>@usr.yurenbang.cn 的伪邮箱注册，
--     收不到验证邮件，必须关掉确认才能注册成功。）
--
-- 【设计依据】字段与函数全部来自客户端代码反推（证据行号见注释），
--   契约源：db/schema.sql §1。隔离期无法导出线上真实 DDL，
--   本文件是"从代码证据新建"，不是 dump 复刻。
--
-- 【登录方案（2026-11-01 拍板）】用户名+密码：
--   注册 → auth.signUp({ email: 用户名@usr.yurenbang.cn, password })
--   登录 → auth.signInWithPassword({ email: 同上, password })
--   用户名展示与唯一性由 public.yb_profiles.user_name 维护（小写归一）。
--
-- 【管理员】表 yb_admins 是唯一权限源，is_admin() 只认它。
--   注册管理员账号后（见文件末尾 §9）手工插一行，其它什么都不用改。
-- ============================================================================


-- ============================================================================
-- §0 扩展
-- ============================================================================
create extension if not exists pgcrypto with schema extensions;


-- ============================================================================
-- §1 业务表（8 张 + reports + 管理两张）
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1.1 yb_posts 求助/分享主表
--   证据：cloud.js:1093-1114（insert row 全字段）、1184（hidden 过滤）、
--         1086-1091（eq owner_id+title 回查）、admin.js:714（update hidden）
-- ---------------------------------------------------------------------------
create table if not exists public.yb_posts (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  type       text not null default 'text',
  title      text not null default '',
  body       text not null default '',
  tag        text not null default '',
  age        text not null default '',
  urg        int  not null default 1,
  vis        int  not null default 0,
  loc        text not null default '',
  owner_name text not null default '',
  owner_flag text not null default '',
  owner_id   uuid references auth.users(id) on delete set null,
  media      jsonb not null default '[]'::jsonb,   -- [{kind,path,dur?,name?,thumb?}]
  hidden     boolean not null default false,
  helps      int not null default 0,               -- 由触发器维护，客户端只读
  likes      int not null default 0,
  favs       int not null default 0,
  solved     boolean not null default false        -- yb_post_solve 使用（自建约定）
);
create index if not exists yb_posts_created_idx on public.yb_posts (created_at desc);
create index if not exists yb_posts_owner_idx   on public.yb_posts (owner_id);

-- ---------------------------------------------------------------------------
-- 1.2 yb_comments 帮忙回应
--   证据：cloud.js:1161-1166（文本插入）、1567-1573（语音/图片插入带 dur+media）
-- ---------------------------------------------------------------------------
create table if not exists public.yb_comments (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  post_id    bigint not null references public.yb_posts(id) on delete cascade,
  body       text not null default '',
  owner_name text not null default '',
  owner_flag text not null default '',
  owner_id   uuid references auth.users(id) on delete set null,
  kind       text not null default 'text',
  dur        text not null default '',
  media      jsonb not null default '[]'::jsonb
);
create index if not exists yb_comments_post_idx on public.yb_comments (post_id, created_at);

-- ---------------------------------------------------------------------------
-- 1.3 yb_cases 案例广场
--   证据：cloud.js:1292-1305（insert 含 content_html）、1323-1327（select 全员）、
--         1379（delete）、db/schema.sql §1 已知策略名
-- ---------------------------------------------------------------------------
create table if not exists public.yb_cases (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  title        text not null default '',
  type         text not null default 'img',
  owner_name   text not null default '',
  owner_flag   text not null default '',
  owner_id     uuid references auth.users(id) on delete set null,
  media        jsonb not null default '[]'::jsonb,
  content_html text not null default '',            -- casedit 图文正文（≤200000 字）
  hidden       boolean not null default false
);
create index if not exists yb_cases_created_idx on public.yb_cases (created_at desc);

-- ---------------------------------------------------------------------------
-- 1.4 yb_settings 站点配置（键值）
--   证据：admin.js:177-178、chips.js:66、license.js:42（匿名读）
--   写入只走 admin_set_setting RPC（§6.2），不开放直写
-- ---------------------------------------------------------------------------
create table if not exists public.yb_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 1.5 yb_profiles 用户档案
--   证据：profile.js:34-50（user_id 主键 + nick/child_age/city/bio）
--   user_name 为登录方案新增：唯一用户名（小写），注册时写入
-- ---------------------------------------------------------------------------
create table if not exists public.yb_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  user_name  text not null,                         -- 唯一用户名（小写归一）
  nick       text not null default '',
  child_age  text not null default '',
  city       text not null default '',
  bio        text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists yb_profiles_name_uk on public.yb_profiles (user_name);

-- ---------------------------------------------------------------------------
-- 1.6 yb_gifts 玫瑰/答谢
--   证据：food.js:208-214（insert from/to/food/post_id）、398（.or 查询）、
--         415（update seen）、refine23.js:782、rose.js:55
--   from_id/to_id 用 text：代码侧 String(uid) 传入，.or 拼串比较，text 最稳
-- ---------------------------------------------------------------------------
create table if not exists public.yb_gifts (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  from_id    text not null default '',
  from_name  text not null default '',
  to_id      text not null default '',
  to_name    text not null default '',
  food       text not null default '',
  post_id    bigint,
  seen       boolean not null default false
);
create index if not exists yb_gifts_to_idx   on public.yb_gifts (to_id, created_at desc);
create index if not exists yb_gifts_from_idx on public.yb_gifts (from_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 1.7 yb_tutor_req 家教/辅导需求
--   证据：jiaojiao.js:231-241（insert 全字段）、admin.js:759（admin delete）
-- ---------------------------------------------------------------------------
create table if not exists public.yb_tutor_req (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  name          text not null default '',
  contact       text not null default '',
  community     text not null default '',
  grade         text not null default '',
  subjects      text not null default '',
  other_subject text not null default '',
  freq          text not null default '',
  teacher_types text not null default '',
  online        text not null default '',
  goals         text not null default '',
  owner_name    text not null default ''
);

-- ---------------------------------------------------------------------------
-- 1.8 yb_errlog 前端错误上报
--   证据：guard.js:83-96（匿名批量 insert：uid/build/kind/msg/src/ua）
--   策略：只许插入，不许读（排障走服务端/控制台 SQL）
-- ---------------------------------------------------------------------------
create table if not exists public.yb_errlog (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  uid        text not null default '',
  build      text not null default '',
  kind       text not null default '',
  msg        text not null default '',
  src        text not null default '',
  ua         text not null default ''
);

-- ---------------------------------------------------------------------------
-- 1.9 yb_reports 举报受理（与 db/schema.sql §2 完全一致，原样照搬）
-- ---------------------------------------------------------------------------
create table if not exists public.yb_reports (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  target_type   text not null check (target_type in ('post', 'case', 'comment')),
  target_id     text not null,
  target_title  text,
  snapshot      text,
  reason        text not null,
  note          text,
  reporter_id   text,
  reporter_name text,
  status        text not null default 'open'
                check (status in ('open', 'handled', 'rejected')),
  handled_at    timestamptz,
  handled_by    text,
  handle_note   text
);
create index if not exists yb_reports_status_idx
  on public.yb_reports (status, created_at desc);
create index if not exists yb_reports_target_idx
  on public.yb_reports (target_type, target_id);

-- ---------------------------------------------------------------------------
-- 1.10 yb_admins 管理员名单（权限唯一来源）
--   注册管理员账号后插入 uid（§9），is_admin() 只认这张表
-- ---------------------------------------------------------------------------
create table if not exists public.yb_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text not null default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 1.11 yb_admin_guard 管理密码守卫
--   证据：adminguard.js:10-15（RLS 无策略 + 三个 SECURITY DEFINER 函数）
--   开 RLS、不建任何策略：客户端不能直读直写，只能走 §6 的函数
-- ---------------------------------------------------------------------------
create table if not exists public.yb_admin_guard (
  id           int primary key default 1 check (id = 1),
  pwd_hash     text not null default '',            -- bcrypt（pgcrypto crypt）
  failed_count int not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);
alter table public.yb_admin_guard enable row level security;   -- 无策略=全拒


-- ============================================================================
-- §2 触发器：yb_comments_sync_helps
--   契约：db/schema.sql §1「评论增删时同步 yb_posts.helps」；
--   铁律 8：helps 由触发器维护，客户端勿自行维护
-- ============================================================================
create or replace function public.yb_comments_sync_helps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'DELETE') then
    update public.yb_posts set helps = helps - 1 where id = old.post_id;
    return old;
  else
    -- INSERT 或 UPDATE 换了 post_id：新帖 +1
    update public.yb_posts set helps = helps + 1 where id = new.post_id;
    if (tg_op = 'UPDATE') then
      update public.yb_posts set helps = helps - 1 where id = old.post_id;
    end if;
    return new;
  end if;
end;
$$;

drop trigger if exists yb_comments_sync_helps on public.yb_comments;
create trigger yb_comments_sync_helps
  after insert or update of post_id or delete on public.yb_comments
  for each row execute function public.yb_comments_sync_helps();


-- ============================================================================
-- §3 is_admin() —— 所有管理权限的判定核心
-- ============================================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.yb_admins where user_id = auth.uid());
$$;


-- ============================================================================
-- §4 RLS：逐表启用 + 建策略（先 enable 再建，幂等 drop+create）
--   权限模型与原站一致：看内容免费（含未登录），发言/发布需登录，
--   管理能力收在 is_admin() 之后
-- ============================================================================

-- 4.1 yb_posts：全员可读（hidden 行只有作者与管理员可见）；写=登录本人；改=作者/管理员
alter table public.yb_posts enable row level security;
drop policy if exists yb_posts_select_all on public.yb_posts;
create policy yb_posts_select_all on public.yb_posts
  for select using (
    hidden = false
    or owner_id = auth.uid()
    or public.is_admin()
  );
drop policy if exists yb_posts_insert_own on public.yb_posts;
create policy yb_posts_insert_own on public.yb_posts
  for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists yb_posts_update_own on public.yb_posts;
create policy yb_posts_update_own on public.yb_posts
  for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists yb_posts_delete_own on public.yb_posts;
create policy yb_posts_delete_own on public.yb_posts
  for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

-- 4.2 yb_comments：留言需登录可见（gate.js「看留言需登录」同口径）；写=本人
alter table public.yb_comments enable row level security;
drop policy if exists yb_comments_select_auth on public.yb_comments;
create policy yb_comments_select_auth on public.yb_comments
  for select to authenticated using (true);
drop policy if exists yb_comments_insert_own on public.yb_comments;
create policy yb_comments_insert_own on public.yb_comments
  for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists yb_comments_delete_own on public.yb_comments;
create policy yb_comments_delete_own on public.yb_comments
  for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

-- 4.3 yb_cases：SELECT 全员 / INSERT 作者 / DELETE 管理员或作者（策略名沿用原站）
alter table public.yb_cases enable row level security;
drop policy if exists yb_cases_select_all on public.yb_cases;
create policy yb_cases_select_all on public.yb_cases
  for select using (
    hidden = false
    or owner_id = auth.uid()
    or public.is_admin()
  );
drop policy if exists yb_cases_insert_own on public.yb_cases;
create policy yb_cases_insert_own on public.yb_cases
  for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists yb_cases_update_own on public.yb_cases;
create policy yb_cases_update_own on public.yb_cases
  for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists yb_cases_admin_remove on public.yb_cases;
create policy yb_cases_admin_remove on public.yb_cases
  for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

-- 4.4 yb_settings：全员可读（license.js 匿名读）；直写不开放，走 §6.2 RPC
alter table public.yb_settings enable row level security;
drop policy if exists yb_settings_select_all on public.yb_settings;
create policy yb_settings_select_all on public.yb_settings
  for select using (true);

-- 4.5 yb_profiles：本人读写（user_id = auth.uid()）
alter table public.yb_profiles enable row level security;
drop policy if exists yb_profiles_select_own on public.yb_profiles;
create policy yb_profiles_select_own on public.yb_profiles
  for select to authenticated using (user_id = auth.uid());
drop policy if exists yb_profiles_insert_own on public.yb_profiles;
create policy yb_profiles_insert_own on public.yb_profiles
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists yb_profiles_update_own on public.yb_profiles;
create policy yb_profiles_update_own on public.yb_profiles
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());
-- 昵称要展示给全站（帖子上的 owner_name 之外，档案页互访），昵称列全员可读：
drop policy if exists yb_profiles_select_nick on public.yb_profiles;
create policy yb_profiles_select_nick on public.yb_profiles
  for select using (true);

-- 4.6 yb_gifts：送=登录本人（from_id）；收发双方可见；标记已读=收方
alter table public.yb_gifts enable row level security;
drop policy if exists yb_gifts_insert_own on public.yb_gifts;
create policy yb_gifts_insert_own on public.yb_gifts
  for insert to authenticated with check (from_id = auth.uid()::text);
drop policy if exists yb_gifts_select_party on public.yb_gifts;
create policy yb_gifts_select_party on public.yb_gifts
  for select to authenticated
  using (from_id = auth.uid()::text or to_id = auth.uid()::text);
drop policy if exists yb_gifts_update_seen on public.yb_gifts;
create policy yb_gifts_update_seen on public.yb_gifts
  for update to authenticated
  using (to_id = auth.uid()::text) with check (to_id = auth.uid()::text);

-- 4.7 yb_tutor_req：登录可提交；仅管理员可读/删（联系方式是敏感数据）
alter table public.yb_tutor_req enable row level security;
drop policy if exists yb_tutor_req_insert_auth on public.yb_tutor_req;
create policy yb_tutor_req_insert_auth on public.yb_tutor_req
  for insert to authenticated with check (true);
drop policy if exists yb_tutor_req_select_admin on public.yb_tutor_req;
create policy yb_tutor_req_select_admin on public.yb_tutor_req
  for select to authenticated using (public.is_admin());
drop policy if exists yb_tutor_req_delete_admin on public.yb_tutor_req;
create policy yb_tutor_req_delete_admin on public.yb_tutor_req
  for delete to authenticated using (public.is_admin());

-- 4.8 yb_errlog：匿名可写、无人可读（排障走控制台 SQL / 服务端）
alter table public.yb_errlog enable row level security;
drop policy if exists yb_errlog_insert_any on public.yb_errlog;
create policy yb_errlog_insert_any on public.yb_errlog
  for insert to anon, authenticated with check (true);

-- 4.9 yb_reports：登录提交/看自己的；管理员读写；任何人不可删（审计痕迹）
alter table public.yb_reports enable row level security;
drop policy if exists yb_reports_insert_own on public.yb_reports;
create policy yb_reports_insert_own on public.yb_reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid())::text);
drop policy if exists yb_reports_select_own on public.yb_reports;
create policy yb_reports_select_own on public.yb_reports
  for select to authenticated
  using (reporter_id = (select auth.uid())::text);
drop policy if exists yb_reports_select_admin on public.yb_reports;
create policy yb_reports_select_admin on public.yb_reports
  for select to authenticated using (public.is_admin());
drop policy if exists yb_reports_update_admin on public.yb_reports
;
create policy yb_reports_update_admin on public.yb_reports
  for update to authenticated using (public.is_admin())
  with check (public.is_admin());
-- 故意不建 DELETE 策略（与 db/schema.sql §2 同）

-- 4.10 yb_admins：管理员可读自己这张表，其余只能走 is_admin()（service role 管理）
alter table public.yb_admins enable row level security;
drop policy if exists yb_admins_select_admin on public.yb_admins;
create policy yb_admins_select_admin on public.yb_admins
  for select to authenticated using (public.is_admin());


-- ============================================================================
-- §5 存储桶 media（私有，路径约定 shared/<uid>/...）
--   现站路径来自 cloud.storage.sharedPath(uid, "img/xxx") = shared/<uid>/img/xxx
--   自建侧统一放 bucket "media"，cloud.js 改造时拼 media/shared/<uid>/...
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

-- 上传：登录用户只能写自己 uid 名下的 shared/ 前缀
drop policy if exists yb_media_insert_own on storage.objects;
create policy yb_media_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'shared'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
-- 读（签名 URL 前置要求）：登录用户可读 shared/ 全部（签 URL 由后端发）
drop policy if exists yb_media_select_auth on storage.objects;
create policy yb_media_select_auth on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'shared'
  );
-- 删自己的素材（删帖时清图）或管理员
drop policy if exists yb_media_delete_own on storage.objects;
create policy yb_media_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'shared'
    and ((storage.foldername(name))[2] = auth.uid()::text or public.is_admin())
  );


-- ============================================================================
-- §6 服务端函数（RPC，前端调用点逐一对应）
-- ============================================================================

-- 6.1 yb_post_solve(pid)：标记求助已解决（SECURITY DEFINER 校验 owner）
--   证据：cloud.js:1198-1205（rpc("yb_post_solve",[Number(cloudId)])）
create or replace function public.yb_post_solve(pid bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v int;
begin
  update public.yb_posts
     set solved = true
   where id = pid
     and owner_id = auth.uid();
  get diagnostics v = row_count;
  return v > 0;
end;
$$;

-- 6.2 admin_set_setting(p_key, p_value)：管理员写配置
--   证据：admin.js:849/571/913 等（p_key/p_value 命名与前端一致）
create or replace function public.admin_set_setting(p_key text, p_value text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  insert into public.yb_settings (key, value, updated_at)
  values (p_key, p_value, now())
  on conflict (key) do update
    set value = excluded.value, updated_at = now();
  return json_build_object('ok', true);
end;
$$;

-- 6.3 admin_guard_status()：管理密码是否已设置（+锁定状态）
--   证据：adminguard.js:153-160（期望返回 {ok,is_set,locked_until}）
create or replace function public.admin_guard_status()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare r public.yb_admin_guard;
begin
  if not public.is_admin() then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  select * into r from public.yb_admin_guard where id = 1;
  return json_build_object(
    'ok', true,
    'is_set', coalesce(r.pwd_hash <> '', false),
    'locked_until', r.locked_until
  );
end;
$$;

-- 6.4 admin_set_password(p_new, p_old default null)：设置/修改管理密码（改需旧密码）
--   证据：adminguard.js:14-15；bcrypt 存哈希，密码不落前端
--   p_old 必须带 default null：前端「首次设置」只传 p_new（adminguard.js:212），
--   没有默认值时 PostgREST 找不到 admin_set_password(p_new) 单参形态（2026-11-01 线上踩坑）
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

-- 6.5 admin_verify_password(p_password)：校验，错 5 次锁 5 分钟
--   证据：adminguard.js:184-199（期望 {ok} / {ok:false,reason,left,locked_until}）
create or replace function public.admin_verify_password(p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare r public.yb_admin_guard;
begin
  if not public.is_admin() then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  select * into r from public.yb_admin_guard where id = 1;
  if r is null or coalesce(r.pwd_hash, '') = '' then
    return json_build_object('ok', false, 'reason', 'not_set');
  end if;
  if r.locked_until is not null and r.locked_until > now() then
    return json_build_object('ok', false, 'reason', 'locked', 'locked_until', r.locked_until);
  end if;
  if crypt(p_password, r.pwd_hash) = r.pwd_hash then
    update public.yb_admin_guard
       set failed_count = 0, locked_until = null, updated_at = now()
     where id = 1;
    return json_build_object('ok', true);
  end if;
  update public.yb_admin_guard
     set failed_count = failed_count + 1,
         locked_until = case when failed_count + 1 >= 5
                             then now() + interval '5 minutes' end,
         updated_at = now()
   where id = 1
   returning failed_count into r;
  if r.failed_count >= 5 then
    return json_build_object('ok', false, 'reason', 'locked',
                             'locked_until', now() + interval '5 minutes');
  end if;
  return json_build_object('ok', false, 'left', 5 - r.failed_count);
end;
$$;


-- 6.6 yb_admin_health()：云端深度体检（数据规模 / 表清单与 RLS 防线）
--   证据：admin.js:601-604（期望 {posts,comments,cases,errlog,errlog24h,tables:[{name,rls}],checked_at}）
--   非管理员返回 {error:...}，前端 deepHTML 的 h.error 分支直接展示
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

-- 6.7 yb_admin_recent_errs(p_limit)：最近用户端错误明细
--   证据：admin.js:614-618 errsHTML（期望行含 kind/msg/src/build/created_at）
--   非管理员返回空集（无行）
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

-- 6.8 yb_admin_clear_errs(p_days)：清理 p_days 天前的错误日志，返回删除条数
--   证据：admin.js:1059-1062（"已清理 " + r.data + " 条" → 必须返回数字本身）
create or replace function public.yb_admin_clear_errs(p_days int default 7)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare n bigint;
begin
  if not public.is_admin() then
    return -1;   -- 前端拿到负数显示失败
  end if;
  delete from public.yb_errlog
   where created_at < now() - make_interval(days => greatest(coalesce(p_days, 7), 1));
  get diagnostics n = row_count;
  return n;
end;
$$;


-- ============================================================================
-- §7 权限收敛（Supabase 默认给 anon/authenticated 授了表级全权，RLS 兜底，
--   但把直接执行管理函数的口子收窄到 authenticated 更干净）
-- ============================================================================
revoke execute on function public.admin_set_setting(text, text) from anon;
revoke execute on function public.admin_guard_status() from anon;
revoke execute on function public.admin_set_password(text, text) from anon;
revoke execute on function public.admin_verify_password(text) from anon;
revoke execute on function public.yb_post_solve(bigint) from anon;
revoke execute on function public.yb_admin_health() from anon;
revoke execute on function public.yb_admin_recent_errs(int) from anon;
revoke execute on function public.yb_admin_clear_errs(int) from anon;


-- ============================================================================
-- §8 自检清单（Run 完后自动打印，确认全部 appear = 安装成功）
-- ============================================================================
do $$
declare
  t int; f int; trg int; pol int; b int;
begin
  select count(*) into t   from pg_tables
   where schemaname='public' and tablename in
     ('yb_posts','yb_comments','yb_cases','yb_settings','yb_profiles','yb_gifts',
      'yb_tutor_req','yb_errlog','yb_reports','yb_admins','yb_admin_guard');
  select count(*) into f   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in
     ('is_admin','admin_set_setting','admin_guard_status','admin_set_password',
      'admin_verify_password','yb_post_solve','yb_comments_sync_helps',
      'yb_admin_health','yb_admin_recent_errs','yb_admin_clear_errs');
  select count(*) into trg from pg_trigger
   where tgrelid='public.yb_comments'::regclass and tgname='yb_comments_sync_helps' and not tgisinternal;
  select count(*) into pol from pg_policies where schemaname='public';
  select count(*) into b   from storage.buckets where id='media';
  raise notice '════ 安装自检 ════';
  raise notice '业务表      : %/11 （应为 11）', t;
  raise notice '函数/触发器 : %/10 （应为 10）', f;
  raise notice 'helps 触发器: %/1 （应为 1）', trg;
  raise notice 'RLS 策略    : %   （应 ≥ 24）', pol;
  raise notice 'media 桶    : %/1 （应为 1）', b;
end;
$$;


-- ============================================================================
-- §9 收尾：注册管理员（两步，都只在 SQL Editor 做）
-- ============================================================================
-- 第 1 步：先去网站用「用户名+密码」注册你的管理员账号（走 /sbapi 代理，
--          由改造后的 cloud.js 完成——该改造是下一步工作）。
-- 第 2 步：注册成功后回来，把下面这行的用户名换掉再 Run 一次：
--
-- insert into public.yb_admins (user_id, note)
-- select id, '站长'
--   from auth.users
--  where email = '你的用户名@usr.yurenbang.cn'
-- on conflict (user_id) do nothing;
--
-- 验证：select public.is_admin(); 用管理员账号的 token 调用应返回 true。
-- ============================================================================
