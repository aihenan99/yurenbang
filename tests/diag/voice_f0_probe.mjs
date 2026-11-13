import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require=createRequire(import.meta.url);
const CHROME=["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(p=>fs.existsSync(p));
const {chromium}=require(path.join(path.dirname(fileURLToPath(import.meta.url)),'..','..','temp','pw','node_modules','playwright-core'));
const b=await chromium.launch({executablePath:CHROME,headless:true});
const p=await b.newPage();
await p.goto('about:blank');
for(const f of ['temp/tts_cf.mp3','temp/tts_pitch.mp3','temp/tts_pitch6.mp3','temp/tts_xiaoxuan.mp3','temp/tts_new.mp3','temp/verify_v.mp3']){
  const b64=fs.readFileSync(f).toString('base64');
  const out=await p.evaluate(async(b64)=>{
    const bin=atob(b64); const u8=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
    const ac=new OfflineAudioContext(1,1024,16000);
    const buf=await ac.decodeAudioData(u8.buffer.slice(0));
    const d=buf.getChannelData(0), sr=buf.sampleRate;
    // 取中间段（跳过静音）
    function rms(a,b){let s=0;for(let i=a;i<b;i++)s+=d[i]*d[i];return Math.sqrt(s/(b-a));}
    let start=0; const win=Math.floor(sr*0.1);
    for(let i=0;i+win<d.length;i+=win){ if(rms(i,i+win)>0.02){start=i;break;} }
    const N=Math.min(4096, d.length-start);
    const seg=d.subarray(start, start+N);
    // 自相关 F0（60-400Hz）
    let best=0,bestLag=0;
    for(let lag=Math.floor(sr/400); lag<Math.floor(sr/60); lag++){
      let s=0; for(let i=0;i+lag<seg.length;i++) s+=seg[i]*seg[i+lag];
      if(s>best){best=s;bestLag=lag;}
    }
    // 多帧
    const frames=[], step=Math.floor(sr*0.03);
    for(let st=start; st+2048<d.length; st+=step){
      const sg=d.subarray(st,st+2048);
      if(rms(st,st+2048)<0.02) continue;
      let bb=0,bl=0;
      for(let lag=Math.floor(sr/400);lag<Math.floor(sr/60);lag++){
        let s=0; for(let i=0;i+lag<sg.length;i++) s+=sg[i]*sg[i+lag];
        if(s>bb){bb=s;bl=lag;}
      }
      if(bl) frames.push(sr/bl);
    }
    frames.sort((a,b)=>a-b);
    const med=frames.length?frames[Math.floor(frames.length/2)]:null;
    return {dur:+buf.duration.toFixed(2), sr, f0_first:+(sr/bestLag).toFixed(1), f0_median:med?+med.toFixed(1):null, frames:frames.length};
  },b64);
  console.log(f, JSON.stringify(out));
}
await b.close();
