-- ============================================================================
-- 清理 7 个测试账号（只删下面列出的精确用户名，其余一律不动）
-- 用法：SQL Editor → New query → 粘贴 → Run
-- ============================================================================

-- ① 先看要删的是哪些（核对一眼再往下看结果）
select p.user_name as 待删用户名, u.created_at as 注册时间
  from public.yb_profiles p
  join auth.users u on u.id = p.user_id
 where p.user_name in ('testmvxru6ru','testmvxrwb9l','testmvxrx08v',
                       '小明妈妈yhs','验收si2xz','验收uj7i','示例xzwe')
 order by u.created_at;

-- ② 执行删除（同名才删）
delete from auth.users u
 using public.yb_profiles p
 where p.user_id = u.id
   and p.user_name in ('testmvxru6ru','testmvxrwb9l','testmvxrx08v',
                       '小明妈妈yhs','验收si2xz','验收uj7i','示例xzwe');

-- ③ 复核：删除后还剩谁（应该只有「爱河南99」）
select p.user_name as 剩余用户, u.created_at as 注册时间
  from public.yb_profiles p
  join auth.users u on u.id = p.user_id
 order by u.created_at;

-- ④ 顺带看一眼：残留的登录身份（正常应只剩你的伪邮箱）
select email as 登录身份, created_at as 创建时间
  from auth.users
 order by created_at;
