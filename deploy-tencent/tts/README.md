# 本机语音合成服务（yrbtts）

境内站点的朗读原本靠 `proxy_pass` 回源 Cloudflare 的 Worker——等于说境内机器只是
半个独立：**CF 一停，朗读就哑**。这个服务把同一套 Edge TTS 逻辑搬到本机，
`/yrbtts` 的主路由指向它，CF 退为兜底。

## 文件

| 文件 | 作用 |
|---|---|
| `yrbtts.mjs` | 服务本体（Node 22，无第三方依赖）。**算法段自动生成，勿手改** |
| `yrbtts.service` | systemd 单元（www-data、127.0.0.1:8791、内存上限 384M、崩了自动重启） |

## 和 Worker 版的关系

接口逐字对齐，前端不用改：

```
GET /yrbtts?t=<文本>&r=norm|slow   → audio/mpeg
GET /healthz                       → 运行状态 JSON
```

区别只在传输层：Worker 用 `fetch(url, {Upgrade:"websocket"})` 拿 `resp.webSocket`，
本服务用 Node 22 内置的 `WebSocket`（undici）并传 `headers`。令牌算法、SSML、
音频格式、错误码全部相同。

### 算法段为什么不手写

`Sec-MS-GEC v2` 是定制哈希（改了初始状态、调度表、CS64 混淆），有一个常量错位就是
403。所以 `yrbtts.mjs` 里那段由 `temp/gen_yrbtts.py` 从 `deploy-cn/_worker.js`
**按行号区间原样切出**。改算法只改 Worker，然后：

```bash
.venv/Scripts/python.exe temp/gen_yrbtts.py
```

`npm run verify` 会重新生成一份到临时目录再逐字对比，漂移直接报错。

## 本机行为

- **缓存**：按「文本 + 语速」做 LRU（240 条 / 32MB），命中从 1.6s 掉到 2ms。
  长辈反复听同一段话是常态，这一层很值
- **并发**：最多 3 个合成同时在跑，多的排队（上限 24 个，再超才回 503）。
  2C2G 的机器，打满内存比慢一点更糟
- **超时**：单次合成 12s 放弃，nginx 侧 40s
- **失败**：返回 502 + 固定文案（"语音合成暂时不可用，将改用本机朗读"），
  由 nginx `error_page` 转去 CF 兜底；真兜不住时前端还有本机语音

## 运维

```bash
systemctl status yrbtts                 # 在跑吗
journalctl -u yrbtts -n 50              # 最近日志
curl -s 127.0.0.1:8791/healthz          # 直接问服务
curl -s -o /tmp/a.mp3 '127.0.0.1/yrbtts?t=你好&r=norm' && ls -l /tmp/a.mp3
```

改完 `yrbtts.mjs` 后：

```bash
install -m 644 yrbtts.mjs /opt/yrbtts/yrbtts.mjs
systemctl restart yrbtts
```

## 排障对照

| 现象 | 多半是 | 看哪里 |
|---|---|---|
| `/yrbtts` 返回 200 但 0 字节 | 服务连上了但没出音频 | `journalctl -u yrbtts`；`x-yrb-tts` 头是 hit 还是 miss |
| 响应头 `X-YRB-TTS-Bridge: 2` | 走的是 CF 兜底，本机服务挂了 | `systemctl status yrbtts` |
| 一直 502 | 出口到 `speech.platform.bing.com` 不通 | 服务器上 `node -e "fetch('https://speech.platform.bing.com/').then(r=>console.log(r.status))"` |
| 429 | nginx 限流（20 次/分/IP） | 正常保护，不是故障 |
| 503 busy | 排队超 24 个 | 异常流量，查 access log |

`X-YRB-TTS-Bridge` 是判断走哪条路的第一眼证据：`1` = 本机合成，`2` = 回源 CF。
