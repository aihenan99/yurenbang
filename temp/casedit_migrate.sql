-- casedit 迁移（2026-10-27）：图文案例正文列
-- 执行时机：云服务额度恢复后，用 workbuddy_cloudservice_db_exec_sql（mode=migrate，绕过 RLS）执行本文件内容。
-- 回滚：ALTER TABLE public.yb_cases DROP COLUMN IF EXISTS content_html;（仅在前端已回退到旧版时执行）

ALTER TABLE public.yb_cases ADD COLUMN IF NOT EXISTS content_html text;

COMMENT ON COLUMN public.yb_cases.content_html IS
  '图文案例正文（casedit 层白名单清洗后的 HTML，img 带 data-yrb-media 序号指向 media 数组；2026-10-27）';

-- 验证：
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='yb_cases' AND column_name='content_html';
