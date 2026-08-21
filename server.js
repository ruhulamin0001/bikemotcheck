'use strict';
/* MOT history checker for bikemotcheckuk.cloud
   Single file, zero dependencies, Node 20+.
   SECRETS COME FROM THE ENVIRONMENT. Never commit them to this repo. */
const http = require('http');

const CLIENT_ID     = process.env.DVSA_CLIENT_ID;
const CLIENT_SECRET = process.env.DVSA_CLIENT_SECRET;
const API_KEY       = process.env.DVSA_API_KEY;
const TOKEN_URL     = process.env.DVSA_TOKEN_URL;
const SCOPE         = process.env.DVSA_SCOPE || 'https://tapi.dvsa.gov.uk/.default';
const API_BASE      = 'https://history.mot.api.gov.uk/v1/trade/vehicles/registration/';
const PORT          = process.env.PORT || 80;

if(!CLIENT_ID || !CLIENT_SECRET || !API_KEY || !TOKEN_URL){
  console.error('FATAL: missing DVSA_CLIENT_ID / DVSA_CLIENT_SECRET / DVSA_API_KEY / DVSA_TOKEN_URL');
}

/* ---------- access token cache. DVSA tokens last 60 min, refresh at 55 ---------- */
let tokenCache = { value: null, expiresAt: 0 };
let tokenInFlight = null;

async function getToken(){
  const now = Date.now();
  if (tokenCache.value && now < tokenCache.expiresAt) return tokenCache.value;
  if (tokenInFlight) return tokenInFlight;
  tokenInFlight = (async () => {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: SCOPE
    });
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    if(!r.ok){
      const t = await r.text();
      throw new Error('token ' + r.status + ' ' + t.slice(0,200));
    }
    const j = await r.json();
    tokenCache = { value: j.access_token, expiresAt: Date.now() + ((j.expires_in||1199) - 300) * 1000 };
    return tokenCache.value;
  })().finally(()=>{ tokenInFlight = null; });
  return tokenInFlight;
}

/* ---------- result cache. MOT records change at most once a year ---------- */
const CACHE_TTL = 6 * 60 * 60 * 1000;
const cache = new Map();
function cacheGet(k){ const e = cache.get(k); if(!e) return null; if(Date.now() > e.exp){ cache.delete(k); return null; } return e.v; }
function cacheSet(k,v){ if(cache.size > 5000) cache.clear(); cache.set(k,{ v, exp: Date.now()+CACHE_TTL }); }

/* ---------- per IP rate limit, protects the DVSA quota from abuse ---------- */
const hits = new Map();
function allow(ip){
  const now = Date.now(), win = 60*60*1000, max = 30;
  const a = (hits.get(ip)||[]).filter(t => now - t < win);
  if(a.length >= max){ hits.set(ip,a); return false; }
  a.push(now); hits.set(ip,a);
  if(hits.size > 20000) hits.clear();
  return true;
}

/* ---------- global pacing, DVSA allows burst 10 and 15 rps ---------- */
let lastCall = 0;
async function pace(){
  const gap = 120;
  const wait = Math.max(0, lastCall + gap - Date.now());
  lastCall = Date.now() + wait;
  if(wait) await new Promise(r=>setTimeout(r,wait));
}

const VALID_REG = /^[A-Z0-9]{2,8}$/;
function cleanReg(s){ return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,''); }

async function lookup(reg){
  const hit = cacheGet(reg);
  if(hit) return { ...hit, cached: true };
  const token = await getToken();
  await pace();
  const r = await fetch(API_BASE + encodeURIComponent(reg), {
    headers: { 'Authorization': 'Bearer ' + token, 'X-API-Key': API_KEY, 'Accept': 'application/json' }
  });
  if(r.status === 404) { const nf = { notFound: true }; cacheSet(reg, nf); return nf; }
  if(r.status === 401 || r.status === 403){ tokenCache = { value:null, expiresAt:0 }; throw Object.assign(new Error('auth'), { code: r.status }); }
  if(!r.ok) throw Object.assign(new Error('upstream'), { code: r.status });
  const data = await r.json();
  cacheSet(reg, data);
  return data;
}

function send(res, code, body, type){
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': type && type.indexOf('html')>-1 ? 'public, max-age=600' : 'no-store'
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const PAGE = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Free MOT History Check UK - Cars, Vans and Motorcycles | Bike MOT Check UK</title>
<meta name="description" content="Check any UK vehicle's full MOT history free. Every test, mileage reading, advisory and failure since 2005, straight from DVSA records. No sign up, no adverts, no data stored.">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="https://bikemotcheckuk.cloud/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Bike MOT Check UK">
<meta property="og:locale" content="en_GB">
<meta property="og:title" content="Free MOT History Check UK - Cars, Vans and Motorcycles">
<meta property="og:description" content="Every MOT test, mileage reading, advisory and failure since 2005, straight from DVSA records. Free, no sign up, nothing stored.">
<meta property="og:url" content="https://bikemotcheckuk.cloud/">
<meta name="twitter:card" content="summary_large_image">
<style>
:root{--ink:#0b0c0c;--grey:#505a5f;--line:#b1b4b6;--blue:#1d70b8;--green:#00703c;--red:#d4351c;--amber:#f47738;--paper:#f3f2f1;--plate:#fddb00}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:var(--ink);background:#fff;line-height:1.5}
.wrap{max-width:760px;margin:0 auto;padding:0 16px}
header{background:var(--ink);color:#fff;padding:14px 0}
header .wrap{display:flex;align-items:center;gap:10px}
header strong{font-size:1.15rem;letter-spacing:-.3px}
header span{font-size:.78rem;opacity:.75}
.hero{padding:34px 0 8px}
h1{font-size:2rem;line-height:1.15;margin:0 0 10px;letter-spacing:-.6px}
.lede{font-size:1.05rem;color:var(--grey);margin:0 0 22px}
form{display:flex;flex-wrap:wrap;gap:10px;align-items:stretch;margin-bottom:8px}
.plate{display:flex;align-items:stretch;border:2px solid var(--ink);border-radius:6px;overflow:hidden;background:var(--plate);flex:1 1 260px;min-width:0}
.plate .gb{background:#0b3d91;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 9px;font-size:.62rem;font-weight:700}
.plate input{border:0;background:transparent;font-size:1.65rem;font-weight:800;letter-spacing:3px;text-transform:uppercase;padding:12px 10px;width:100%;min-width:0;font-family:"Segoe UI",Arial,sans-serif}
.plate input:focus{outline:3px solid #ffdd00;outline-offset:-3px}
button{background:var(--green);color:#fff;border:0;border-radius:4px;padding:14px 24px;font-size:1.02rem;font-weight:700;cursor:pointer;box-shadow:0 2px 0 #002d18}
button:hover{background:#005a30}
button:disabled{opacity:.6;cursor:wait}
.hint{font-size:.85rem;color:var(--grey);margin:0 0 26px}
.msg{padding:14px 16px;border-left:5px solid var(--red);background:#fef7f7;margin:18px 0;font-weight:600}
.card{border:1px solid var(--line);border-radius:6px;margin:18px 0;overflow:hidden}
.card h2{margin:0;padding:14px 16px;background:var(--paper);font-size:1.05rem;border-bottom:1px solid var(--line)}
.rows{display:grid;grid-template-columns:1fr 1fr;gap:0}
.rows div{padding:10px 16px;border-bottom:1px solid #e8e6e4;font-size:.94rem}
.rows div:nth-child(odd){color:var(--grey)}
.status{padding:16px;font-size:1.05rem;font-weight:700}
.ok{background:#e7f3ec;border-left:5px solid var(--green);color:#00401f}
.bad{background:#fdeceb;border-left:5px solid var(--red);color:#7a1d10}
.warn{background:#fff4ec;border-left:5px solid var(--amber);color:#7a3d10}
.test{border-bottom:1px solid #e8e6e4;padding:14px 16px}
.test:last-child{border-bottom:0}
.test .top{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;justify-content:space-between}
.pill{font-size:.72rem;font-weight:800;letter-spacing:.6px;padding:3px 9px;border-radius:20px;text-transform:uppercase}
.p-pass{background:#e7f3ec;color:#00401f}
.p-fail{background:#fdeceb;color:#7a1d10}
.test .meta{font-size:.86rem;color:var(--grey);margin:4px 0 0}
.defects{margin:10px 0 0;padding:0;list-style:none}
.defects li{font-size:.9rem;padding:6px 0 6px 12px;border-left:3px solid var(--line)}
.defects li.DANGEROUS{border-left-color:var(--red);color:#7a1d10;font-weight:600}
.defects li.MAJOR,.defects li.FAIL{border-left-color:var(--red)}
.defects li.MINOR{border-left-color:var(--amber)}
.defects li.ADVISORY,.defects li.USERENTERED{border-left-color:var(--blue);color:var(--grey)}
.tag{font-size:.68rem;font-weight:800;letter-spacing:.5px;margin-right:6px;opacity:.85}
footer{margin:44px 0 30px;padding-top:18px;border-top:1px solid var(--line);font-size:.85rem;color:var(--grey)}
footer a{color:var(--blue)}
.spinner{display:inline-block;width:15px;height:15px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:s .7s linear infinite;vertical-align:-2px;margin-right:7px}
@keyframes s{to{transform:rotate(360deg)}}
.explain{margin:34px 0}
.explain h2{font-size:1.25rem;margin:0 0 8px}
.explain p{color:var(--grey);margin:0 0 14px}
@media(max-width:520px){h1{font-size:1.6rem}.rows{grid-template-columns:1fr}.rows div:nth-child(odd){padding-bottom:0;border-bottom:0}}
</style>
</head>
<body>
<header><div class="wrap"><strong>Bike MOT Check UK</strong><span>Free MOT history, straight from DVSA</span></div></header>
<main class="wrap">
  <section class="hero">
    <h1>Check any UK vehicle's full MOT history, free.</h1>
    <p class="lede">Every test, every mileage reading, every advisory and every failure since 2005. Cars, vans, motorcycles, HGVs and trailers. No sign up, no adverts, and we store nothing.</p>
    <form id="f">
      <label class="plate" for="reg">
        <span class="gb">&#9733;<br>GB</span>
        <input id="reg" name="reg" placeholder="AB12 CDE" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="10" aria-label="Vehicle registration">
      </label>
      <button id="go" type="submit">Check MOT history</button>
    </form>
    <p class="hint">Type the registration exactly as it appears on the number plate. Spaces do not matter.</p>
  </section>
  <div id="out"></div>
  <section class="explain">
    <h2>What you get</h2>
    <p>This pulls the official DVSA MOT record for the vehicle. That means the real mileage at every test, which is the single most useful thing when you are buying second hand, because it shows whether the odometer reading makes sense over time. It also shows what failed, what was only an advisory, and anything recorded as dangerous.</p>
    <h2>Why mileage history matters</h2>
    <p>Mileage that drops between tests, or jumps unrealistically, is the clearest sign something is wrong. A private seller can say anything about a vehicle. The MOT record was written by the testing station, not the seller.</p>
    <h2>What is not here</h2>
    <p>Vehicles under three years old have no MOT yet, so they will show as not found. Some imports and vehicles registered in Northern Ireland before 2017 have partial records. This is MOT history only, not tax, insurance or outstanding finance.</p>
  </section>
</main>
<footer class="wrap">
  <p><strong>Not affiliated with DVSA or GOV.UK.</strong> Data comes from the DVSA MOT History API under the Open Government Licence v3.0. Always confirm anything important on <a href="https://www.gov.uk/check-mot-history" rel="noopener">gov.uk</a> before you buy a vehicle.</p>
  <p>We do not store your searches. Nothing is saved, no account is needed, and there are no tracking cookies. Built by Ruhul Amin.</p>
</footer>
<script>
const f=document.getElementById('f'),reg=document.getElementById('reg'),out=document.getElementById('out'),go=document.getElementById('go');
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fmt(d){ if(!d) return ''; const p=String(d).slice(0,10).replace(/\./g,'-'); const t=new Date(p); if(isNaN(t)) return esc(d); return t.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}); }
function daysTo(d){ if(!d) return null; const t=new Date(String(d).slice(0,10).replace(/\./g,'-')); if(isNaN(t)) return null; return Math.round((t-new Date())/86400000); }
function num(n){ return n==null||n===''?'':Number(n).toLocaleString('en-GB'); }
f.addEventListener('submit',async e=>{
  e.preventDefault();
  const v=reg.value.toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(v.length<2){ out.innerHTML='<div class="msg">Enter a registration to check.</div>'; return; }
  go.disabled=true; go.innerHTML='<span class="spinner"></span>Checking';
  out.innerHTML='';
  try{
    const r=await fetch('/api/mot?reg='+encodeURIComponent(v));
    const j=await r.json();
    if(!r.ok){ out.innerHTML='<div class="msg">'+esc(j.error||'Something went wrong.')+'</div>'; return; }
    render(Array.isArray(j)?j[0]:j);
  }catch(err){ out.innerHTML='<div class="msg">Could not complete the check. Please try again.</div>'; }
  finally{ go.disabled=false; go.textContent='Check MOT history'; }
});
function render(v){
  if(!v){ out.innerHTML='<div class="msg">No record returned.</div>'; return; }
  const tests=(v.motTests||[]).slice().sort((a,b)=>String(b.completedDate).localeCompare(String(a.completedDate)));
  const latest=tests.find(t=>/pass/i.test(t.testResult||''))||tests[0];
  let h='';
  const exp=latest&&latest.expiryDate?latest.expiryDate:v.motTestDueDate;
  const d=daysTo(exp);
  if(v.motTestDueDate&&!tests.length){
    h+='<div class="card"><div class="status warn">First MOT due '+fmt(v.motTestDueDate)+'. This vehicle has no MOT tests yet.</div></div>';
  } else if(d!=null){
    h+='<div class="card"><div class="status '+(d<0?'bad':(d<30?'warn':'ok'))+'">'+
       (d<0?('MOT expired '+Math.abs(d)+' day'+(Math.abs(d)===1?'':'s')+' ago, on '+fmt(exp))
           :('MOT valid until '+fmt(exp)+' &middot; '+d+' day'+(d===1?'':'s')+' left'))+'</div></div>';
  }
  h+='<div class="card"><h2>'+esc([v.make,v.model].filter(Boolean).join(' ')||'Vehicle')+' &middot; '+esc(v.registration||'')+'</h2><div class="rows">'+
     row('Make',v.make)+row('Model',v.model)+row('Colour',v.primaryColour)+row('Fuel',v.fuelType)+
     row('Engine size',v.engineSize?num(v.engineSize)+' cc':'')+row('First used',fmt(v.firstUsedDate))+
     row('Registered',fmt(v.registrationDate))+row('Manufactured',fmt(v.manufactureDate))+
     '</div></div>';
  const reads=tests.filter(t=>t.odometerValue&&t.odometerResultType!=='NO_ODOMETER');
  if(reads.length>1){
    let warn='';
    for(let i=0;i<reads.length-1;i++){
      const a=Number(reads[i].odometerValue), b=Number(reads[i+1].odometerValue);
      if(a<b){ warn='<div class="status bad">Mileage went down between tests. Recorded '+num(b)+' on '+fmt(reads[i+1].completedDate)+', then '+num(a)+' on '+fmt(reads[i].completedDate)+'. Ask the seller about this before going any further.</div>'; break; }
    }
    h+='<div class="card"><h2>Mileage at each test</h2>'+warn+'<div class="rows">'+
        reads.map(t=>'<div>'+fmt(t.completedDate)+'</div><div>'+num(t.odometerValue)+' '+esc(t.odometerUnit||'mi')+'</div>').join('')+
        '</div></div>';
  }
  if(tests.length){
    h+='<div class="card"><h2>'+tests.length+' MOT test'+(tests.length===1?'':'s')+' on record</h2>'+
      tests.map(t=>{
        const pass=/pass/i.test(t.testResult||'');
        const ds=(t.defects||t.rfrAndComments||[]);
        return '<div class="test"><div class="top"><span class="pill '+(pass?'p-pass':'p-fail')+'">'+esc(t.testResult||'')+'</span>'+
          '<span>'+fmt(t.completedDate)+'</span></div>'+
          '<p class="meta">'+(t.odometerValue?num(t.odometerValue)+' '+esc(t.odometerUnit||'mi'):'No mileage recorded')+
          (t.expiryDate?' &middot; expired '+fmt(t.expiryDate):'')+
          (t.motTestNumber?' &middot; test '+esc(t.motTestNumber):'')+'</p>'+
          (ds.length?'<ul class="defects">'+ds.map(x=>{
            const ty=String(x.type||'').replace(/[^A-Z]/gi,'').toUpperCase();
            return '<li class="'+ty+'"><span class="tag">'+esc(x.type||'')+(x.dangerous?' &middot; DANGEROUS':'')+'</span>'+esc(x.text)+'</li>';
          }).join('')+'</ul>':'')+
        '</div>';
      }).join('')+'</div>';
  }
  out.innerHTML=h;
  out.scrollIntoView({behavior:'smooth',block:'start'});
}
function row(k,v){ return v?'<div>'+esc(k)+'</div><div>'+esc(v)+'</div>':''; }
reg.addEventListener('input',()=>{ reg.value=reg.value.toUpperCase(); });
</script>
</body>
</html>`;

const server = http.createServer(async (req,res)=>{
  const u = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for']||'').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  if(u.pathname === '/healthz') return send(res,200,{ ok:true });
  if(u.pathname === '/robots.txt') return send(res,200,'User-agent: *\nAllow: /\nSitemap: https://bikemotcheckuk.cloud/sitemap.xml\n','text/plain; charset=utf-8');
  if(u.pathname === '/sitemap.xml') return send(res,200,'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://bikemotcheckuk.cloud/</loc><priority>1.0</priority></url></urlset>\n','application/xml; charset=utf-8');

  if(u.pathname === '/api/mot'){
    const reg = cleanReg(u.searchParams.get('reg'));
    if(!VALID_REG.test(reg)) return send(res,400,{ error:'Enter a valid UK registration.' });
    if(!allow(ip)) return send(res,429,{ error:'Too many lookups from this connection. Try again later.' });
    try{
      const data = await lookup(reg);
      if(data.notFound) return send(res,404,{ error:'No MOT record found for that registration. Very new vehicles and some imports will not appear.' });
      return send(res,200,data);
    }catch(e){
      console.error('lookup failed', reg, e.code||'', e.message);
      if(e.code === 429) return send(res,429,{ error:'The DVSA service is busy. Please try again in a minute.' });
      return send(res,502,{ error:'Could not reach the DVSA service. Please try again shortly.' });
    }
  }

  if(u.pathname === '/' || u.pathname === '/index.html') return send(res,200,PAGE,'text/html; charset=utf-8');
  return send(res,404,'<h1>404</h1><p><a href="/">Back to the MOT checker</a></p>','text/html; charset=utf-8');
});

server.listen(PORT, ()=> console.log('MOT checker listening on ' + PORT));
