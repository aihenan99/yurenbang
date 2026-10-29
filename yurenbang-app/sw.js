/* 育人帮 Service Worker —— 网络优先 + 离线兜底缓存
   策略说明：
   - HTML/JS/CSS 等静态资源：先取网络最新版，成功后更新缓存；断网时回退缓存
   - 2026-10-23 重要修复：核心清单补全全部功能层文件；且**只对页面导航**
     回落到首页 HTML，脚本/样式缓存未命中时绝不返回 HTML（MIME 不符会被
     浏览器拒绝执行，导致家教/答谢/语音等整层功能静默消失）
   - 缓存名升级 v3，激活时自动清掉旧版本
   - 2026-10-23b：部署包主页文件名是 index.html（源码为 yurenbang-app.html），
     清单与离线兜底统一改用 '/'，避免指向不存在的文件（曾致 PWA 安装失败 / 离线打不开） */
/* 2026-10-29 审核 H8 三处加固：
   1) install 不再用 addAll（原子失败=一个文件挂全部丢弃，空 catch 吞掉后可能「零缓存上线」），
      改逐文件 allSettled 容错，失败清单 console + postMessage 上报；
   2) 预缓存请求带 cache:'reload' 绕过 HTTP 缓存，CORE_V 版本戳（sync 时注入构建号）双保险，
      避开 Cloudflare Pages 默认 4h 资产缓存把旧 bundle 写进新版本缓存；
   3) activate 只在新缓存基本建满（≥ CORE-3）时才删旧缓存——预缓存大面积失败时
      保留旧版本兜底，绝不把用户从「有缓存」变成「零缓存」。 */
const CACHE = 'yrb-cache-v4';
const CORE_V = ''; /* sync 时替换为构建号；源码线留空=不带版本戳 */
const CORE = [
  '/', '/share.html',
  '/assets/bundle.css', '/assets/bundle.js',
  '/assets/app.css', '/assets/app.js',
  '/assets/refine23.css', '/assets/refine23.js',
  '/assets/access.css', '/assets/access.js',
  '/assets/capture.css', '/assets/capture.js',
  '/assets/cloud.css', '/assets/cloud.js',
  '/assets/reward.css', '/assets/reward.js',
  '/assets/jiaojiao.css', '/assets/jiaojiao.js',
  '/assets/pptview.css', '/assets/pptview.js',
  '/assets/admin.css', '/assets/admin.js',
  '/assets/adminguard.css', '/assets/adminguard.js',
  '/assets/gate.css', '/assets/gate.js',
  '/assets/license.css', '/assets/license.js',
  '/assets/profile.css', '/assets/profile.js',
  '/assets/food.css', '/assets/food.js',
  '/assets/rose.css', '/assets/rose.js',
  '/assets/protect.css', '/assets/protect.js',
  '/assets/mediafull.css', '/assets/mediafull.js', '/assets/cover.js',
  '/assets/casedit.css', '/assets/casedit.js',
  '/assets/longimg.css', '/assets/longimg.js',
  '/assets/state.schema.js', '/assets/state.js',
  '/assets/chips.js', '/assets/account.js', '/assets/health.js', '/assets/upgrade.js',
  '/assets/guard.js', '/assets/vendor/cloud-sdk.global.js',
  '/assets/icon-192.png', '/assets/icon-512.png'
];

/* 2026-10-23：不再 install 后立刻 skipWaiting 抢班。
   新版 SW 先进入 waiting，由页面上的「平稳升级」提示征得用户同意后
   再 postMessage 放行——避免用户正在填表/看案例时被强制换版导致错层。 */
/* 预缓存：install 与「清空缓存后重新预热」共用（消息 PREFETCH 触发）。
   逐文件容错：单个文件失败不拖垮整批（旧写法 addAll 是原子的，一次失败等于零缓存）。 */
async function precacheAll() {
  const cache = await caches.open(CACHE);
  const urls = CORE.map(u => u + (CORE_V ? (u.includes('?') ? '&' : '?') + 'v=' + CORE_V : ''));
  const res = await Promise.allSettled(urls.map(async u => {
    const r = await fetch(u, { cache: 'reload' });
    if (!r || !r.ok) throw new Error(u + ' → ' + (r ? r.status : '无响应'));
    await cache.put(u, r);
  }));
  const fails = res.map((x, i) => x.status === 'rejected' ? urls[i] : null).filter(Boolean);
  if (fails.length) {
    console.warn('[yrb-sw] 预缓存失败 ' + fails.length + '/' + urls.length + '：', fails);
    try {
      const cs = await self.clients.matchAll({ includeUncontrolled: true });
      cs.forEach(c => c.postMessage({ type: 'YRB_SW_PRECACHE_FAIL', urls: fails }));
    } catch (_) { /* 无页面在场就只留 console */ }
  }
  return { total: urls.length, fails: fails.length };
}

self.addEventListener('install', e => {
  e.waitUntil(precacheAll());
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') { self.skipWaiting(); }
  /* 用户在本页「清理缓存」后请求重新预热：否则清完第一次打开要全量走网络 */
  if (e.data && e.data.type === 'PREFETCH') { e.waitUntil(precacheAll()); }
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const have = (await (await caches.open(CACHE)).keys()).length;
    if (have >= CORE.length - 3) {
      await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    } else {
      /* 预缓存大面积失败：保留旧版本缓存兜底，零缓存比旧缓存更危险 */
      console.warn('[yrb-sw] 新缓存仅 ' + have + '/' + CORE.length + '，保留旧缓存兜底');
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  /* 云服务 / CDN 请求绝不缓存（登录、上传、数据库） */
  if (url.origin !== location.origin) return;

  const isNav = req.mode === 'navigate' ||
                (req.headers.get('accept') || '').indexOf('text/html') >= 0;

  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && (url.pathname.startsWith('/assets/') || url.pathname.endsWith('.html') || url.pathname === '/')) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() =>
      /* 离线兜底：页面导航才回落 HTML；脚本/样式等资源绝不拿 HTML 顶包 */
      caches.match(req).then(hit => {
        if (hit) return hit;
        if (isNav) return caches.match('/') || caches.match('/share.html');
        return new Response('', { status: 504, statusText: 'Offline' });
      })
    )
  );
});
