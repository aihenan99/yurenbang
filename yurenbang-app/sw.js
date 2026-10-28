/* 育人帮 Service Worker —— 网络优先 + 离线兜底缓存
   策略说明：
   - HTML/JS/CSS 等静态资源：先取网络最新版，成功后更新缓存；断网时回退缓存
   - 2026-10-23 重要修复：核心清单补全全部功能层文件；且**只对页面导航**
     回落到首页 HTML，脚本/样式缓存未命中时绝不返回 HTML（MIME 不符会被
     浏览器拒绝执行，导致家教/答谢/语音等整层功能静默消失）
   - 缓存名升级 v3，激活时自动清掉旧版本
   - 2026-10-23b：部署包主页文件名是 index.html（源码为 yurenbang-app.html），
     清单与离线兜底统一改用 '/'，避免指向不存在的文件（曾致 PWA 安装失败 / 离线打不开） */
const CACHE = 'yrb-cache-v4';
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
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE).catch(() => {})));
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') { self.skipWaiting(); }
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
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
