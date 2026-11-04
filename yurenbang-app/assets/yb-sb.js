/* =========================================================
   育人帮 · Supabase 轻客户端（2026-11-01）
   ---------------------------------------------------------
   为什么自写而不用 vendor/cloud-sdk.global.js：
     原 SDK 是平台云的封装（手机验证码、WorkBuddy 网关路径），与 Supabase
     的 GoTrue/PostgREST 只是"同形不同路"。自写一层约 300 行，接口面与
     cloud.js 现有调用完全对齐（client.database.from/rpc、client.auth.*、
     client.storage.*），云端换实现时上层零改动。

   对外：window.YRB_SB.createClient({ base, key, emailDomain })
     base        同源代理前缀，默认 "/sbapi"
     key         Supabase publishable key（公开密钥，可内置于前端）
     emailDomain 用户名映射的伪邮箱后缀，默认 "usr.yurenbang.cn"

   设计要点：
     · 会话存 localStorage，自动刷新（提前 60s）
     · insert 时若表带 owner_id 且未提供，自动补当前 uid（配合 RLS 的
       owner_id = auth.uid() 检查）
     · 所有查询返回 {data,error}，不抛异常（cloud.js 全靠判 error）
     · 存储桶固定 media，路径 shared/<uid>/...
   ========================================================= */
(function (root) {
  "use strict";

  var SES_KEY = "yrb_sb_session_v1";
  var OWNER_TABLES = { yb_posts: 1, yb_comments: 1, yb_cases: 1 };

  /* rpc 位置参数 → 具名参数（Supabase RPC 只接受对象） */
  var ARG_MAP = {
    yb_post_solve: ["pid"],
    admin_set_setting: ["p_key", "p_value"],
    admin_set_password: ["p_new", "p_old"],
    admin_verify_password: ["p_password"],
    admin_guard_status: []
  };

  function enc(v) {
    return encodeURIComponent(String(v));
  }

  function mkErr(status, body, fallback) {
    var msg = (body && (body.message || body.msg || body.error_description || body.error)) || fallback || ("HTTP " + status);
    if (typeof msg !== "string") msg = JSON.stringify(msg);
    return {
      message: msg,
      code: (body && (body.code || body.error_code)) || status,
      status: status,
      details: (body && body.details) || null,
      hint: (body && body.hint) || null
    };
  }

  function createClient(opt) {
    opt = opt || {};
    var base = String(opt.base || "/sbapi").replace(/\/+$/, "");
    var key = opt.key || "";
    var domain = opt.emailDomain || "usr.yurenbang.cn";
    /* 会话键可自定义：同一页面并存多个客户端（如测试里的匿名/登录对比）时互不串会话 */
    var SESKEY = opt.storageKey || SES_KEY;

    /* 用户名 → GoTrue 邮箱：中文名不是合法邮箱，用 UTF-8 十六进制编码成
       u<hex>@<domain>，确定性且 ASCII 安全（"小明" → u5c0f660e@usr.yurenbang.cn）。
       同一用户名永远得到同一邮箱，注册/登录天然对齐；展示名仍是原文，存 yb_profiles。 */
    function emailFor(name) {
      var s = String(name || "").trim().toLowerCase();
      if (s.indexOf("@") > 0) return s;
      var hex = "";
      try {
        var bytes = new TextEncoder().encode(s);
        for (var i = 0; i < bytes.length; i++) hex += ("0" + bytes[i].toString(16)).slice(-2);
      } catch (e) {
        for (var j = 0; j < s.length; j++) hex += ("0000" + s.charCodeAt(j).toString(16)).slice(-4);
      }
      return "u" + hex + "@" + domain;
    }

    /* 绝对地址：签名 URL 必须能直接被 <img src> 使用 */
    function abs(p) {
      if (/^https?:/i.test(base)) return base + p;
      var o = (root.location && root.location.origin) || "";
      return o + base + p;
    }

    /* ---------------- 会话 ---------------- */
    var session = null;
    var authCbs = [];

    function readStored() {
      try {
        var raw = root.localStorage && localStorage.getItem(SESKEY);
        if (!raw) return null;
        var s = JSON.parse(raw);
        return s && s.access_token ? s : null;
      } catch (e) { return null; }
    }
    function writeStored(s) {
      session = s;
      try {
        if (s) localStorage.setItem(SESKEY, JSON.stringify(s));
        else localStorage.removeItem(SESKEY);
      } catch (e) {}
    }
    function toSession(tok) {
      /* GoTrue 返回 {access_token, refresh_token, expires_in, user} */
      var u = tok.user || {};
      return {
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        expires_at: Date.now() + (Number(tok.expires_in || 3600) * 1000),
        token_type: tok.token_type || "bearer",
        user: {
          id: u.id,
          email: u.email,
          name: (u.user_metadata && (u.user_metadata.nick || u.user_metadata.name)) || "",
          raw: u
        }
      };
    }
    function emit(ev) {
      authCbs.slice().forEach(function (cb) {
        try { cb(ev, session); } catch (e) {}
      });
    }

    function req(path, o) {
      o = o || {};
      var h = { apikey: key };
      if (o.token || (session && session.access_token)) h["Authorization"] = "Bearer " + (o.token || session.access_token);
      if (o.body !== undefined && !(root.FormData && o.body instanceof FormData)) h["Content-Type"] = "application/json";
      if (o.headers) for (var k in o.headers) h[k] = o.headers[k];
      var init = { method: o.method || "GET", headers: h };
      if (o.body !== undefined) init.body = (root.FormData && o.body instanceof FormData) ? o.body : JSON.stringify(o.body);
      return fetch(abs(path), init).then(function (r) {
        return r.text().then(function (t) {
          var j = null;
          try { j = t ? JSON.parse(t) : null; } catch (e) { j = t; }
          return { ok: r.ok, status: r.status, body: j, headers: r.headers };
        });
      });
    }

    function refreshIfNeeded() {
      session = session || readStored();
      if (!session) return Promise.resolve(null);
      if (session.expires_at && session.expires_at - Date.now() > 60000) return Promise.resolve(session);
      if (!session.refresh_token) return Promise.resolve(session);
      return req("/auth/v1/token?grant_type=refresh_token", {
        method: "POST", body: { refresh_token: session.refresh_token }, token: key
      }).then(function (r) {
        if (r.ok && r.body && r.body.access_token) {
          writeStored(toSession(r.body));
          return session;
        }
        writeStored(null);
        return null;
      }).catch(function () { return session; });
    }

    /* ---------------- auth ---------------- */
    var auth = {
      getSession: function () {
        return refreshIfNeeded().then(function (s) {
          return { data: s, error: null };
        });
      },
      getAccessToken: function () { return session && session.access_token; },
      signInWithPassword: function (cred) {
        cred = cred || {};
        var email = emailFor(cred.username || cred.email || cred.phone || "");
        if (!email || !cred.password) {
          return Promise.resolve({ data: null, error: { message: "请输入用户名和密码", code: "empty" } });
        }
        return req("/auth/v1/token?grant_type=password", {
          method: "POST", token: key, body: { email: email, password: cred.password }
        }).then(function (r) {
          if (!r.ok || !r.body || !r.body.access_token) {
            return { data: null, error: mkErr(r.status, r.body, "登录失败") };
          }
          writeStored(toSession(r.body));
          emit("SIGNED_IN");
          return { data: session, error: null };
        }).catch(function (e) {
          return { data: null, error: { message: "网络不通，请稍后重试", code: "network", cause: e } };
        });
      },
      signUp: function (cred) {
        cred = cred || {};
        var email = emailFor(cred.username || cred.email || "");
        return req("/auth/v1/signup", {
          method: "POST", token: key,
          body: {
            email: email, password: cred.password,
            data: { nick: cred.nick || "" }
          }
        }).then(function (r) {
          if (!r.ok) return { data: null, error: mkErr(r.status, r.body, "注册失败") };
          var b = r.body || {};
          /* 关掉邮箱确认时 signup 直接返回会话；否则只有 user，需要再登录 */
          if (b.access_token) {
            writeStored(toSession(b));
            emit("SIGNED_IN");
            return { data: session, error: null };
          }
          return { data: null, error: null, needConfirm: !!(b.email || b.confirmation_sent_at) };
        }).catch(function (e) {
          return { data: null, error: { message: "网络不通，请稍后重试", code: "network", cause: e } };
        });
      },
      signOut: function () {
        var t = session && session.access_token;
        writeStored(null);
        emit("SIGNED_OUT");
        if (!t) return Promise.resolve({ error: null });
        return req("/auth/v1/logout", { method: "POST", token: t }).then(function () {
          return { error: null };
        }).catch(function () { return { error: null }; });
      },
      /* 修改自己的登录密码（必须先登录）：GoTrue 的 PUT /user 只需新密码，
         但上层会先用「当前密码」重登一次做校验，避免会话被别人捡到就能改密。 */
      updatePassword: function (pwd) {
        if (!session || !session.access_token) {
          return Promise.resolve({ data: null, error: { message: "请先登录", code: "no_session" } });
        }
        if (!pwd || String(pwd).length < 6) {
          return Promise.resolve({ data: null, error: { message: "密码至少要 6 位", code: "weak" } });
        }
        return req("/auth/v1/user", { method: "PUT", body: { password: String(pwd) } }).then(function (r) {
          if (!r.ok) return { data: null, error: mkErr(r.status, r.body, "修改密码失败") };
          return { data: r.body, error: null };
        }).catch(function (e) {
          return { data: null, error: { message: "网络不通，请稍后重试", code: "network", cause: e } };
        });
      },
      onAuthStateChange: function (cb) {
        authCbs.push(cb);
        refreshIfNeeded().then(function (s) { try { cb(s ? "SIGNED_IN" : "INITIAL", s); } catch (e) {} });
        return { data: { subscription: { unsubscribe: function () { authCbs = authCbs.filter(function (x) { return x !== cb; }); } } } };
      },
      handleWechatWebCallback: function () { return Promise.resolve(null); },
      sendOtp: function () { return Promise.resolve({ error: { message: "本版本已改用用户名密码登录", code: "unsupported" } }); },
      verifyOtp: function () { return Promise.resolve({ error: { message: "本版本已改用用户名密码登录", code: "unsupported" } }); },
      user: function () { return session && session.user; }
    };

    /* ---------------- database：查询构造器 ---------------- */
    function from(table) {
      var st = {
        table: table, cols: "*", method: "GET", filters: [], orders: [],
        lim: null, body: null, single: null, upsert: false, returning: null
      };

      function addFilter(expr) { st.filters.push(expr); }

      function buildUrl() {
        var qs = [];
        if (st.cols && st.method === "GET") qs.push("select=" + enc(st.cols));
        st.filters.forEach(function (f) { qs.push(f); });
        st.orders.forEach(function (o) { qs.push("order=" + o); });
        if (st.lim != null) qs.push("limit=" + st.lim);
        return "/rest/v1/" + enc(st.table) + (qs.length ? "?" + qs.join("&") : "");
      }

      function exec() {
        return refreshIfNeeded().then(function () {
          var headers = {};
          if (st.prefer) headers["Prefer"] = st.prefer;
          else if (st.method !== "GET") headers["Prefer"] = "return=representation";
          var body;
          if (st.method === "POST" || st.method === "PATCH") {
            body = st.body;
            if (st.method === "POST" && Array.isArray(body)) {
              body = body.map(function (r) { return withOwner(r); });
            } else if (st.method === "POST") {
              body = withOwner(body);
            }
          }
          return req(buildUrl(), { method: st.method, headers: headers, body: body }).then(function (r) {
            if (!r.ok) return { data: null, error: mkErr(r.status, r.body) };
            var d = r.body;
            if (st.single === "maybe") d = Array.isArray(d) ? (d[0] || null) : (d || null);
            else if (st.single === "one") {
              if (Array.isArray(d) && d.length === 1) d = d[0];
              else if (!Array.isArray(d) && d) d = d;
              else return { data: null, error: { message: "未找到记录", code: "PGRST116", status: 406 } };
            }
            return { data: d, error: null };
          });
        }).catch(function (e) {
          return { data: null, error: { message: "网络不通，请稍后重试", code: "network", cause: e } };
        });
      }

      function withOwner(row) {
        if (!row || typeof row !== "object") return row;
        if (!OWNER_TABLES[st.table]) return row;
        if (row.owner_id) return row;
        var uid = session && session.user && session.user.id;
        if (uid) {
          var copy = {};
          for (var k in row) copy[k] = row[k];
          copy.owner_id = uid;
          return copy;
        }
        return row;
      }

      var api = {
        select: function (cols) { st.cols = cols || "*"; return api; },
        insert: function (row) { st.method = "POST"; st.body = row; return api; },
        update: function (obj) { st.method = "PATCH"; st.body = obj; return api; },
        delete: function () { st.method = "DELETE"; return api; },
        upsert: function (row) { st.method = "POST"; st.body = row; st.prefer = "resolution=merge-duplicates,return=representation"; return api; },
        eq: function (c, v) { addFilter(enc(c) + "=eq." + enc(v)); return api; },
        neq: function (c, v) { addFilter(enc(c) + "=neq." + enc(v)); return api; },
        is: function (c, v) { addFilter(enc(c) + "=is." + enc(v)); return api; },
        in: function (c, arr) {
          addFilter(enc(c) + "=in.(" + (arr || []).map(enc).join(",") + ")");
          return api;
        },
        or: function (expr) { addFilter("or=(" + expr + ")"); return api; },
        order: function (c, o) {
          var asc = !(o && o.ascending === false);
          st.orders.push(enc(c) + "." + (asc ? "asc" : "desc"));
          return api;
        },
        limit: function (n) { st.lim = n; return api; },
        maybeSingle: function () { st.single = "maybe"; return api; },
        single: function () { st.single = "one"; return api; },
        then: function (ok, fail) { return exec().then(ok, fail); },
        catch: function (fail) { return exec().catch(fail); }
      };
      return api;
    }

    function rpc(fn, args) {
      var body = args;
      if (Array.isArray(args)) {
        var names = ARG_MAP[fn] || [];
        body = {};
        names.forEach(function (n, i) { body[n] = args[i]; });
      } else if (args == null) {
        body = {};
      }
      return refreshIfNeeded().then(function () {
        return req("/rest/v1/rpc/" + enc(fn), { method: "POST", body: body }).then(function (r) {
          if (!r.ok) return { data: null, error: mkErr(r.status, r.body) };
          return { data: r.body, error: null };
        });
      }).catch(function (e) {
        return { data: null, error: { message: "网络不通，请稍后重试", code: "network", cause: e } };
      });
    }

    /* ---------------- storage ---------------- */
    var BUCKET = "media";

    var storage = {
      sharedPath: function (uid, rel) {
        return "shared/" + String(uid) + "/" + String(rel).replace(/^\/+/, "");
      },
      userPath: function (uid, rel) { return storage.sharedPath(uid, rel); },
      upload: function (path, blob, o) {
        o = o || {};
        var headers = { "content-type": o.contentType || (blob && blob.type) || "application/octet-stream" };
        if (o.upsert) headers["x-upsert"] = "true";
        return refreshIfNeeded().then(function () {
          return fetch(abs("/storage/v1/object/" + BUCKET + "/" + path), {
            method: "POST", headers: Object.assign({ apikey: key, Authorization: "Bearer " + ((session && session.access_token) || key) }, headers), body: blob
          }).then(function (r) {
            return r.text().then(function (t) {
              var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
              if (!r.ok) return { data: null, error: mkErr(r.status, j, "上传失败") };
              return { data: { path: path, fullPath: BUCKET + "/" + path }, error: null };
            });
          });
        }).catch(function (e) {
          return { data: null, error: { message: "上传失败，请检查网络", code: "network", cause: e } };
        });
      },
      createSignedUrl: function (path, ttl) {
        return refreshIfNeeded().then(function () {
          return req("/storage/v1/object/sign/" + BUCKET + "/" + path, {
            method: "POST", body: { expiresIn: ttl || 3600 }
          }).then(function (r) {
            if (!r.ok || !r.body || !r.body.signedURL) return { data: null, error: mkErr(r.status, r.body, "获取地址失败") };
            return { data: { signedUrl: abs("/storage/v1" + r.body.signedURL), path: path }, error: null };
          });
        }).catch(function (e) {
          return { data: null, error: { message: "获取地址失败", code: "network", cause: e } };
        });
      },
      createSignedUrls: function (paths, ttl) {
        paths = paths || [];
        if (!paths.length) return Promise.resolve({ data: [], error: null });
        return refreshIfNeeded().then(function () {
          return req("/storage/v1/object/sign/" + BUCKET, {
            method: "POST", body: { expiresIn: ttl || 3600, paths: paths }
          }).then(function (r) {
            if (!r.ok || !Array.isArray(r.body)) return { data: [], error: mkErr(r.status, r.body, "获取地址失败") };
            var out = r.body.map(function (x) {
              return {
                path: x.path,
                signedUrl: x.signedURL ? abs("/storage/v1" + x.signedURL) : null,
                error: x.error || null
              };
            });
            return { data: out, error: null };
          });
        }).catch(function () {
          return { data: [], error: { message: "获取地址失败", code: "network" } };
        });
      },
      remove: function (paths) {
        paths = paths || [];
        if (!paths.length) return Promise.resolve({ data: null, error: null });
        return refreshIfNeeded().then(function () {
          return req("/storage/v1/object/" + BUCKET, { method: "DELETE", body: { prefixes: paths } }).then(function (r) {
            if (!r.ok) return { data: null, error: mkErr(r.status, r.body, "删除失败") };
            return { data: r.body, error: null };
          });
        }).catch(function () {
          return { data: null, error: { message: "删除失败", code: "network" } };
        });
      },
      from: function () { return storage; }
    };

    var database = { from: from, rpc: rpc };

    return {
      endpoint: base,
      emailDomain: domain,
      database: database,
      auth: auth,
      storage: storage,
      session: function () { return session; }
    };
  }

  var api = { createClient: createClient };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.YRB_SB = api;
})(typeof window !== "undefined" ? window : globalThis);
