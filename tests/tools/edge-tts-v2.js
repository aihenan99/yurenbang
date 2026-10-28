/* edge-tts-v2.js — Edge TTS Sec-MS-GEC v2 令牌的 JS 移植（rany2/edge-tts drm.py 对应）
   供本地探测验证，验证通过后同代码进 _worker.js。 */
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const tls = require("tls");
const { WebSocket } = require("C:/Users/a/.workbuddy/binaries/node/workspace/node_modules/ws");

const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WIN_EPOCH = 11644473600;
const WSS = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=" + TOKEN;
const GEC_VERSION = "2-143.0.3650.75";
const ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";

const M = 0xFFFFFFFF;
const u32 = x => x >>> 0;
const rol16 = v => u32((u32(v) << 16) | (u32(v) >>> 16));
const rotr = (v, n) => u32((u32(v) >>> n) | (u32(v) << (32 - n)));

const SHA256_INITIAL = [0x6A09E667,0xBB67AE85,0x3C6EF372,0xA54FF53A,0x510E527F,0x9B05688C,0x1F83D9AB,0x5BE0CD19];
const SHA256_STATE   = [0xFD9FBEA2,0x91243CE7,0xBE499094,0xCD2E1E0A,0x6C006F49,0x04BD35AB,0xFEB0A7E4,0x03EFFBD2];
const SCHEDULE14 = [0xEB24BF9E,0x1558691F,0xA0C09EE2,0x0CFA32BA,0xA622EE8C,0xD1DD9491,0xC0DD25A0,0xF9E70AB6,0xF0C31573,0x7058CE4E,0x7188E606,0x00E5AB33,0xD258B060,0x72766564];
const RC = [0x428A2F98,0x71374491,0xB5C0FBCF,0xE9B5DBA5,0x3956C25B,0x59F111F1,0x923F82A4,0xAB1C5ED5,0xD807AA98,0x12835B01,0x243185BE,0x550C7DC3,0x72BE5D74,0x80DEB1FE,0x9BDC06A7,0xC19BF174,0xE49B69C1,0xEFBE4786,0x0FC19DC6,0x240CA1CC,0x2DE92C6F,0x4A7484AA,0x5CB0A9DC,0x76F988DA,0x983E5152,0xA831C66D,0xB00327C8,0xBF597FC7,0xC6E00BF3,0xD5A79147,0x06CA6351,0x14292967,0x27B70A85,0x2E1B2138,0x4D2C6DFC,0x53380D13,0x650A7354,0x766A0ABB,0x81C2C92E,0x92722C85,0xA2BFE8A1,0xA81A664B,0xC24B8B70,0xC76C51A3,0xD192E819,0xD6990624,0xF40E3585,0x106AA070,0x19A4C116,0x1E376C08,0x2748774C,0x34B0BCB5,0x391C0CB3,0x4ED8AA4A,0x5B9CCA4F,0x682E6FF3,0x748F82EE,0x78A5636F,0x84C87814,0x8CC70208,0x90BEFFFA,0xA4506CEB,0xBEF9A3F7,0xC67178F2];
const RC_BLOCK = RC.slice(0,14).concat([0xC9DC06A7], RC.slice(15));
const SIGMA0_ADJ = 0x059C0B80, SIGMA1_ADJ = 0x000B92C0, ADJ14 = 0xC9DC06A7;
const COEFFS = [[0xE82E91B1,0xB32700D0],[0x44DE24C6,0x88DFF51D],[0x3BEB65BC,0x29514038],[0xC89C5933,0xB328CBDF],[0x8D1EC211,0xD405B4D5],[0x314EF5D5,0x26E55F3C],[0xE92491B1,0x607801C6],[0xF0A5B9D5,0x82B2C1FB],[0x06064CF3,0xFA51A3DA],[0xDA79FA60,0x207CC464],[0xBED20560,0x3C3C74F3],[0x89F9C9F8,0xD2D14B61],[0x35FA38C6,0xBB04A2C1],[0xCB49E3C6,0xC5626167]];
const CS64_FACTOR = 0x82893933, CS64_ADJ0 = 0xF2F90B1A, CS64_ADJ1 = 0x0B1A0000;

function sigma0(v){ return u32((u32(v)>>>7 ^ u32(v)<<25 ^ u32(v)>>>18 ^ u32(v)<<14 ^ u32(v)>>>3)); }
function sigma1(v){ return u32((u32(v)>>>17 ^ u32(v)<<15 ^ u32(v)>>>19 ^ u32(v)<<13 ^ u32(v)>>>10)); }

function expand(words, first){
  for(let i=first;i<64;i++){
    const x=words[i-2], y=words[i-15];
    words[i]=u32(sigma1(x)+words[i-7]+sigma0(y)+words[i-16]);
  }
}
function rounds(state, words, K, start){
  let [a,b,c,d,e,f,g,h]=state;
  for(let i=start||0;i<64;i++){
    const S1=rotr(e,6)^rotr(e,11)^rotr(e,25);
    const t1=u32(u32(h+S1+ (g ^ (e & (f ^ g))) + K[i]) + words[i]);
    const S0=rotr(a,2)^rotr(a,13)^rotr(a,22);
    const t2=u32(S0 + ((a & b) | (c & (a | b))));
    h=g;g=f;f=e;e=u32(d+t1);d=c;c=b;b=a;a=u32(t1+t2);
  }
  return [a,b,c,d,e,f,g,h];
}

function sha256Init(salt){                       /* salt = data[0:7] */
  const words=[0,0,0,0,0,0,0,0,0,0,0,0,0,0];
  words.push((salt[0]<<16)|(salt[1]<<8)|salt[2]);
  words.push((salt[3]<<24)|(salt[4]<<16)|(salt[5]<<8)|salt[6]);
  for(let index=16;index<30;index++){
    let value=SCHEDULE14[index-16];
    if(index-2>=14) value=u32(value+ (index===16 ? (sigma1(words[14]) ^ SIGMA1_ADJ) : sigma1(words[index-2])));
    if(index-7>=14) value=u32(value+words[index-7]);
    if(index-15>=14) value=u32(value+ (index===29 ? (sigma0(words[index-15]) ^ SIGMA0_ADJ) : sigma0(words[index-15])));
    words.push(u32(value));
  }
  words.push(u32(sigma1(words[28])+words[23]+sigma0(words[15])+words[14]+u32(ADJ14-RC[14])));
  expand(words,31);
  /* 关键：init 的轮函数从第 14 轮恢复（words[0..13] 被预置状态吸收），不是满 64 轮 */
  const w=rounds(SHA256_STATE,words,RC_BLOCK,14);
  return SHA256_INITIAL.map((x,i)=>u32(x+w[i]));
}

function sha256DigestCustom(data){
  if(data.length<7)throw new Error("salt<7");
  const length=57+data.length;
  const z=((55-length)%64+64)%64;
  const padded=Buffer.concat([data.slice(7),Buffer.from([0x80]),Buffer.alloc(z), (()=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(length*8));return b;})()]);
  let state=sha256Init(data.slice(0,7));
  for(let off=0;off<padded.length;off+=64){
    const words=[];
    for(let i=0;i<16;i++)words.push(padded.readUInt32BE(off+i*4));
    expand(words,16);
    const w=rounds(state,words,RC);
    state=state.map((x,i)=>u32(x+w[i]));
  }
  return Buffer.from(state.flatMap(x=>[x>>>24&255,x>>>16&255,x>>>8&255,x&255]));
}

function leWordsPadded(bytes){                   /* _words_le4_even(b"\0"+data) */
  const d=Buffer.concat([Buffer.from([0]),bytes]);
  const pad=(4-(d.length%4))%4;                 /* Python (-len)%4 的等价（恒为正） */
  const full=Buffer.concat([d,Buffer.alloc(pad)]);
  const words=[];
  for(let i=0;i<full.length;i+=4)words.push(full.readUInt32LE(i));
  if(words.length%2)words.push(0);
  return words;
}

function cs64Digest(data, digest){
  const keyA=u32(digest.readUInt32LE(0)|1), keyB=u32(digest.readUInt32LE(4)|1);
  const fA=u32(Math.imul(keyA,CS64_FACTOR)), fB=u32(Math.imul(keyB,CS64_FACTOR));
  const factors=[fA,fB];
  const terms=COEFFS.map((c,i)=>u32(Math.imul(c[0],factors[i%2])));
  let offsets=COEFFS.map(c=>c[1]);
  const words=leWordsPadded(data);
  words.forEach((word,index)=>{
    let term=u32(Math.imul(word, index%2===0?keyA:keyB));
    let offset=u32(Math.imul(rol16(word), index%2===0?0xEF0569FB:0xC31713DB));
    if(index===0){ term=u32(term+u32(Math.imul(CS64_ADJ0,fA))); offset=u32(offset+CS64_ADJ1); }
    terms.push(term); offsets.push(offset);
  });
  let swapAcc=0,swapLast=0,state=0,acc=0;
  for(let index=0;index<terms.length;index+=2){
    const x=terms[index], y=terms[index+1];
    let t=rol16(u32(offsets[index]+x));
    let q=u32(Math.imul(t,0x76F50F34));
    swapAcc=u32(swapAcc+u32(Math.imul(rol16(q),0xC3EFEA97)+q));
    t=rol16(u32(offsets[index+1]+y));
    q=u32(Math.imul(t,0x1881CE3C));
    swapLast=u32(Math.imul(rol16(q),0x35BD1EC9)+q);
    swapAcc=u32(swapAcc+swapLast);
    state=u32(Math.imul(state,keyA)+x);
    state=u32(Math.imul(rol16(state),0xCF98B111));
    state=u32(Math.imul(rol16(state),0x87085B9F));
    state=u32(Math.imul(rol16(state),0x12CEB96D));
    state=u32(Math.imul(rol16(state),0x257E1D83));
    acc=u32(acc+state);
    t=u32(Math.imul(state,keyB)+y);
    t=u32(Math.imul(rol16(t),0xA27416F5));
    t=u32(Math.imul(rol16(t),0xD38396FF));
    state=u32(Math.imul(rol16(u32(Math.imul(rol16(t),0x7C932B89))),0xBFA49F69));
    acc=u32(acc+state);
  }
  return [u32(swapLast^state), u32(swapAcc^acc)];
}

/* Sec-MS-GEC v2："<cs64hex>-<sha256hex>" */
function generateSecMsGec(nowSec){
  let t=Math.floor(nowSec||Date.now()/1000)+WIN_EPOCH;
  t-=t%300;
  const dbl=t*1e7;                                /* 与 Python float 乘法同精度 */
  const str=BigInt(dbl).toString()+TOKEN;         /* 双精度整数值的精确十进制 */
  const data=Buffer.from(str,"ascii");
  const digest=sha256DigestCustom(data);
  const [w1,w2]=cs64Digest(data,digest);
  const b=Buffer.alloc(8);b.writeUInt32LE(w1,0);b.writeUInt32LE(w2,4);
  return b.toString("hex").toUpperCase()+"-"+digest.toString("hex").toUpperCase();
}

/* ---------- 经本地代理 CONNECT 隧道的 wss 合成（本地验证用） ---------- */
class TunnelAgent extends https.Agent {
  createConnection(opts,cb){
    const req=http.request({host:"127.0.0.1",port:54257,method:"CONNECT",path:opts.host+":"+opts.port,headers:{Host:opts.host+":"+opts.port}});
    req.on("connect",(res,sock)=>{ if(res.statusCode!==200)return cb(new Error("CONNECT "+res.statusCode)); cb(null,tls.connect({socket:sock,servername:opts.host})); });
    req.on("error",cb); req.end();
  }
}
function synth(text,voice,rate){
  return new Promise((resolve,reject)=>{
    const gec=generateSecMsGec();
    const ws=new WebSocket(WSS+"&Sec-MS-GEC="+gec+"&Sec-MS-GEC-Version="+GEC_VERSION,{
      agent:new TunnelAgent(),
      headers:{ "Origin":ORIGIN,"User-Agent":UA,"Accept-Encoding":"gzip, deflate","Accept-Language":"en-US,en;q=0.9","Cache-Control":"no-cache","Pragma":"no-cache" },
    });
    const t0=Date.now(); let audio=[];
    const to=setTimeout(()=>{try{ws.terminate();}catch(e){}reject(new Error("timeout 15s"));},15000);
    ws.on("open",()=>{
      ws.send("X-Timestamp:"+new Date().toString()+"\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n"+
        JSON.stringify({context:{synthesis:{audio:{metadataoptions:{sentenceBoundaryEnabled:"false",wordBoundaryEnabled:"false"},outputFormat:"audio-24khz-48kbitrate-mono-mp3"}}}}));
      const ssml="<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='"+voice+"'><prosody rate='"+rate+"'>"+text+"</prosody></voice></speak>";
      ws.send("X-RequestId:"+crypto.randomUUID().replace(/-/g,"")+"\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n"+ssml);
    });
    ws.on("message",(data,isBin)=>{
      if(!isBin){
        if(data.toString().includes("Path:turn.end")){ clearTimeout(to);ws.close();
          const all=Buffer.concat(audio); require("fs").writeFileSync("E:/育人帮/temp/edge-tts-sample.mp3",all);
          resolve({bytes:all.length,ms:Date.now()-t0}); }
        return;
      }
      const u8=new Uint8Array(data); const hlen=(u8[0]<<8)|u8[1];
      if(Buffer.from(u8.slice(2,2+hlen)).toString().includes("Path:audio")) audio.push(Buffer.from(u8.slice(2+hlen)));
    });
    ws.on("error",e=>{clearTimeout(to);reject(new Error("ws: "+e.message));});
  });
}

module.exports={generateSecMsGec,synth,WSS,GEC_VERSION,ORIGIN,UA,_dbg:{sha256Init,sha256DigestCustom,cs64Digest,expand,rounds,RC,RC_BLOCK}};
if(require.main===module){
  (async()=>{
    console.log("token sample:",generateSecMsGec());
    try{ const r=await synth("各位家长晚上好，欢迎来到育人帮。","zh-CN-YunyangNeural","+0%");
      console.log("OK mp3 "+r.bytes+" bytes, "+r.ms+"ms"); }
    catch(e){ console.log("FAIL "+e.message); process.exit(1); }
  })();
}
