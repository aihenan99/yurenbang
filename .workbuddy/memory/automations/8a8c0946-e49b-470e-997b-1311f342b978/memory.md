# 云服务额度巡检 · 执行记录

## 2026-10-26 19:17
- inspect：应用 育人帮（wbapp_Lt4Zxzyd4j1x3DZdRFyFF9）lifecycleState=active，**billingStatus=credits_exhausted**（异常）
- 数据库验证：SELECT count(*) FROM public.yb_posts → 402 **DATABASE_RESOURCE_ISOLATED**（已被隔离）
- 结论：本月资源点用尽，云数据库已被隔离；已向用户发出告警（升级/购买加量包 或 等次月1号刷新；数据仅保留15天）
- 未修改任何代码或数据
