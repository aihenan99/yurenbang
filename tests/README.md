# tests/ —— 测试脚本目录

> 2026-10-28 从 `temp/` 迁入。`temp/` 从此只放**构建发布工具与素材**（说明见 `temp/README.md`：sync_deploy.py、release.py、ppt 样本、playwright 运行时等），
> 所有**测试脚本**都住在这里。

## 一、五个分类

| 目录 | 含义 | 何时跑 | 现状 |
|------|------|--------|------|
| `core/` | 门禁内，必须绿 | 每次 `npm run verify:e2e` | 8 个，132 断言 |
| `scenario/` | 功能专项回归（有明确断言） | 改到相关功能时手动跑 | 31 个 |
| `live/` | 直连**生产域名**的冒烟/校验 | **云隔离期禁跑**；发版后手动 | 12 个 |
| `diag/` | 诊断探针（真机/云端恢复后复验用；一次性 dbg/编号 probe 已归档至 `.cache/deprecated-tests/diag/`） | 遇疑难时当参考手册翻 | 85 个 + `sdk-debug/` 子目录 |
| `tools/` | 非测试：SDK 试验、截图、TTS 令牌生成 | 按需 | 7 个 |

旧迭代版本（`mf-dbg2..6`、`verify2..5` 这类被新版取代的）**不在库里**，归档在
`.cache/deprecated-tests/`（附清单与恢复命令，见该目录 `RESTORE.md`）。

## 二、跑测试

```bash
npm run verify:e2e        # core 全跑（需 8796 + 8793 两个服务）
node tests/core/longimg-test.js   # 单独跑一个
```

服务没起时 core 会「跳过」而不是失败。`scenario/` 与 `live/` 不进门禁，按需手动：

```bash
npm run serve                                    # 8796 源码
python -m http.server 8793 --bind 127.0.0.1      # 8793 项目根
node tests/scenario/ppt-full-test.js
```

## 三、写新测试的规矩

1. **放在 `scenario/`**，跑稳了、值得长期守护，再晋升进 `core/` 并接进 `scripts/verify.mjs`
2. 引用浏览器运行时统一用相对路径（迁移后已自动改好）：

   ```js
   const { chromium } = require("../../temp/pw/node_modules/playwright-core");
   ```

   不要用 `require("playwright-core")` 裸写法——那要靠 NODE_PATH，换机器就崩
3. 末行必须是 **`结果: N 通过, M 失败`**，并 `process.exit(fail ? 1 : 0)`。
   `verify.mjs` 用正则从这行抽用例数，格式不对就只显示「通过」看不到数量
4. 每次 `goto` 带 `?t=Date.now()` 绕缓存；`serviceWorkers: "block"` 关 SW 缓存
5. 桩数据 id 段位固定（9101/9102/9401/9501/990001+），避免互相撞车
6. **不要直连生产**。真需要，放 `live/` 并在文件头注明「云隔离期禁跑」
7. 别用会遮蔽全局的变量名（`const URL = ...` 会把 `URL` 构造函数遮掉，踩过）

## 四、目录之外的相关文件

- `scripts/verify.mjs` —— 统一门禁入口（`--fast` / 标准 / `--e2e`）
- `scripts/layers-audit.mjs` —— 层登记一致性审计
- `scripts/state-audit.mjs` —— 状态边界审计
- `docs/测试手册.md` —— 完整说明（分级、模板、基线与常见问题）
