-- 只做一件事：列出库里现有的全部账号（把结果截图发我）
select
  case when u.email like 'u%@usr.yurenbang.cn'
       then convert_from(decode(substr(u.email, 2, strpos(u.email,'@') - 2), 'hex'), 'UTF8')
       else u.email end as 用户名,
  u.created_at as 注册时间
from auth.users u
order by u.created_at;
