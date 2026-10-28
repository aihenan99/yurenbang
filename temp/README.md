# temp/ —— 构建发布工具与素材

> 2026-10-28 起，**测试脚本不在这里**，全部搬到 `../tests/`（core / scenario / live / diag / tools）。
> 本目录只放「跑一次就把产物交出去」的工具，和测试要用的素材。

## 一、这里面是什么

| 路径 | 用途 | 说明 |
|------|------|------|
| `release.py` | **唯一发布入口**：备份→校验→部署→自检→失败自动回滚 | 后台跑，不要手动部署 |
| `sync_deploy.py` | 源码 → `deploy-cn/`：域名适配、打包、构建号、漂移检测 | `npm run sync` 调它 |
| `cf_deploy.py` / `cf_browser_deploy.py` | Cloudflare Pages 上传 | 由 release.py 调用 |
| `gen_seo_anli.py` | 生成静态案例库 `yurenbang-app/anli/` | 改案例文案后重跑 |
| `indexnow_push.py` | 向搜索引擎推送新 URL | 发版后可选 |
| `ppt-test/` | PPT 测试素材 + 配套脚本（`sample_fixed.pptx` 等） | **门禁测试依赖**：`tests/core/cover-test.js` 引它 |
| `pw/` | playwright 运行时（node_modules） | 测试脚本按相对路径引用，不进版本库 |
| `*.sql` | 数据库迁移脚本（如 `casedit_migrate.sql`） | 云恢复后按清单执行 |
| `deploy-com-redirect/` | `.com` → `.cn` 301 的 Pages 工程 | 独立部署 |

## 二、不放什么

- ❌ **测试脚本** → `tests/`（`npm run verify:fast` 会检查，出现就报）
- ❌ 截图、日志、临时导出 → 属于本地产物，已在 `.gitignore` 里
- ❌ 一次性的调试代码 → 用完写进 `tests/diag/`，不要留在这里

## 三、为什么工具和测试分开

工具是「跑一次产出交付物」，测试是「反复跑的断言」，混在一起会出现两个问题：
新人不清楚哪个该跑、哪个跑一次就够；而且测试挪位置会牵动工具路径（`sync_deploy.py` 被
39 处引用），所以**工具原地不动，测试整体迁出**——这是 2026-10-28 迁移的取舍。
