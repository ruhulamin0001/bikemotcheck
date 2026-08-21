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
const PORT          = process.env.PORT || 8080;

if(!CLIENT_ID || !CLIENT_SECRET || !API_KEY || !TOKEN_URL){
  console.error('FATAL: missing DVSA credentials in the environment');
}

/* ---------- access token cache ---------- */
let tokenCache = { value: null, expiresAt: 0 };
let tokenInFlight = null;
async function getToken(){
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  if (tokenInFlight) return tokenInFlight;
  tokenInFlight = (async () => {
    const body = new URLSearchParams({ grant_type:'client_credentials', client_id:CLIENT_ID, client_secret:CLIENT_SECRET, scope:SCOPE });
    const r = await fetch(TOKEN_URL, { method:'POST', headers:{ 'content-type':'application/x-www-form-urlencoded' }, body });
    if(!r.ok) throw new Error('token ' + r.status);
    const j = await r.json();
    tokenCache = { value: j.access_token, expiresAt: Date.now() + ((j.expires_in||1199)-300)*1000 };
    return tokenCache.value;
  })().finally(()=>{ tokenInFlight = null; });
  return tokenInFlight;
}

/* ---------- result cache ---------- */
const CACHE_TTL = 6*60*60*1000;
const cache = new Map();
function cacheGet(k){ const e=cache.get(k); if(!e) return null; if(Date.now()>e.exp){ cache.delete(k); return null; } return e.v; }
function cacheSet(k,v){ if(cache.size>5000) cache.clear(); cache.set(k,{v,exp:Date.now()+CACHE_TTL}); }

/* ---------- per IP rate limit ---------- */
const hits = new Map();
function allow(ip){
  const now=Date.now(), win=3600000, max=40;
  const a=(hits.get(ip)||[]).filter(t=>now-t<win);
  if(a.length>=max){ hits.set(ip,a); return false; }
  a.push(now); hits.set(ip,a);
  if(hits.size>20000) hits.clear();
  return true;
}

/* ---------- global pacing for DVSA burst limits ---------- */
let lastCall = 0;
async function pace(){
  const wait = Math.max(0, lastCall + 120 - Date.now());
  lastCall = Date.now() + wait;
  if(wait) await new Promise(r=>setTimeout(r,wait));
}

const VALID_REG = /^[A-Z0-9]{2,8}$/;
function cleanReg(s){ return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,''); }

async function lookup(reg){
  const hit = cacheGet(reg);
  if(hit) return hit;
  const token = await getToken();
  await pace();
  const r = await fetch(API_BASE + encodeURIComponent(reg), {
    headers:{ 'Authorization':'Bearer '+token, 'X-API-Key':API_KEY, 'Accept':'application/json' }
  });
  if(r.status===404){ const nf={notFound:true}; cacheSet(reg,nf); return nf; }
  if(r.status===401||r.status===403){ tokenCache={value:null,expiresAt:0}; throw Object.assign(new Error('auth'),{code:r.status}); }
  if(!r.ok) throw Object.assign(new Error('upstream'),{code:r.status});
  const data = await r.json();
  cacheSet(reg,data);
  return data;
}

/* ---------- MOT expiry calendar file ---------- */
function ics(reg, dateStr, label){
  const d = String(dateStr).slice(0,10).replace(/[.\-]/g,'');
  const stamp = new Date().toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//bikemotcheckuk//EN','CALSCALE:GREGORIAN','BEGIN:VEVENT',
    'UID:'+reg+'-mot@bikemotcheckuk.cloud','DTSTAMP:'+stamp,'DTSTART;VALUE=DATE:'+d,'DTEND;VALUE=DATE:'+d,
    'SUMMARY:MOT due - '+reg+(label?' ('+label+')':''),
    'DESCRIPTION:Book the MOT before this date. Checked on bikemotcheckuk.cloud',
    'BEGIN:VALARM','TRIGGER:-P21D','ACTION:DISPLAY','DESCRIPTION:MOT due in 3 weeks','END:VALARM',
    'END:VEVENT','END:VCALENDAR'].join('\r\n');
}

function send(res, code, body, type, extra){
  const h = Object.assign({
    'Content-Type': type || 'application/json; charset=utf-8',
    'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
    'Referrer-Policy':'strict-origin-when-cross-origin',
    'Cache-Control': type && type.indexOf('html')>-1 ? 'public, max-age=600' : 'no-store'
  }, extra||{});
  res.writeHead(code,h);
  res.end(typeof body==='string' ? body : JSON.stringify(body));
}

const PAGE = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Free MOT History Check UK - Mileage, Failures and Advisories | Bike MOT Check UK</title>
<meta name="description" content="Check any UK vehicle's full MOT history free. Every test, mileage reading, advisory and failure since 2005, plus an automatic buyer's report that flags mileage anomalies and repeat faults.">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="https://bikemotcheckuk.cloud/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Bike MOT Check UK">
<meta property="og:locale" content="en_GB">
<meta property="og:title" content="Free MOT History Check UK - Mileage, Failures and Advisories">
<meta property="og:description" content="Every MOT test, mileage reading, advisory and failure since 2005, plus an automatic buyer's report. Free, no sign up, nothing stored.">
<meta property="og:url" content="https://bikemotcheckuk.cloud/">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0b0c0c">
<style>
:root{--ink:#0b0c0c;--grey:#505a5f;--line:#b1b4b6;--soft:#e8e6e4;--blue:#1d70b8;--green:#00703c;--red:#d4351c;--amber:#f47738;--paper:#f7f6f4;--card:#fff;--plate:#fddb00}
@media (prefers-color-scheme:dark){:root{--ink:#f2f2f2;--grey:#a8b0b4;--line:#3d4448;--soft:#2a2f32;--paper:#15181a;--card:#1c2023}}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:var(--ink);background:var(--paper);line-height:1.55}
.wrap{max-width:780px;margin:0 auto;padding:0 16px}
header{background:#0b0c0c;color:#fff;padding:13px 0}
header .wrap{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
header strong{font-size:1.12rem;letter-spacing:-.3px}
header span{font-size:.76rem;opacity:.7}
.hero{padding:32px 0 6px}
h1{font-size:2rem;line-height:1.14;margin:0 0 10px;letter-spacing:-.7px}
.lede{font-size:1.04rem;color:var(--grey);margin:0 0 20px}
form{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:6px}
.plate{display:flex;border:2px solid #0b0c0c;border-radius:6px;overflow:hidden;background:var(--plate);flex:1 1 250px;min-width:0}
.plate .gb{background:#0b3d91;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 9px;font-size:.6rem;font-weight:700;line-height:1.1}
.plate input{border:0;background:transparent;color:#0b0c0c;font-size:1.6rem;font-weight:800;letter-spacing:3px;text-transform:uppercase;padding:12px 10px;width:100%;min-width:0}
.plate input:focus{outline:3px solid #ffdd00;outline-offset:-3px}
button.go{background:var(--green);color:#fff;border:0;border-radius:4px;padding:14px 22px;font-size:1rem;font-weight:700;cursor:pointer;box-shadow:0 2px 0 #002d18}
button.go:hover{background:#005a30}
button.go:disabled{opacity:.6;cursor:wait}
.hint{font-size:.84rem;color:var(--grey);margin:0 0 8px}
.msg{padding:14px 16px;border-left:5px solid var(--red);background:var(--card);margin:18px 0;font-weight:600;border-radius:0 6px 6px 0}
.card{border:1px solid var(--line);border-radius:8px;margin:16px 0;overflow:hidden;background:var(--card)}
.card h2{margin:0;padding:13px 16px;background:var(--soft);font-size:1.02rem;border-bottom:1px solid var(--line)}
.rows{display:grid;grid-template-columns:1fr 1fr}
.rows div{padding:9px 16px;border-bottom:1px solid var(--soft);font-size:.93rem}
.rows div:nth-child(odd){color:var(--grey)}
.status{padding:15px 16px;font-size:1.04rem;font-weight:700}
.ok{background:rgba(0,112,60,.09);border-left:5px solid var(--green)}
.bad{background:rgba(212,53,28,.09);border-left:5px solid var(--red)}
.warn{background:rgba(244,119,56,.11);border-left:5px solid var(--amber)}
.flags{list-style:none;margin:0;padding:0}
.flags li{padding:12px 16px;border-bottom:1px solid var(--soft);font-size:.93rem;display:flex;gap:11px;align-items:flex-start}
.flags li:last-child{border-bottom:0}
.dot{flex:0 0 9px;width:9px;height:9px;border-radius:50%;margin-top:7px}
.d-red{background:var(--red)}.d-amber{background:var(--amber)}.d-green{background:var(--green)}.d-grey{background:var(--line)}
.flags b{display:block;margin-bottom:1px}
.flags span{color:var(--grey)}
.test{border-bottom:1px solid var(--soft);padding:13px 16px}
.test:last-child{border-bottom:0}
.test .top{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;justify-content:space-between}
.pill{font-size:.7rem;font-weight:800;letter-spacing:.6px;padding:3px 9px;border-radius:20px;text-transform:uppercase}
.p-pass{background:rgba(0,112,60,.15);color:var(--green)}
.p-fail{background:rgba(212,53,28,.15);color:var(--red)}
.test .meta{font-size:.85rem;color:var(--grey);margin:4px 0 0}
.defects{margin:9px 0 0;padding:0;list-style:none}
.defects li{font-size:.89rem;padding:5px 0 5px 11px;border-left:3px solid var(--line);margin-bottom:3px}
.defects li.DANGEROUS{border-left-color:var(--red);font-weight:600}
.defects li.MAJOR,.defects li.FAIL{border-left-color:var(--red)}
.defects li.MINOR{border-left-color:var(--amber)}
.defects li.ADVISORY,.defects li.USERENTERED{border-left-color:var(--blue);color:var(--grey)}
.tag{font-size:.66rem;font-weight:800;letter-spacing:.5px;margin-right:6px;opacity:.8}
.chart{padding:16px}
.chart svg{width:100%;height:auto;display:block;overflow:visible}
.actions{display:flex;flex-wrap:wrap;gap:9px;padding:14px 16px;border-top:1px solid var(--soft)}
.actions a,.actions button{font-size:.86rem;font-weight:700;text-decoration:none;padding:9px 14px;border-radius:4px;border:2px solid var(--line);color:var(--ink);background:transparent;cursor:pointer}
.actions a:hover,.actions button:hover{border-color:var(--ink)}
footer{margin:42px 0 30px;padding-top:18px;border-top:1px solid var(--line);font-size:.85rem;color:var(--grey)}
footer a{color:var(--blue)}
.spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:s .7s linear infinite;vertical-align:-2px;margin-right:7px}
@keyframes s{to{transform:rotate(360deg)}}
.explain{margin:36px 0}
.explain h2{font-size:1.28rem;margin:26px 0 8px;letter-spacing:-.3px}
.explain h3{font-size:1.02rem;margin:18px 0 5px}
.explain p{color:var(--grey);margin:0 0 12px}
@media(max-width:520px){h1{font-size:1.62rem}.rows{grid-template-columns:1fr}.rows div:nth-child(odd){padding-bottom:0;border-bottom:0}}
</style>
</head>
<body>
<header><div class="wrap"><strong>Bike MOT Check UK</strong><span>Free MOT history, straight from DVSA records</span></div></header>
<main class="wrap">
  <section class="hero">
    <h1>Check any UK vehicle's MOT history, free.</h1>
    <p class="lede">Every test, every mileage reading, every advisory and every failure since 2005. Cars, vans, motorcycles, HGVs and trailers. You also get an automatic buyer's report that flags the things worth arguing about.</p>
    <form id="f">
      <label class="plate" for="reg"><span class="gb">&#9733;<br>GB</span>
        <input id="reg" name="reg" placeholder="AB12 CDE" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="10" aria-label="Vehicle registration" value="__PREFILL__">
      </label>
      <button class="go" id="go" type="submit">Check MOT history</button>
    </form>
    <p class="hint">Type the registration as it appears on the plate. Spaces do not matter.</p>
  </section>
  <div id="out"></div>
  <section class="explain">
    <h2>How to read an MOT history before you buy</h2>
    <p>An MOT record is written by the testing station, not the seller. That makes it the most honest document you will see about a used vehicle, and it is free to check.</p>
    <h3>Mileage is the part that matters most</h3>
    <p>Every test records the odometer reading. Put those readings in order and you get a mileage history nobody can edit. If the number ever drops, or jumps by an implausible amount, something is wrong: a clocked odometer, a replaced instrument cluster, or a mistyped reading. The UK average is around <strong>7,100 miles a year</strong> for a car and roughly <strong>3,000</strong> for a motorcycle, so you can also see whether the vehicle has been worked hard or barely used.</p>
    <h3>Advisories are the seller's future repair bill</h3>
    <p>An advisory is something the tester noticed that is not yet a failure. Tyres near the limit, corrosion starting, a slight play in a bearing. Advisories that appear on several tests in a row and never get fixed tell you how the vehicle has been looked after.</p>
    <h3>Repeat failures are a pattern, not bad luck</h3>
    <p>One brake failure is a worn part. Brake failures on three separate tests is either a fault nobody has properly diagnosed or an owner who waits for the MOT to force a repair. Our report groups the defects so you can see this immediately.</p>
    <h3>Gaps in the history</h3>
    <p>A long gap between tests usually means the vehicle was off the road, declared SORN, or being repaired after an incident. Not automatically a problem, but always worth a question.</p>
    <h2>What this tool does not cover</h2>
    <p>MOT history only. It is not tax, insurance, outstanding finance, or a stolen check. Vehicles under three years old have no MOT yet and will show as not found. Records cover Great Britain from 2005 and Northern Ireland from 2017, with HGVs, buses and trailers from 2018.</p>
    <h2>Common questions</h2>
    <p><strong>Is this really free?</strong> Yes. No account, no card, no trial. The data comes from the DVSA MOT History API under the Open Government Licence.</p>
    <p><strong>Do you store my searches?</strong> No. There is no database and no tracking cookie. Results are held briefly in server memory so repeat searches are fast, and nothing is tied to you.</p>
    <p><strong>Why does it say no record found?</strong> Almost always because the vehicle is under three years old, so it has not had its first MOT. Some imports and personalised plates also return nothing.</p>
    <p><strong>Can I check a motorbike?</strong> Yes. Motorcycles, cars, vans, HGVs, buses and trailers are all in the same dataset.</p>
    <p><strong>Is the mileage guaranteed accurate?</strong> It is the reading the tester entered on the day. Testers occasionally mistype. A single odd figure between otherwise sensible readings is usually a typo, a permanent drop is not.</p>
  </section>
</main>
<footer class="wrap">
  <p><strong>Not affiliated with DVSA or GOV.UK.</strong> Data from the DVSA MOT History API under the <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" rel="noopener">Open Government Licence v3.0</a>. Confirm anything important on <a href="https://www.gov.uk/check-mot-history" rel="noopener">gov.uk</a> before you buy.</p>
  <p>No searches stored, no accounts, no tracking cookies. Built by Ruhul Amin.</p>
</footer>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"WebApplication","name":"Bike MOT Check UK","url":"https://bikemotcheckuk.cloud/","applicationCategory":"UtilitiesApplication","operatingSystem":"Any","inLanguage":"en-GB","description":"Free UK MOT history checker with mileage analysis and an automatic buyer's report.","offers":{"@type":"Offer","price":"0","priceCurrency":"GBP"},"provider":{"@type":"Person","name":"Ruhul Amin"}}
</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
{"@type":"Question","name":"Is this MOT check really free?","acceptedAnswer":{"@type":"Answer","text":"Yes. No account, no card and no trial. The data comes from the DVSA MOT History API under the Open Government Licence."}},
{"@type":"Question","name":"Do you store my searches?","acceptedAnswer":{"@type":"Answer","text":"No. There is no database and no tracking cookie. Results are held briefly in server memory so repeat searches are fast, and nothing is tied to you."}},
{"@type":"Question","name":"Why does it say no MOT record found?","acceptedAnswer":{"@type":"Answer","text":"Almost always because the vehicle is under three years old and has not had its first MOT. Some imports and personalised plates also return nothing."}},
{"@type":"Question","name":"Can I check a motorbike?","acceptedAnswer":{"@type":"Answer","text":"Yes. Motorcycles, cars, vans, HGVs, buses and trailers are all in the same dataset."}},
{"@type":"Question","name":"Is the recorded mileage guaranteed accurate?","acceptedAnswer":{"@type":"Answer","text":"It is the reading the tester entered on the day. A single odd figure between otherwise sensible readings is usually a typo. A permanent drop in mileage is not."}}
]}
</script>
<script>
var UK_CAR_MPY=7100, UK_BIKE_MPY=3000, UK_PASS_RATE=78.3;
var f=document.getElementById('f'),reg=document.getElementById('reg'),out=document.getElementById('out'),go=document.getElementById('go');
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function pd(d){ if(!d) return null; var t=new Date(String(d).slice(0,10).replace(/\./g,'-')); return isNaN(t)?null:t; }
function fmt(d){ var t=pd(d); return t? t.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : esc(d||''); }
function days(d){ var t=pd(d); return t? Math.round((t-new Date())/86400000) : null; }
function num(n){ return (n==null||n==='')?'':Number(n).toLocaleString('en-GB'); }
function row(k,v){ return v?'<div>'+esc(k)+'</div><div>'+esc(v)+'</div>':''; }

f.addEventListener('submit',function(e){ e.preventDefault(); run(); });
function run(){
  var v=reg.value.toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(v.length<2){ out.innerHTML='<div class="msg">Enter a registration to check.</div>'; return; }
  go.disabled=true; go.innerHTML='<span class="spin"></span>Checking';
  out.innerHTML='';
  fetch('/api/mot?reg='+encodeURIComponent(v)).then(function(r){ return r.json().then(function(j){ return {ok:r.ok,j:j}; }); })
  .then(function(x){
    if(!x.ok){ out.innerHTML='<div class="msg">'+esc(x.j.error||'Something went wrong.')+'</div>'; return; }
    render(Array.isArray(x.j)?x.j[0]:x.j, v);
    if(history.replaceState) history.replaceState(null,'','/check/'+v);
  })
  .catch(function(){ out.innerHTML='<div class="msg">Could not complete the check. Please try again.</div>'; })
  .then(function(){ go.disabled=false; go.textContent='Check MOT history'; });
}

/* ---------- the buyer report ---------- */
function analyse(v,tests){
  var flags=[], reads=tests.filter(function(t){return t.odometerValue && t.odometerResultType!=='NO_ODOMETER';})
    .map(function(t){return {d:pd(t.completedDate), m:Number(t.odometerValue), u:t.odometerUnit||'mi'};})
    .filter(function(t){return t.d && !isNaN(t.m);}).sort(function(a,b){return a.d-b.d;});

  /* mileage direction */
  var drop=null;
  for(var i=1;i<reads.length;i++){ if(reads[i].m < reads[i-1].m - 50){ drop={from:reads[i-1],to:reads[i]}; break; } }
  if(drop) flags.push({c:'red',t:'Mileage goes backwards',d:'Recorded '+num(drop.from.m)+' on '+fmt(drop.from.d)+', then '+num(drop.to.m)+' on '+fmt(drop.to.d)+'. Ask about this before anything else. It can be a clocked odometer, a replaced instrument cluster, or a tester typo.'});

  /* average annual mileage */
  if(reads.length>1){
    var first=reads[0], last=reads[reads.length-1];
    var yrs=(last.d-first.d)/(365.25*86400000);
    if(yrs>0.5){
      var mpy=Math.round((last.m-first.m)/yrs);
      var bike=/motorcycle|moped|scooter/i.test(v.vehicleClass||'') || (v.engineSize && Number(v.engineSize)<800 && /motor/i.test(v.make||''));
      var bench=bike?UK_BIKE_MPY:UK_CAR_MPY;
      var pct=Math.round((mpy/bench)*100);
      var c = pct>160?'amber' : (pct<40?'amber':'green');
      flags.push({c:c,t:num(mpy)+' miles a year on average',d:'That is about '+pct+'% of the UK average of '+num(bench)+'. '+(pct>160?'High mileage means more wear, though motorway miles are gentler than town miles.':(pct<40?'Very low mileage. Good in theory, but little used vehicles get seized brakes, perished tyres and tired batteries.':'Broadly normal use.'))});
    }
  }

  /* pass rate */
  if(tests.length>=2){
    var passes=tests.filter(function(t){return /pass/i.test(t.testResult||'');}).length;
    var rate=Math.round((passes/tests.length)*100);
    flags.push({c: rate>=UK_PASS_RATE?'green':(rate>=50?'amber':'red'),
      t:'Passed '+passes+' of '+tests.length+' tests, '+rate+'%',
      d:'The UK average first time pass rate is about '+UK_PASS_RATE+'%. '+(rate<50?'This vehicle fails more often than it passes.':'')});
  }

  /* dangerous defects ever */
  var dang=0;
  tests.forEach(function(t){ (t.defects||t.rfrAndComments||[]).forEach(function(x){ if(/danger/i.test(x.type||'')||x.dangerous) dang++; }); });
  if(dang) flags.push({c:'red',t:dang+' dangerous defect'+(dang===1?'':'s')+' recorded',d:'A dangerous defect means the vehicle should not have been driven away in that condition. Worth asking what was done about it.'});

  /* repeat problems */
  var words=['brake','tyre','suspension','steering','light','lamp','corros','exhaust','emission','wiper','shock','bearing','bush','oil leak','windscreen'];
  var counts={};
  tests.forEach(function(t){ (t.defects||t.rfrAndComments||[]).forEach(function(x){
    var s=String(x.text||'').toLowerCase();
    words.forEach(function(w){ if(s.indexOf(w)>-1){ counts[w]=(counts[w]||0)+1; } });
  }); });
  var rep=Object.keys(counts).filter(function(k){return counts[k]>=3;}).sort(function(a,b){return counts[b]-counts[a];}).slice(0,3);
  if(rep.length) flags.push({c:'amber',t:'Recurring theme: '+rep.map(function(k){return k+' ('+counts[k]+')';}).join(', '),
    d:'The same area has come up repeatedly across tests. That is usually either an unfixed underlying fault or an owner who only repairs at MOT time.'});

  /* gaps */
  for(var g=1;g<reads.length;g++){
    var gap=(reads[g].d-reads[g-1].d)/86400000;
    if(gap>500){ flags.push({c:'amber',t:'Gap of about '+Math.round(gap/30)+' months with no MOT',d:'Between '+fmt(reads[g-1].d)+' and '+fmt(reads[g].d)+'. Usually SORN, stored, or off the road being repaired. Worth a question.'}); break; }
  }
  if(!flags.length) flags.push({c:'grey',t:'Nothing unusual found',d:'No mileage anomalies, repeat faults or dangerous defects in this record.'});
  return {flags:flags, reads:reads};
}

/* ---------- mileage chart ---------- */
function chart(reads){
  if(reads.length<2) return '';
  var W=680,H=210,PL=58,PR=14,PT=14,PB=30;
  var xs=reads.map(function(r){return r.d.getTime();}), ys=reads.map(function(r){return r.m;});
  var x0=Math.min.apply(null,xs), x1=Math.max.apply(null,xs);
  var y0=0, y1=Math.max.apply(null,ys)*1.08;
  function px(t){ return PL + (x1===x0?0:(t-x0)/(x1-x0))*(W-PL-PR); }
  function py(m){ return PT + (1-(m-y0)/(y1-y0))*(H-PT-PB); }
  var pts=reads.map(function(r){return px(r.d.getTime())+','+py(r.m);}).join(' ');
  var dots=reads.map(function(r){
    return '<circle cx="'+px(r.d.getTime()).toFixed(1)+'" cy="'+py(r.m).toFixed(1)+'" r="3.6" fill="var(--green)"><title>'+num(r.m)+' '+esc(r.u)+' on '+fmt(r.d)+'</title></circle>';
  }).join('');
  var grid='', labels='';
  for(var i=0;i<=3;i++){
    var val=y1*i/3, yy=py(val);
    grid+='<line x1="'+PL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-PR)+'" y2="'+yy.toFixed(1)+'" stroke="var(--soft)" stroke-width="1"/>';
    labels+='<text x="'+(PL-8)+'" y="'+(yy+4).toFixed(1)+'" text-anchor="end" font-size="11" fill="var(--grey)">'+num(Math.round(val/1000))+'k</text>';
  }
  var yrA=reads[0].d.getFullYear(), yrB=reads[reads.length-1].d.getFullYear();
  labels+='<text x="'+PL+'" y="'+(H-8)+'" font-size="11" fill="var(--grey)">'+yrA+'</text>';
  labels+='<text x="'+(W-PR)+'" y="'+(H-8)+'" text-anchor="end" font-size="11" fill="var(--grey)">'+yrB+'</text>';
  return '<div class="card"><h2>Mileage over time</h2><div class="chart"><svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Recorded mileage at each MOT test">'+
    grid+'<polyline points="'+pts+'" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linejoin="round"/>'+dots+labels+'</svg></div></div>';
}
</script>
<script>
function render(v,regCode){
  if(!v){ out.innerHTML='<div class="msg">No record returned.</div>'; return; }
  var tests=(v.motTests||[]).slice().sort(function(a,b){ return String(b.completedDate).localeCompare(String(a.completedDate)); });
  var latest=null;
  for(var i=0;i<tests.length;i++){ if(/pass/i.test(tests[i].testResult||'')){ latest=tests[i]; break; } }
  if(!latest) latest=tests[0];
  var name=[v.make,v.model].filter(Boolean).join(' ')||'Vehicle';
  var h='';

  /* MOT status banner */
  var exp = (latest&&latest.expiryDate) ? latest.expiryDate : v.motTestDueDate;
  var d = days(exp);
  if(v.motTestDueDate && !tests.length){
    h+='<div class="card"><div class="status warn">First MOT due '+fmt(v.motTestDueDate)+'. No tests on record yet.</div></div>';
  } else if(d!=null){
    h+='<div class="card"><div class="status '+(d<0?'bad':(d<30?'warn':'ok'))+'">'+
      (d<0 ? 'MOT expired '+Math.abs(d)+' day'+(Math.abs(d)===1?'':'s')+' ago, on '+fmt(exp)
           : 'MOT valid until '+fmt(exp)+' &middot; '+d+' day'+(d===1?'':'s')+' left')+'</div>'+
      '<div class="actions">'+
        '<a href="/calendar/'+encodeURIComponent(regCode)+'.ics?d='+encodeURIComponent(String(exp).slice(0,10))+'&v='+encodeURIComponent(name)+'">Add MOT date to calendar</a>'+
        '<button type="button" class="js-share" data-reg="'+esc(regCode)+'">Copy link to this check</button>'+
        '<button type="button" onclick="window.print()">Print or save as PDF</button>'+
      '</div></div>';
  }

  /* buyer report */
  var a=analyse(v,tests);
  h+='<div class="card"><h2>Buyer report for '+esc(regCode)+'</h2><ul class="flags">'+
     a.flags.map(function(x){ return '<li><span class="dot d-'+x.c+'"></span><div><b>'+esc(x.t)+'</b><span>'+esc(x.d)+'</span></div></li>'; }).join('')+
     '</ul></div>';

  /* vehicle details */
  h+='<div class="card"><h2>'+esc(name)+' &middot; '+esc(v.registration||regCode)+'</h2><div class="rows">'+
     row('Make',v.make)+row('Model',v.model)+row('Colour',v.primaryColour)+row('Fuel',v.fuelType)+
     row('Engine size',v.engineSize?num(v.engineSize)+' cc':'')+row('First used',fmt(v.firstUsedDate))+
     row('Registered',fmt(v.registrationDate))+row('Manufactured',fmt(v.manufactureDate))+
     row('MOT tests on record',tests.length?String(tests.length):'')+
     '</div></div>';

  /* chart */
  h+=chart(a.reads);

  /* full history */
  if(tests.length){
    h+='<div class="card"><h2>Every MOT test</h2>'+tests.map(function(t){
      var pass=/pass/i.test(t.testResult||'');
      var ds=(t.defects||t.rfrAndComments||[]);
      return '<div class="test"><div class="top"><span class="pill '+(pass?'p-pass':'p-fail')+'">'+esc(t.testResult||'')+'</span><span>'+fmt(t.completedDate)+'</span></div>'+
        '<p class="meta">'+(t.odometerValue?num(t.odometerValue)+' '+esc(t.odometerUnit||'mi'):'No mileage recorded')+
        (t.expiryDate?' &middot; valid to '+fmt(t.expiryDate):'')+
        (t.motTestNumber?' &middot; test '+esc(t.motTestNumber):'')+'</p>'+
        (ds.length?'<ul class="defects">'+ds.map(function(x){
          var ty=String(x.type||'').replace(/[^A-Za-z]/g,'').toUpperCase();
          return '<li class="'+ty+'"><span class="tag">'+esc(x.type||'')+(x.dangerous?' &middot; DANGEROUS':'')+'</span>'+esc(x.text)+'</li>';
        }).join('')+'</ul>':'')+'</div>';
    }).join('')+'</div>';
  }
  out.innerHTML=h;
  out.scrollIntoView({behavior:'smooth',block:'start'});
}
function shareIt(r){
  var url='https://bikemotcheckuk.cloud/check/'+r;
  if(navigator.share){ navigator.share({title:'MOT history for '+r,url:url}).catch(function(){}); return; }
  if(navigator.clipboard){ navigator.clipboard.writeText(url).then(function(){ alert('Link copied:\n'+url); }); }
  else { prompt('Copy this link', url); }
}
out.addEventListener('click',function(e){ var b=e.target.closest('.js-share'); if(b) shareIt(b.getAttribute('data-reg')); });
reg.addEventListener('input',function(){ reg.value=reg.value.toUpperCase(); });
if(reg.value.trim().length>1){ run(); }
</script>
</body>
</html>`;


const server = http.createServer(async (req,res)=>{
  const u = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for']||'').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const p = u.pathname;

  if(p === '/healthz') return send(res,200,{ok:true});
  if(p === '/robots.txt') return send(res,200,'User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://bikemotcheckuk.cloud/sitemap.xml\n','text/plain; charset=utf-8');
  if(p === '/sitemap.xml') return send(res,200,'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://bikemotcheckuk.cloud/</loc><priority>1.0</priority><changefreq>weekly</changefreq></url></urlset>\n','application/xml; charset=utf-8');

  if(p === '/api/mot'){
    const reg = cleanReg(u.searchParams.get('reg'));
    if(!VALID_REG.test(reg)) return send(res,400,{error:'Enter a valid UK registration.'});
    if(!allow(ip)) return send(res,429,{error:'Too many lookups from this connection. Please try again later.'});
    try{
      const data = await lookup(reg);
      if(data.notFound) return send(res,404,{error:'No MOT record found for '+reg+'. Vehicles under three years old have no MOT yet, and some imports are missing.'});
      return send(res,200,data);
    }catch(e){
      console.error('lookup failed', reg, e.code||'', e.message);
      if(e.code===429) return send(res,429,{error:'The DVSA service is busy. Try again in a minute.'});
      return send(res,502,{error:'Could not reach the DVSA service. Please try again shortly.'});
    }
  }

  if(p.indexOf('/calendar/')===0){
    const reg = cleanReg(p.slice(10).replace(/\.ics$/,''));
    const d = u.searchParams.get('d')||'';
    const label = (u.searchParams.get('v')||'').slice(0,40).replace(/[^\w \-]/g,'');
    if(!VALID_REG.test(reg) || !/^\d{4}[.\-]?\d{2}[.\-]?\d{2}/.test(d)) return send(res,400,{error:'bad request'});
    return send(res,200,ics(reg,d,label),'text/calendar; charset=utf-8',{'Content-Disposition':'attachment; filename="mot-'+reg+'.ics"'});
  }

  /* shareable permalink, /check/AB12CDE */
  if(p.indexOf('/check/')===0){
    const reg = cleanReg(p.slice(7));
    if(!VALID_REG.test(reg)) return send(res,302,'','text/plain',{Location:'/'});
    return send(res,200,PAGE.replace('__PREFILL__', reg),'text/html; charset=utf-8');
  }

  if(p === '/' || p === '/index.html') return send(res,200,PAGE.replace('__PREFILL__',''),'text/html; charset=utf-8');
  return send(res,404,PAGE.replace('__PREFILL__',''),'text/html; charset=utf-8');
});

server.listen(PORT, ()=> console.log('MOT checker listening on ' + PORT));
