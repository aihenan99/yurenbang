const q = encodeURIComponent('site:xn--gmqq09al6z.cn');
(async () => {
  for (const [name, base] of [['必应', 'https://cn.bing.com/search?q='], ['谷歌', 'https://www.google.com/search?q=']]) {
    try {
      const r = await fetch(base + q, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', 'Accept-Language': 'zh-CN,zh;q=0.9' },
        signal: AbortSignal.timeout(25000)
      });
      const t = await r.text();
      const hits = new Set();
      for (const m of t.matchAll(/href="(https:\/\/xn--gmqq09al6z\.cn[^"]*)"/g)) hits.add(m[1]);
      const noRes = /没有与此相关的结果|There are no results|找不到和您查询/.test(t);
      console.log(name, r.status, 'len', t.length, '| 本站结果链接', hits.size, '| 明确无结果', noRes);
      [...hits].slice(0, 4).forEach((h) => console.log('   ', h));
    } catch (e) { console.log(name, 'ERR', e.message); }
  }
})();
