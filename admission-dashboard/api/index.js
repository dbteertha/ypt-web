import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const PORT = process.env.PORT || 10000;
const SOURCES = [
  {name:'Chorcha', url:'https://chorcha.net/admission-calendar'},
  {name:'MNR Study', url:'https://study.mnr.bd/calendar'},
  {name:'Admission Calendar', url:'https://admission-calendar.com/'}
];

let cache = { at: 0, events: [], sources: [] };
const TTL = 30 * 60 * 1000;

function fetchText(url, redirects=0){
  return new Promise((resolve,reject)=>{
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(url,{headers:{'user-agent':'Mozilla/5.0 AdmissionDashboard/1.0','accept':'text/html,application/xhtml+xml'}},res=>{
      if(res.statusCode>=300 && res.statusCode<400 && res.headers.location && redirects<5){
        const next = new URL(res.headers.location,url).toString();
        res.resume(); return resolve(fetchText(next,redirects+1));
      }
      let data='';
      res.setEncoding('utf8');
      res.on('data',c=>{ if(data.length<5_000_000) data+=c; });
      res.on('end',()=>resolve({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,text:data}));
    });
    req.setTimeout(12000,()=>req.destroy(new Error('timeout')));
    req.on('error',reject);
  });
}
function decode(s){
  return s.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n));
}
function htmlToLines(html){
  let s=html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<\/(?:div|p|li|tr|td|th|h[1-6]|section|article|br)>/gi,'\n')
    .replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,' ');
  s=decode(s).replace(/[ \t]+/g,' ').replace(/\r/g,'');
  return s.split('\n').map(x=>x.trim()).filter(Boolean);
}
const bnDigits = {'০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9'};
function latinDigits(s){return s.replace(/[০-৯]/g,d=>bnDigits[d]);}
const months = {
  jan:0,january:0,'জানুয়ারি':0,'জানুয়ারি':0,
  feb:1,february:1,'ফেব্রুয়ারি':1,'ফেব্রুয়ারি':1,
  mar:2,march:2,'মার্চ':2,
  apr:3,april:3,'এপ্রিল':3,
  may:4,'মে':4,
  jun:5,june:5,'জুন':5,
  jul:6,july:6,'জুলাই':6,
  aug:7,august:7,'আগস্ট':7,
  sep:8,september:8,'সেপ্টেম্বর':8,
  oct:9,october:9,'অক্টোবর':9,
  nov:10,november:10,'নভেম্বর':10,
  dec:11,december:11,'ডিসেম্বর':11
};
function parseDate(text){
  const t=latinDigits(text).replace(/,/g,' ');
  let m=t.match(/\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d{2})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
  if(!m) m=t.match(/(\d{1,2})\s+(জানুয়ারি|জানুয়ারি|ফেব্রুয়ারি|ফেব্রুয়ারি|মার্চ|এপ্রিল|মে|জুন|জুলাই|আগস্ট|সেপ্টেম্বর|অক্টোবর|নভেম্বর|ডিসেম্বর)\s+(20\d{2})(?:.*?(\d{1,2})[:.]?(\d{2})?\s*(AM|PM|am|pm)?)?/i);
  if(!m) return null;
  let day=+m[1], mon=months[m[2].toLowerCase()] ?? months[m[2]], year=+m[3];
  let hh=m[4]?+m[4]:12, mm=m[5]?+m[5]:0, ap=(m[6]||'').toUpperCase();
  if(ap==='PM'&&hh<12) hh+=12; if(ap==='AM'&&hh===12) hh=0;
  if(mon===undefined) return null;
  const d=new Date(Date.UTC(year,mon,day,hh-6,mm)); // interpret source times as Bangladesh time
  return isNaN(d)?null:d;
}
function cleanTitle(s){
  return s.replace(/\s+/g,' ').replace(/^(university|বিশ্ববিদ্যালয়)\s*/i,'').slice(0,100).trim();
}
function parseEvents(html,source){
  const lines=htmlToLines(html); const out=[];
  for(let i=0;i<lines.length;i++){
    const dt=parseDate(lines[i]); if(!dt) continue;
    let title='';
    for(let j=i-1;j>=Math.max(0,i-4);j--){
      const c=cleanTitle(lines[j]);
      if(c.length>=2 && c.length<=100 && !/^(date|time|তারিখ|সময়|সময় বাকি)$/i.test(c)){title=c;break;}
    }
    if(!title || /admission calendar|এডমিশন ক্যালেন্ডার/i.test(title)) continue;
    out.push({title,date:dt.toISOString(),source:source.name,sourceUrl:source.url,raw:lines[i].slice(0,180)});
  }
  return out;
}
function dedupe(events){
  const seen=new Map();
  for(const e of events){
    const day=e.date.slice(0,10);
    const key=(e.title.toLowerCase().replace(/[^a-z0-9\u0980-\u09ff]+/g,' ').trim().slice(0,45)+'|'+day);
    if(!seen.has(key)) seen.set(key,e);
    else {
      const cur=seen.get(key);
      cur.source += cur.source.includes(e.source)?'':' + '+e.source;
    }
  }
  return [...seen.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
async function sync(force=false){
  if(!force && Date.now()-cache.at<TTL && cache.events.length) return cache;
  const results=await Promise.all(SOURCES.map(async s=>{
    try{
      const r=await fetchText(s.url);
      const events=r.ok?parseEvents(r.text,s):[];
      return {name:s.name,url:s.url,ok:r.ok,status:r.status,count:events.length,events};
    }catch(err){return {name:s.name,url:s.url,ok:false,status:0,count:0,error:String(err.message||err),events:[]};}
  }));
  const events=dedupe(results.flatMap(r=>r.events));
  if(events.length) cache={at:Date.now(),events,sources:results.map(({events,...x})=>x)};
  else cache={...cache,at:Date.now(),sources:results.map(({events,...x})=>x)};
  return cache;
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ADM Countdown 2026</title>
<style>
:root{--bg:#030303;--panel:#0a0b0d;--line:#25282e;--text:#f4f4f2;--muted:#979b9f;--soft:#d9d7cd;--chip:#14161a}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}body{min-height:100vh;overflow-x:hidden}
#stars{position:fixed;inset:0;z-index:0;pointer-events:none}.app{position:relative;z-index:1;max-width:1180px;margin:auto;padding:28px 18px 64px}
nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}.brand{font-weight:900;letter-spacing:.18em;font-size:13px}.live{font-size:12px;color:#b6babf;border:1px solid var(--line);padding:8px 11px;border-radius:999px;background:#090a0c}
.hero{min-height:560px;display:grid;place-items:center;text-align:center}.hero-inner{width:min(780px,100%)}
.kicker{font-size:12px;letter-spacing:.18em;color:#aeb2b7;text-transform:uppercase}.days{font-size:clamp(96px,19vw,188px);font-weight:900;line-height:.84;letter-spacing:-.08em;margin:18px 0 10px;text-shadow:0 0 30px #ffffff18}
.label{font-weight:800;font-size:14px;letter-spacing:.12em}.clock{display:flex;justify-content:center;gap:clamp(14px,4vw,38px);margin:18px 0 22px}.clock b{font-size:clamp(25px,5vw,46px);letter-spacing:.02em}.clock span{display:block;color:#8e9297;font-size:10px;margin-top:3px}
.progress{height:22px;border:1px solid #343941;border-radius:999px;overflow:hidden;background:#080a0d;box-shadow:inset 0 0 18px #000}.fill{height:100%;width:0;background:linear-gradient(90deg,#c9c7bd,#eeeDE7);border-radius:inherit;transition:width .8s}.pct{margin-top:9px;font-size:12px;color:#aeb2b7}.passed{font-size:22px;font-weight:800;margin-top:22px}.passed i{font-style:normal;color:#73777c;margin:0 14px}
.section{background:#08090bde;border:1px solid #1e2126;border-radius:24px;padding:22px;backdrop-filter:blur(14px);box-shadow:0 28px 90px #0009}.head{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap;margin-bottom:18px}.head h2{font-size:30px;margin:0}.sub{color:#8e9297;font-size:13px;margin-top:5px}
.controls{display:flex;gap:8px;flex-wrap:wrap}.btn,input,select{background:#101216;color:#e7e8e9;border:1px solid #2b2f36;border-radius:12px;padding:10px 12px;font:inherit}.btn{cursor:pointer}.btn:hover{background:#171a20}
.calendar-head{display:flex;align-items:center;justify-content:space-between;margin:14px 0}.month{font-size:19px;font-weight:800}.week,.grid{display:grid;grid-template-columns:repeat(7,1fr)}.week div{color:#777c83;font-size:11px;padding:8px;text-align:center}
.day{min-height:112px;border-top:1px solid #1b1e23;border-left:1px solid #15181c;padding:8px;position:relative}.day:nth-child(7n+1){border-left:0}.day.muted{opacity:.25}.num{font-size:12px;color:#b8bbc0}.today .num{background:#eee;color:#090909;border-radius:999px;padding:3px 7px;display:inline-block;font-weight:900}.event{display:block;margin-top:6px;background:#15181d;border:1px solid #292d34;border-radius:8px;padding:5px 6px;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}.event:hover{background:#20242b}
.upcoming{margin-top:28px}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}.card{border:1px solid #23262c;background:#0d0f12;border-radius:15px;padding:14px}.card h3{font-size:14px;margin:0 0 8px}.meta{font-size:12px;color:#969aa0;line-height:1.6}.source{font-size:10px;color:#c5c8cc;margin-top:8px}.source a{color:#c5c8cc}
.empty{color:#8a8f95;padding:30px;text-align:center;border:1px dashed #2a2e34;border-radius:14px}.footer{color:#6d7279;font-size:11px;text-align:center;margin-top:22px}
@media(max-width:700px){.hero{min-height:500px}.section{padding:14px}.day{min-height:78px;padding:5px}.event{font-size:8px;padding:4px}.head h2{font-size:24px}.clock{gap:14px}.passed{font-size:17px}}
</style></head><body><canvas id="stars"></canvas><div class="app"><nav><div class="brand">ADM • 26/27</div><div id="syncStatus" class="live">● syncing sources…</div></nav>
<section class="hero"><div class="hero-inner"><div class="kicker">Admission test begins • 30 December 2026</div><div class="days" id="days">00</div><div class="label">DAYS LEFT</div>
<div class="clock"><div><b id="weeks">00W</b><span>WEEKS</span></div><div><b id="hours">00H</b><span>HOURS</span></div><div><b id="mins">00M</b><span>MINUTES</span></div><div><b id="secs">00S</b><span>SECONDS</span></div></div>
<div class="progress"><div class="fill" id="fill"></div></div><div class="pct" id="pct">0%</div><div class="passed"><span id="passed">0 Passed</span><i>|</i><span id="total">0 Total</span></div></div></section>
<section class="section"><div class="head"><div><h2>Admission Calendar</h2><div class="sub">Live schedule aggregated from Chorcha, MNR Study and Admission Calendar.</div></div><div class="controls"><input id="search" placeholder="Search university…"><select id="sourceFilter"><option value="">All sources</option></select><button class="btn" id="refresh">Refresh</button></div></div>
<div class="calendar-head"><button class="btn" id="prev">←</button><div class="month" id="month"></div><button class="btn" id="next">→</button></div><div class="week"><div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div></div><div class="grid" id="grid"></div>
<div class="upcoming"><div class="head"><div><h2 style="font-size:22px">Upcoming exams</h2><div class="sub">Tap any calendar item or source link to verify details.</div></div></div><div class="cards" id="cards"></div></div>
<div class="footer">Schedules are aggregated from third-party sources and may change. Always verify critical dates from the official university notice.</div></section></div>
<script>
const TARGET=new Date('2026-12-30T00:00:00+06:00'), START=new Date('2026-09-05T00:00:00+06:00');
function countdown(){const now=new Date(), diff=Math.max(0,TARGET-now), total=Math.round((TARGET-START)/86400000), passed=Math.max(0,Math.min(total,Math.floor((now-START)/86400000))); const days=Math.floor(diff/86400000), weeks=Math.floor(days/7), h=Math.floor(diff/3600000)%24,m=Math.floor(diff/60000)%60,s=Math.floor(diff/1000)%60; daysEl.textContent=days; weeksEl.textContent=String(weeks).padStart(2,'0')+'W'; hoursEl.textContent=String(h).padStart(2,'0')+'H'; minsEl.textContent=String(m).padStart(2,'0')+'M'; secsEl.textContent=String(s).padStart(2,'0')+'S'; const p=total?passed/total*100:0; fill.style.width=p+'%'; pct.textContent=p.toFixed(2)+'%'; passedEl.textContent=passed+' Passed'; totalEl.textContent=total+' Total';}
const daysEl=document.getElementById('days'),weeksEl=document.getElementById('weeks'),hoursEl=document.getElementById('hours'),minsEl=document.getElementById('mins'),secsEl=document.getElementById('secs'),fill=document.getElementById('fill'),pct=document.getElementById('pct'),passedEl=document.getElementById('passed'),totalEl=document.getElementById('total'); countdown();setInterval(countdown,1000);
let all=[],view=new Date(2026,11,1);
function bdDate(iso){return new Date(new Date(iso).toLocaleString('en-US',{timeZone:'Asia/Dhaka'}))}
function filtered(){const q=search.value.toLowerCase(),sf=sourceFilter.value;return all.filter(e=>(!q||e.title.toLowerCase().includes(q))&&(!sf||e.source.includes(sf)))}
function render(){month.textContent=view.toLocaleString('en-US',{month:'long',year:'numeric'});grid.innerHTML='';const y=view.getFullYear(),mo=view.getMonth(),first=new Date(y,mo,1),start=new Date(y,mo,1-first.getDay());const es=filtered();for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);const cell=document.createElement('div');cell.className='day'+(d.getMonth()!=mo?' muted':'');const now=new Date();if(d.toDateString()==now.toDateString())cell.classList.add('today');cell.innerHTML='<span class="num">'+d.getDate()+'</span>';es.filter(e=>{const x=bdDate(e.date);return x.getFullYear()==d.getFullYear()&&x.getMonth()==d.getMonth()&&x.getDate()==d.getDate()}).slice(0,4).forEach(e=>{const el=document.createElement('a');el.className='event';el.textContent=e.title;el.title=e.title+' — '+new Date(e.date).toLocaleString('en-BD',{timeZone:'Asia/Dhaka'})+' • '+e.source;el.href=e.sourceUrl;el.target='_blank';cell.appendChild(el)});grid.appendChild(cell)}renderCards();}
function renderCards(){const now=new Date();const arr=filtered().filter(e=>new Date(e.date)>now).slice(0,12);cards.innerHTML=arr.length?'':'<div class="empty">No upcoming events matched the current filter.</div>';arr.forEach(e=>{const d=new Date(e.date);const c=document.createElement('div');c.className='card';c.innerHTML='<h3>'+esc(e.title)+'</h3><div class="meta">'+d.toLocaleString('en-BD',{timeZone:'Asia/Dhaka',dateStyle:'medium',timeStyle:'short'})+'<br>'+Math.max(0,Math.ceil((d-now)/86400000))+' days left</div><div class="source">Source: <a target="_blank" href="'+e.sourceUrl+'">'+esc(e.source)+'</a></div>';cards.appendChild(c)})}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function load(force=false){syncStatus.textContent='● syncing sources…';try{const r=await fetch('/api/events'+(force?'?refresh=1':''));const j=await r.json();all=j.events||[];syncStatus.textContent='● updated '+new Date(j.updatedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});const names=[...new Set((j.sources||[]).map(x=>x.name))];sourceFilter.innerHTML='<option value="">All sources</option>'+names.map(n=>'<option>'+esc(n)+'</option>').join('');render()}catch(e){syncStatus.textContent='● sync unavailable';render()}}
prev.onclick=()=>{view=new Date(view.getFullYear(),view.getMonth()-1,1);render()};next.onclick=()=>{view=new Date(view.getFullYear(),view.getMonth()+1,1);render()};refresh.onclick=()=>load(true);search.oninput=render;sourceFilter.onchange=render;load();
const cv=document.getElementById('stars'),cx=cv.getContext('2d');let stars=[];function resize(){cv.width=innerWidth*devicePixelRatio;cv.height=innerHeight*devicePixelRatio;cv.style.width=innerWidth+'px';cv.style.height=innerHeight+'px';cx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);stars=Array.from({length:Math.min(180,innerWidth/5)},()=>({x:Math.random()*innerWidth,y:Math.random()*innerHeight,r:Math.random()*1.1+.2,a:Math.random()*.7+.15,p:Math.random()*6.28}))}addEventListener('resize',resize);resize();function draw(t){cx.clearRect(0,0,innerWidth,innerHeight);for(const s of stars){cx.globalAlpha=s.a*(.65+.35*Math.sin(t/900+s.p));cx.fillStyle='#fff';cx.beginPath();cx.arc(s.x,s.y,s.r,0,6.28);cx.fill()}requestAnimationFrame(draw)}requestAnimationFrame(draw);
</script></body></html>`;

export default async function handler(req,res){
  const u=new URL(req.url,'https://admissionbydbt.vercel.app');
  if(u.pathname==='/api/events'){
    const data=await sync(u.searchParams.get('refresh')==='1');
    res.statusCode=200;
    res.setHeader('content-type','application/json; charset=utf-8');
    res.setHeader('cache-control','no-store');
    res.setHeader('access-control-allow-origin','*');
    return res.end(JSON.stringify({updatedAt:new Date(data.at).toISOString(),events:data.events,sources:data.sources}));
  }
  if(u.pathname==='/health'){
    res.statusCode=200; res.setHeader('content-type','text/plain'); return res.end('ok');
  }
  res.statusCode=200;
  res.setHeader('content-type','text/html; charset=utf-8');
  res.setHeader('cache-control','no-cache');
  return res.end(html);
}
