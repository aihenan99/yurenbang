-- ============================================================================
-- 育人帮 · 数据库契约与迁移基线
-- 建立日期：2026-10-28
--
-- 【这是什么】
--   一份可以被 review、被版本管理、被重复执行的数据库契约文件。分三段：
--     §1 现有表的字段契约（**注释形式，不执行**）——用于恢复后与线上核对
--     §2 可执行迁移（CREATE TABLE IF NOT EXISTS + 幂等策略）——只新增，不改现有
--     §3 核对清单（恢复后跑一遍，把结果贴回来存档）
--
-- 【这不是什么】
--   不是线上 dump。云端自 2026-10-26 起 402 隔离，未能导出真实 DDL。
--   §1 的字段是从客户端代码反推的（每条标注证据文件:行号），
--   可能与线上有出入（少列、类型不同、多了默认值）。
--   **执行前必须先用 §3 的查询核对，不要盲跑 §2 之外的任何东西。**
--
-- 【为什么只新增、不重写现有策略】
--   线上 RLS 策略的真实内容未知。凭猜测 drop/create policy 有两种结局：
--   要么打开越权口子，要么把正常功能锁死。所以本文件对现有表**一个策略都不碰**，
--   只把它们"记下来"，等恢复后 dump 出真实定义再补写。
--
-- 【执行方式】
--   恢复后用 workbuddy_cloudservice_db_exec_sql（mode=migrate，可绕过 RLS）
--   逐段执行；§1 是注释，不用执行。
-- ============================================================================


-- ============================================================================
-- §1 现有表字段契约（注释，供核对）
-- ============================================================================
--
-- yb_posts  求助/分享主表
--   证据：cloud.js:1073-1078（insert row）、cloud.js:1184（hidden 过滤）
--   字段：id、type、title、body、tag、age、urg、vis、loc、
--         owner_name、owner_flag、owner_id*、media(jsonb)、
--         hidden(bool)、helps(int)、likes(int)、favs(int)、created_at
--   说明：helps 由触发器 yb_comments_sync_helps 维护（客户端只读，勿自行累加）
--         media 元素形如 {kind, path, dur?, thumb?}
--   待核对：owner_id 是否真实存在（代码写入 row 时未带，读取评论时用到）
--
-- yb_comments  帮忙回应
--   证据：cloud.js:1105-1122（select * + 字段映射）、cloud.js:1127-1131（insert）
--   字段：id、post_id、body、owner_name、owner_flag、owner_id、
--         kind、dur、media(jsonb)、created_at
--   说明：insert 只带 post_id/body/owner_name/owner_flag/kind，其余靠默认值
--
-- yb_cases  案例广场
--   证据：cloud.js:1285-1305（select * + 映射）、casedit_migrate.sql（content_html）
--   字段：id、title、owner_name、owner_flag、owner_id*、type、media(jsonb)、
--         content_html(text, 2026-10-27 新增)、hidden(bool)、created_at
--   已知策略（据 2026-10-24 记录，待核对）：SELECT 全员 / INSERT 作者 /
--         DELETE is_admin() 或作者本人（策略名 yb_cases_admin_remove、yb_cases_delete_own）
--
-- yb_settings  站点配置（键值）
--   证据：admin.js:172-173、797-806
--   字段：key(text, 主键?)、value(text/jsonb)
--   已知键：jiaojiao_qr、license 相关、chips 栏目配置等
--   注意：大图片写入前必须压到 ≤200KB
--
-- yb_profiles  用户档案
--   证据：profile.js:34-50（select/update/insert 均以 user_id 为键）
--   字段：user_id(text, 主键/唯一)、另有昵称/头像等 row 字段（待核对具体列名）
--
-- yb_gifts  玫瑰/答谢
--   证据：food.js:208-211、refine23.js:782-784、food.js:396-411
--   字段：id、from_id、from_name、to_id、to_name、seen(bool)、created_at
--   已知查询：.or('to_id.eq.UID,from_id.eq.UID')
--
-- yb_tutor_req  家教/辅导需求
--   证据：仅见 from('yb_tutor_req')，未取字段 —— **待核对**
--
-- yb_errlog  前端错误上报
--   证据：guard.js:86（匿名批量 insert）
--   策略（据 guard.js:9 注释）：匿名可写、无直读权限，只能管理员经 RPC 查看
--   字段：待核对（batch 内元素键需读 guard.js 确认）
--
-- yb_admin_guard  管理密码守卫
--   证据：adminguard.js:10-12、admin.js RPC 调用
--   策略：开启 RLS 且**不建任何策略**（表不可直读、不可直写），
--         仅通过 SECURITY DEFINER 函数读写
--   内容：bcrypt 哈希（密码本身不落前端）
--   重置：DELETE FROM public.yb_admin_guard WHERE id=1;（会清空，重设即可）
--
-- 已知函数/RPC（前端调用点）
--   admin_guard_status()      admin.js     查询管理密码是否已设置
--   admin_set_password(...)   adminguard.js 设置管理密码（bcrypt）
--   admin_verify_password(..) adminguard.js 校验管理密码
--   admin_set_setting(...)    admin.js     管理员写配置
--   yb_post_solve(...)        后端           标记求助已解决
--   is_admin()                RLS 内使用   判断当前用户是否管理员（**待核对是否存在**）
--   yb_comments_sync_helps    触发器函数    评论增删时同步 yb_posts.helps
--
-- 已知触发器
--   yb_comments_sync_helps ON yb_comments（INSERT/DELETE 时维护 yb_posts.helps）
--
-- 存储桶
--   由 uploadItems / storage 调用推断，桶名待核对（media 里存的是 path，读取时 signPaths 签名）


-- ============================================================================
-- §2 可执行迁移（幂等，可重复执行）
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 2.1 yb_reports：举报受理表（2026-10-28 新增）
--
-- 为什么需要它：原 submitReport() 只弹一句"已提交"，不落库、无受理方，
-- 属于假功能。涉及未成年人的社区必须有真实可查的举报链路。
--
-- 设计要点：
--   · snapshot 存举报时刻的内容快照 —— 原帖被删/被改后仍有证据
--   · status 只增不改删 —— 管理员可改状态，任何人不可删行（保留审计痕迹）
--   · 匿名不可提交 —— 举报需登录，与「看内容免费、发言需登录」的门槛一致
-- ---------------------------------------------------------------------------
create table if not exists public.yb_reports (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),

  -- 举报对象：post=求助 / case=案例 / comment=帮忙回应
  target_type   text not null check (target_type in ('post', 'case', 'comment')),
  target_id     text not null,              -- 云端行 id（字符串，兼容 bigint 与 uuid）
  target_title  text,                       -- 冗余标题，便于后台列表直接看
  snapshot      text,                       -- 举报时刻正文快照（截断 2000 字）

  reason        text not null,              -- 取自前端 RP_REASONS 七项之一
  note          text,                       -- 用户补充说明（可选）

  reporter_id   text,                       -- auth uid（RLS 校验与 reporter_id 相等）
  reporter_name text,                       -- 显示名（不含手机号）

  status        text not null default 'open'
                check (status in ('open', 'handled', 'rejected')),
  handled_at    timestamptz,
  handled_by    text,                       -- 处理人标识
  handle_note   text                        -- 处理结论
);

comment on table  public.yb_reports is '内容举报受理表（2026-10-28 新增，替代原前端假弹窗）';
comment on column public.yb_reports.snapshot is '举报时刻内容快照，防原帖删除后无据可查';
comment on column public.yb_reports.status   is 'open=待处理 / handled=已处理 / rejected=不成立';

-- 后台按状态倒序列出待处理；同一目标可被多人举报，不做唯一约束
create index if not exists yb_reports_status_idx
  on public.yb_reports (status, created_at desc);
create index if not exists yb_reports_target_idx
  on public.yb_reports (target_type, target_id);

-- ---------------------------------------------------------------------------
-- 2.2 yb_reports 的 RLS
--   注意：一律"先 enable，再加策略"；策略用 DO 块动态建，
--         因为 is_admin() 是否存在未核实 —— 不存在时降级为"本人可读、管理员走服务端"，
--         绝不因为缺函数而误放行。
-- ---------------------------------------------------------------------------
alter table public.yb_reports enable row level security;

-- 本人提交：只能以自己的 uid 写入
drop policy if exists yb_reports_insert_own on public.yb_reports;
create policy yb_reports_insert_own on public.yb_reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid())::text);

-- 本人可看自己提交的（用于「我的举报」进度展示）
drop policy if exists yb_reports_select_own on public.yb_reports;
create policy yb_reports_select_own on public.yb_reports
  for select to authenticated
  using (reporter_id = (select auth.uid())::text);

-- 管理员可看全部、可改状态；不存在 is_admin() 时跳过（宁可少给，不多给）
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise notice '跳过管理员策略：public.is_admin() 不存在。恢复后请先确认该函数，再手工补建 yb_reports_select_admin / yb_reports_update_admin。';
  else
    execute $p$drop policy if exists yb_reports_select_admin on public.yb_reports$p$;
    execute $p$create policy yb_reports_select_admin on public.yb_reports
      for select to authenticated using (public.is_admin())$p$;

    execute $p$drop policy if exists yb_reports_update_admin on public.yb_reports$p$;
    execute $p$create policy yb_reports_update_admin on public.yb_reports
      for update to authenticated using (public.is_admin()) with check (public.is_admin())$p$;

    raise notice '已建立管理员读写策略（依赖 public.is_admin()）';
  end if;
end
$$;

-- 不建 DELETE 策略：任何人（含管理员）都不能删举报行，保留审计痕迹。
-- 若确需清理，走服务端 migrate 权限手工处理。


-- ============================================================================
-- §3 恢复后核对清单（把每条的输出贴进 恢复后待办.md）
-- ============================================================================
--
-- 3.1 现有表的真实列（与 §1 逐条比对，有出入就改 §1）
--   select table_name, column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name like 'yb\_%'
--    order by table_name, ordinal_position;
--
-- 3.2 真实 RLS 策略（这是最该存档的一段）
--   select tablename, policyname, cmd, roles, qual, with_check
--     from pg_policies
--    where schemaname = 'public'
--    order by tablename, policyname;
--
-- 3.3 哪些表开了 RLS（没开的表 = 直连 publishableKey 就能读写，必须逐个确认）
--   select c.relname, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind = 'r'
--    order by c.relrowsecurity, c.relname;
--
-- 3.4 函数与触发器（确认 is_admin / yb_comments_sync_helps 的真实定义）
--   select p.proname, p.prosecdef as security_definer, pg_get_functiondef(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname in
--          ('is_admin','admin_guard_status','admin_verify_password',
--           'admin_set_password','admin_set_setting','yb_post_solve','yb_comments_sync_helps');
--
--   select tgname, pg_get_triggerdef(t.oid)
--     from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where not t.tgisinternal and c.relname in ('yb_comments','yb_posts','yb_cases');
--
-- 3.5 核对完成后：把 3.1-3.4 的真实输出写成 db/schema.dump.sql 入库，
--     并把 §1 的"待核对"标记清空 —— 那时本文件才从"契约"升级为"事实"。


-- ============================================================================
-- §4 回滚
-- ============================================================================
-- 仅在前端举报功能已回退到旧版时执行：
--   drop table if exists public.yb_reports;
-- 注意：drop 会丢掉已有举报记录。云端有真实举报后，回滚只应停用前端入口，不要删表。
