# -*- coding: utf-8 -*-
import io
p = 'cloud.js'
s = io.open(p, encoding='utf-8').read()
reps = [
    ("const r=await cloud.auth.getSession();",
     'const r=await withTimeout(cloud.auth.getSession(),12000,"读取登录状态");'),
    ("const sent=await cloud.auth.sendOtp({phone});",
     'const sent=await withTimeout(cloud.auth.sendOtp({phone}),20000,"发送验证码");'),
    ('const r=await cloud.auth.signInWithOAuth({provider:"wechat",redirectTo:location.origin});',
     'const r=await withTimeout(cloud.auth.signInWithOAuth({provider:"wechat",redirectTo:location.origin}),20000,"发起微信登录");'),
    ("const r=await cloud.auth.handleWechatWebCallback();",
     'const r=await withTimeout(cloud.auth.handleWechatWebCallback(),15000,"处理微信回调");'),
    ("""    const done=await cloud.auth.verifyOtp({
      phone:pendingOtp.phone,verificationId:pendingOtp.verificationId,
      isExistingUser:pendingOtp.isExistingUser,token:code
    });""",
     """    const done=await withTimeout(cloud.auth.verifyOtp({
      phone:pendingOtp.phone,verificationId:pendingOtp.verificationId,
      isExistingUser:pendingOtp.isExistingUser,token:code
    }),20000,"登录校验");"""),
]
for a, b in reps:
    if a in s:
        s = s.replace(a, b)
        print('OK   ->', a[:52].replace('\n', ' '))
    else:
        print('MISS ->', a[:52].replace('\n', ' '))
io.open(p, 'w', encoding='utf-8').write(s)
