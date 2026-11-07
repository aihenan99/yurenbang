-- ===========================================================================
-- 20261107 · 教师信息登记表（家教页 · 棕黄表格）
--   与 yb_tutor_req（家长需求）成对：这里收的是「老师"自己的资料」。
--   字段严格对齐用户在页面上列出的 9 项，不额外收集（最小必要原则）。
--   联系方式属敏感数据：只允许登录用户提交，仅管理员可读/删。
-- ===========================================================================

create table if not exists public.yb_tutor_teacher (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  name          text not null default '',   -- 姓名
  gender        text not null default '',   -- 性别
  age           int4,                       -- 年龄（可空，前端校验 18-80）
  grade_subject text not null default '',   -- 所教年级及科目
  free_time     text not null default '',   -- 目前空闲时间
  serve_type    text not null default '',   -- 服务类型：上门 / 机构（工作室）
  job_type      text not null default '',   -- 类型：全职 / 兼职 / 大学生
  phone         text not null default '',   -- 电话
  area          text not null default '',   -- 方便的位置
  owner_name    text not null default ''    -- 提交人（登录用户名，便于追溯）
);

create index if not exists yb_tutor_teacher_created_idx
  on public.yb_tutor_teacher (created_at desc);

alter table public.yb_tutor_teacher enable row level security;

drop policy if exists yb_tutor_teacher_insert_auth on public.yb_tutor_teacher;
create policy yb_tutor_teacher_insert_auth on public.yb_tutor_teacher
  for insert to authenticated with check (true);

drop policy if exists yb_tutor_teacher_select_admin on public.yb_tutor_teacher;
create policy yb_tutor_teacher_select_admin on public.yb_tutor_teacher
  for select to authenticated using (public.is_admin());

drop policy if exists yb_tutor_teacher_delete_admin on public.yb_tutor_teacher;
create policy yb_tutor_teacher_delete_admin on public.yb_tutor_teacher
  for delete to authenticated using (public.is_admin());

-- 年龄兜底约束：拦住手滑填的 300 岁
alter table public.yb_tutor_teacher drop constraint if exists yb_tutor_teacher_age_ck;
alter table public.yb_tutor_teacher add constraint yb_tutor_teacher_age_ck
  check (age is null or (age >= 18 and age <= 80));
