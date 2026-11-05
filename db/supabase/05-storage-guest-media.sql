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
