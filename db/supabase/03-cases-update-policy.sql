-- ============================================================
-- 03 · 案例二次编辑所需的更新策略（2026-11-03）
-- 背景：后台「案例管理」新增「编辑内容」（改标题 / 正文）。
--       前端用 PostgREST PATCH（from("yb_cases").update(...)），
--       需要 yb_cases 上存在 UPDATE 策略，否则数据库返回 0 行（200 空数组），
--       前端会提示「没有修改权限」。
-- 说明：01-schema.sql 已包含同名策略；本文件为幂等补丁，
--       线上若从未执行过 01 全量，可在 SQL Editor 单独跑这一段。
-- 权限口径与删除一致：作者本人 或 管理员（is_admin()）。
-- ============================================================

alter table public.yb_cases enable row level security;

drop policy if exists yb_cases_update_own on public.yb_cases;
create policy yb_cases_update_own on public.yb_cases
  for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

-- 自检：应返回 1 行（policy 存在）
-- select policyname, cmd from pg_policies
--  where schemaname = 'public' and tablename = 'yb_cases' and cmd = 'UPDATE';
