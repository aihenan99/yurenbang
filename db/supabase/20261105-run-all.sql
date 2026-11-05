-- ============================================================
-- 育人帮 · 2026-11-05 一次性执行包（点赞收藏入库 + 未登录看图）
--
-- 用法：Supabase 控制台 → SQL Editor → New query → 全选粘贴 → Run
-- 幂等：可重复执行，重复跑不会重复建表/重复加策略/不会把计数算错
-- 本文件由 db/supabase/04-reacts.sql + 05-storage-guest-media.sql 拼接生成，
-- 不手改；要改请改源文件后重新拼。
-- ============================================================

-- ########################  第 1 段：点赞 / 收藏入库  ########################

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


-- ########################  第 2 段：未登录访客看图  ########################

-- ============================================================
-- 育人帮 · 未登录访客看图（2026-11-05）
-- 在 Supabase 控制台 → SQL Editor 整段粘贴执行；可重复执行（幂等）。
--
-- 为什么需要它：
--   产品规则是「任何人都可以浏览、分享，只有注册用户才能发布求助、帮忙与收藏」。
--   但存储桶是私有的，未登录（anon 角色）拿不到签名地址，卡片上只能显示
--   「🔒 登录后可查看」。这不是前端设的卡，是数据层权限，只能用 SQL 放开。
--
-- 放开到什么程度（故意的边界）：
--   · 只给 anon 加 SELECT —— 匿名可以「取一张已知路径的图」，不能上传、不能删除、不能覆盖；
--   · 只覆盖 bucket = media 且路径第一段是 shared/ 的对象（求助、案例、帮忙留言的素材）；
--   · 不碰 users/<uid>/... 下的私有对象。
--
-- 已知代价（如实记录，不粉饰）：
--   storage 的「列举目录」和「取单张」共用同一条 SELECT 权限，因此放开后
--   匿名理论上可以枚举 shared/ 下的文件名。缓解有三点：文件名是
--   「毫秒时间戳-序号-6 位随机串」，不可猜；这些素材本来就展示在公开帖子里；
--   站点不提供任何目录浏览入口。若日后要求更严，只能改为「服务端签发放行」，
--   届时本 policy 删除即可回滚（见文件末尾）。
-- ============================================================

drop policy if exists yrb_media_guest_read on storage.objects;

create policy yrb_media_guest_read on storage.objects
  for select to anon
  using (
    bucket_id = 'media'
    and split_part(name, '/', 1) = 'shared'
  );

-- 自检：anon 角色当前对 storage.objects 有几条 select 策略（应 >= 1）
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

-- ---------- 回滚（需要时单独执行下面这一行） ----------
-- drop policy if exists yrb_media_guest_read on storage.objects;


-- ########################  执行完的自检结果  ########################
-- 期望看到：
--   1) yb_reacts 一行，rows = 0（还没人点赞收藏，正常）
--   2) storage.objects 的策略列表里出现 yrb_media_guest_read（cmd=SELECT, roles={anon}）
select 'yb_reacts 表' as 检查项, count(*)::text as 结果 from public.yb_reacts
union all
select '匿名保底策略' as 检查项,
       coalesce((select count(*)::text from pg_policies
                 where schemaname='storage' and tablename='objects'
                   and policyname='yrb_media_guest_read'), '0')
union all
select 'likes/favs 字段' as 检查项,
       (select count(*)::text from information_schema.columns
        where table_schema='public' and table_name='yb_posts'
          and column_name in ('likes','favs'));
