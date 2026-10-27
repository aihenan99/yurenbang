# -*- coding: utf-8 -*-
import urllib.request, urllib.error

base = 'http://127.0.0.1:8790'
tests = ['/', '/yurenbang-app', '/yurenbang-app/', '/yurenbang-app/index.html',
         '/whatever/deep/path', '/yurenbang-app.html', '/assets/capture.js', '/assets/missing.js']
for t in tests:
    try:
        r = urllib.request.urlopen(base + t, timeout=8)
        b = r.read()
        ct = r.headers.get('Content-Type', '').split(';')[0]
        is_app = ('yurenbang-app.html' in b.decode('utf-8', 'ignore')) or ('育人帮' in b.decode('utf-8', 'ignore'))
        print('200', t, '|', ct, '|', len(b), 'bytes | app-page:', is_app)
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, t)
    except Exception as e:
        print('FAIL', t, type(e).__name__, str(e)[:60])
