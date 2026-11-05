-- ============================================================
-- 育人帮 · 点赞 / 收藏入库（2026-11-05）
-- 在 Supabase 控制台 → SQL Editor 整段粘贴执行；可重复执行（幂等）。
--
-- 为什么需要它：
--   此前「收藏」只写在本机 localStorage，换手机就没了；「点赞」的状态每次
--   从云端拉数据都被重置成 false，刷新即消失；发布者看到的 ⭐ 数永远是 0。
--   于是「登录才能收藏」这道门槛，后面接的是一个不落库的口袋。
--
-- 设计：
--   一张 yb_reacts 同时承载 like / fav（kind 区分），主键天然防重复；
--   计数不信任客户端 —— 由触发器在库端回写 yb_posts.likes / yb_posts.favs，
--   前端只负责「我要 / 我不要」，不自己加减。这样任何一端作弊都会被计数纠正。
-- ============================================================

create table if not exists public.yb_reacts (
  post_id    bigint      not null references public.yb_posts(id) on delete cascade,
  user_id    uuid        not null references auth.users(id)    on delete cascade,
  kind       text        not null check (kind in ('like', 'fav')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, kind)
);

create index if not exists yb_reacts_mine_idx on public.yb_reacts (user_id, kind);

alter table public.yb_reacts enable row level security;

-- 只允许看到/改动自己的反应：
--   不给「谁赞了我」的公开读，避免陌生人能反查某个账号的点赞足迹。
--   公开可见的只有 yb_posts.likes / favs 两个汇总数（本来就是公开字段）。
drop policy if exists yb_reacts_select_own on public.yb_reacts;
create policy yb_reacts_select_own on public.yb_reacts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists yb_reacts_insert_own on public.yb_reacts;
create policy yb_reacts_insert_own on public.yb_reacts
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists yb_reacts_delete_own on public.yb_reacts;
create policy yb_reacts_delete_own on public.yb_reacts
  for delete to authenticated using (user_id = auth.uid());

-- ---------- 计数回写 ----------
create or replace function public.yb_reacts_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pid bigint;
  d   int;
  k   text;
begin
  if tg_op = 'INSERT' then pid := new.post_id; d := 1;  k := new.kind;
  else                      pid := old.post_id; d := -1; k := old.kind;
  end if;

  if k = 'like' then
    update public.yb_posts set likes = greatest(0, coalesce(likes, 0) + d) where id = pid;
  else
    update public.yb_posts set favs  = greatest(0, coalesce(favs,  0) + d) where id = pid;
  end if;

  return null;   -- after 触发器的返回值被忽略
end $$;

drop trigger if exists yb_reacts_trg on public.yb_reacts;
create trigger yb_reacts_trg
  after insert or delete on public.yb_reacts
  for each row execute function public.yb_reacts_sync();

-- ---------- 存量校正 ----------
-- 首次执行把两个计数按真实关系重算一遍；之后再执行也无副作用（幂等）。
update public.yb_posts p set
  likes = coalesce((select count(*) from public.yb_reacts r
                     where r.post_id = p.id and r.kind = 'like'), 0),
  favs  = coalesce((select count(*) from public.yb_reacts r
                     where r.post_id = p.id and r.kind = 'fav'),  0);

-- 自检（执行后应各回一行，rows 为 0 也算正常：还没人点赞/收藏）
select 'yb_reacts' as t, count(*) as rows from public.yb_reacts;
