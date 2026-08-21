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
<meta name="google-site-verification" content="KhRBFVP7OVrVE72qDvl89_7zPquRjgVfkbOfVHh3Y6w">
<meta name="msvalidate.01" content="5FFD67C969758EBF56D9070C84A31597">
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
<section class='card' style='margin:26px 0'>
<h2 style='margin-top:0'>MOT guides</h2>
<p>Plain English, sourced from GOV.UK and DVSA. No hype, and we say plainly when something does not matter.</p>
<ul>
<li><a href='/guides/what-fails-an-mot-uk'>What actually fails an MOT, and what it costs to put right</a></li>
<li><a href='/guides/spot-a-clocked-car-uk'>How to spot a clocked car before you hand over the money</a></li>
<li><a href='/guides/mot-rules-fines-uk'>MOT rules in plain English: when it is due, and what you get fined</a></li>
<li><a href='/guides/mot-defect-categories-uk'>Dangerous, major, minor and advisory: what your result means</a></li>
</ul>
<p><a href='/guides'>See all guides</a></p>
</section>
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
var $=function(s){return document.querySelector(s)};
var ST=document.createElement('style');
ST.textContent='.js-share{cursor:pointer;border:1px solid #cfd8d3;background:#fff;border-radius:8px;padding:8px 14px;font:inherit;font-size:14px}.js-share:hover{background:#f2f7f5}.chartwrap{margin:14px 0;padding:8px 0}.flag{display:flex;gap:10px;align-items:flex-start;margin:10px 0}.flag p{margin:2px 0 0}.dot{width:12px;height:12px;border-radius:50%;flex:0 0 12px;margin-top:5px}.d-green{background:#0a8f5b}.d-amber{background:#d18a00}.d-red{background:#d33}.icsbtn{display:inline-block;margin-top:8px;font-size:14px}.tag.dang{background:#d33;color:#fff}';
document.head.appendChild(ST);
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function num(v){var n=parseInt(String(v==null?'':v).replace(/[^0-9]/g,''),10);return isNaN(n)?null:n}
function dt(s){if(!s)return null;var x=new Date(s);return isNaN(x.getTime())?null:x}
var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmt(s){var x=dt(s);if(!x)return '';return x.getDate()+' '+MON[x.getMonth()]+' '+x.getFullYear()}
function mi(t){var n=num(t.odometerValue);if(n==null)return null;var u=String(t.odometerUnit==null?'':t.odometerUnit).toUpperCase();if(u.charAt(0)==='K')n=Math.round(n*0.621371);return n}
function cm(n){return String(n).replace(/(.)(?=(...)+$)/g,'$1,')}
var BIKES=['honda','yamaha','suzuki','kawasaki','ducati','ktm','triumph','harley-davidson','aprilia','piaggio','vespa','lexmoto','sinnis','royal enfield','moto guzzi','husqvarna','benelli','keeway','zontes','mutt','herald','fantic','sym','kymco'];
function isBike(v){var m=String(v.make==null?'':v.make).toLowerCase();if(BIKES.indexOf(m)===-1)return false;var e=num(v.engineSize);if(e==null)return true;return e<1400}
var UK_CAR=7100, UK_BIKE=3000, UK_PASS=78.3;
function analyse(v){
 var raw=(v.motTests||[]).slice();
 var tests=raw.filter(function(t){return !!t.completedDate});
 tests.sort(function(a,b){return new Date(a.completedDate)-new Date(b.completedDate)});
 var total=tests.length;
 var passed=0; tests.forEach(function(t){ if(String(t.testResult||'').toUpperCase().indexOf('PASS')===0) passed++ });
 var passRate= total? Math.round(passed/total*1000)/10 : null;
 var pts=[]; tests.forEach(function(t){ var m=mi(t); var x=dt(t.completedDate); if(m!=null&&x&&m>0) pts.push({t:x.getTime(),m:m,date:t.completedDate}) });
 var back=[]; for(var i=1;i<pts.length;i++){ if(pts[i].m < pts[i-1].m-100){ pts[i].back=true; back.push({a:pts[i-1],b:pts[i]}) } }
 var apm=null; if(pts.length>=2){ var yrs=(pts[pts.length-1].t-pts[0].t)/31557600000; var dm=pts[pts.length-1].m-pts[0].m; if(yrs>0.5&&dm>0) apm=Math.round(dm/yrs) }
 var dang=0, defs=[]; tests.forEach(function(t){ (t.defects||[]).forEach(function(x){ if(x.dangerous) dang++; defs.push(String(x.text||'').toLowerCase()) }) });
 var kws=['tyre','brake','suspension','lamp','light','corros','exhaust','steering','emission','wiper','mirror','shock','leak','play','bulb'];
 var themes=[]; kws.forEach(function(k){ var n=0; defs.forEach(function(s){ if(s.indexOf(k)>-1) n++ }); if(n>=3) themes.push({k:k,n:n}) });
 themes.sort(function(a,b){return b.n-a.n});
 var gaps=[]; for(var g=1;g<tests.length;g++){ var a1=dt(tests[g-1].completedDate), b1=dt(tests[g].completedDate); if(a1&&b1){ var days=Math.round((b1-a1)/86400000); if(days>430) gaps.push({from:tests[g-1].completedDate,to:tests[g].completedDate,days:days}) } }
 var expiry=null; raw.forEach(function(t){ if(t.expiryDate){ if(!expiry||t.expiryDate>expiry) expiry=t.expiryDate } });
 var bike=isBike(v);
 return {tests:tests,total:total,passed:passed,passRate:passRate,pts:pts,back:back,apm:apm,dang:dang,themes:themes,gaps:gaps,expiry:expiry,bike:bike,bench:bike?UK_BIKE:UK_CAR,latest:pts.length?pts[pts.length-1].m:null};
}
function chart(pts){
 if(!pts||pts.length<2) return '';
 var W=680,H=230,P=44;
 var xs=[],ys=[]; pts.forEach(function(p){xs.push(p.t);ys.push(p.m)});
 var x0=Math.min.apply(null,xs), x1=Math.max.apply(null,xs); if(x1===x0) return '';
 var y1=Math.max.apply(null,ys)*1.08;
 var px=function(t){return P+(t-x0)/(x1-x0)*(W-P-18)};
 var py=function(m){return H-30-(m/y1)*(H-30-16)};
 var path=''; pts.forEach(function(p,i){ path+=(i?' L':'M')+px(p.t).toFixed(1)+' '+py(p.m).toFixed(1) });
 var dots=''; pts.forEach(function(p){ dots+='<circle cx="'+px(p.t).toFixed(1)+'" cy="'+py(p.m).toFixed(1)+'" r="3.6" fill="'+(p.back?'#d33':'#0a8f5b')+'"></circle>' });
 var grid=''; for(var k=0;k<=3;k++){ var vv=y1*k/3, yy=py(vv); grid+='<line x1="'+P+'" y1="'+yy.toFixed(1)+'" x2="'+(W-18)+'" y2="'+yy.toFixed(1)+'" stroke="#e6e6e6" stroke-width="1"></line><text x="2" y="'+(yy+4).toFixed(1)+'" fill="#8a8a8a" font-size="11">'+Math.round(vv/1000)+'k</text>' }
 var lab='<text x="'+P+'" y="'+(H-8)+'" fill="#8a8a8a" font-size="11">'+new Date(x0).getFullYear()+'</text><text x="'+(W-44)+'" y="'+(H-8)+'" fill="#8a8a8a" font-size="11">'+new Date(x1).getFullYear()+'</text>';
 return '<div class="chartwrap"><h3>Recorded mileage over time</h3><svg viewBox="0 0 '+W+' '+H+'" width="100%" role="img" aria-label="Recorded mileage over time">'+grid+lab+'<path d="'+path+'" fill="none" stroke="#0a8f5b" stroke-width="2.5"></path>'+dots+'</svg></div>';
}
function flagsOf(a,v){
 var f=[];
 if(a.back.length){ f.push({c:'red',t:'Recorded mileage goes backwards',d:'On '+fmt(a.back[0].b.date)+' the reading was '+cm(a.back[0].b.m)+' miles, lower than '+cm(a.back[0].a.m)+' recorded on '+fmt(a.back[0].a.date)+'. That can be a clerical error, a replaced instrument cluster, or a clocked vehicle. Ask the seller for the explanation in writing.'}); }
 else if(a.pts.length>=2){ f.push({c:'green',t:'Mileage reads consistently forward',d:'Every recorded reading is equal to or higher than the one before it across '+a.pts.length+' tests.'}); }
 if(a.apm!=null){ var pc=Math.round(a.apm/a.bench*100); var c= pc>150?'amber':(pc<45?'amber':'green');
  f.push({c:c,t:'About '+cm(a.apm)+' miles a year',d:'The UK average is roughly '+cm(a.bench)+' miles a year for a '+(a.bike?'motorcycle':'car')+', so this is around '+pc+'% of typical use. '+(pc>150?'High mileage is not automatically bad, but expect more wear on the clutch, suspension and bushes.':(pc<45?'Very low mileage can mean short cold journeys, which is hard on the exhaust, brakes and battery.':'That is in the normal range.'))}); }
 if(a.passRate!=null){ var pcOk=a.passRate>=UK_PASS;
  f.push({c:pcOk?'green':'amber',t:'Passed '+a.passed+' of '+a.total+' tests, '+a.passRate+'%',d:'The UK average first time pass rate is about '+UK_PASS+'%. '+(pcOk?'This vehicle is at or above that.':'This vehicle is below that, so budget for repair work at test time.')}); }
 if(a.dang>0){ f.push({c:'red',t:a.dang+' dangerous defect'+(a.dang>1?'s':'')+' recorded',d:'A dangerous defect means the vehicle should not have been driven until it was repaired. Ask what was done and whether there is a receipt.'}); }
 if(a.themes.length){ var s=a.themes.slice(0,3).map(function(x){return x.k+' ('+x.n+')'}).join(', ');
  f.push({c:'amber',t:'Recurring theme: '+s,d:'The same area has come up repeatedly across tests. That is usually either an unfixed underlying fault or an owner who only repairs at MOT time.'}); }
 if(a.gaps.length){ f.push({c:'amber',t:'Gap of '+a.gaps[0].days+' days between tests',d:'Between '+fmt(a.gaps[0].from)+' and '+fmt(a.gaps[0].to)+' there is no MOT record. The vehicle may have been off the road, declared SORN, or driven untested.'}); }
 if(v.hasOutstandingRecall==='Yes'){ f.push({c:'red',t:'Outstanding safety recall',d:'DVSA records an unresolved manufacturer recall. A franchised dealer will normally fix this free of charge.'}); }
 return f;
}
function render(v){
 var out=$('#out');
 if(!v || v.error){ out.innerHTML='<div class="card"><p><strong>'+esc(v&&v.error?v.error:'No record found')+'</strong></p><p class="meta">Check the registration and try again. DVSA holds MOT records for vehicles tested in England, Scotland and Wales. Northern Ireland is not covered.</p></div>'; return }
 var a=analyse(v);
 var reg=String(v.registration||'').toUpperCase();
 var name=String(v.make||'')+' '+String(v.model||'');
 document.title=reg+' MOT history, mileage and failures | Bike MOT Check UK';
 var h='';
 h+='<div class="card"><div class="top"><div><h2>'+esc(name)+'</h2><p class="meta">'+esc(reg)+(v.primaryColour?' &middot; '+esc(v.primaryColour):'')+(v.fuelType?' &middot; '+esc(v.fuelType):'')+(v.engineSize?' &middot; '+esc(v.engineSize)+'cc':'')+(v.firstUsedDate?' &middot; first used '+fmt(v.firstUsedDate):'')+'</p></div>';
 h+='<div><button type="button" class="js-share" data-reg="'+esc(reg)+'">Share this check</button></div></div>';
 h+='<h3>Buyer report for '+esc(reg)+'</h3><div class="flags">';
 flagsOf(a,v).forEach(function(f){ h+='<div class="flag"><span class="dot d-'+f.c+'"></span><div><strong>'+esc(f.t)+'</strong><p class="meta">'+esc(f.d)+'</p></div></div>' });
 h+='</div>';
 if(a.latest!=null) h+='<p class="meta">Latest recorded mileage: <strong>'+cm(a.latest)+' miles</strong></p>';
 if(a.expiry){ var ex=dt(a.expiry); var days=ex?Math.round((ex-new Date())/86400000):null;
  h+='<p class="meta">MOT valid until <strong>'+fmt(a.expiry)+'</strong>'+(days!=null?(days>=0?' ('+days+' days left)':' (expired '+Math.abs(days)+' days ago)'):'')+'</p>';
  h+='<a class="icsbtn" href="/calendar/'+encodeURIComponent(reg)+'.ics?d='+encodeURIComponent(a.expiry)+'&v='+encodeURIComponent(name.trim())+'">Add MOT reminder to calendar</a>'; }
 h+=chart(a.pts);
 h+='</div>';
 h+='<div class="rows"><h3>Full MOT history, '+a.total+' tests</h3>';
 a.tests.slice().reverse().forEach(function(t){
  var p=String(t.testResult||'').toUpperCase().indexOf('PASS')===0;
  var m=mi(t);
  h+='<div class="test"><div class="top"><span class="pill '+(p?'p-pass':'p-fail')+'">'+(p?'PASS':'FAIL')+'</span> <strong>'+fmt(t.completedDate)+'</strong></div>';
  h+='<p class="meta">'+(m!=null?cm(m)+' miles':'no odometer reading')+(t.expiryDate?' &middot; valid to '+fmt(t.expiryDate):'')+'</p>';
  if(t.defects&&t.defects.length){ h+='<ul class="defects">'; t.defects.forEach(function(x){ h+='<li><span class="tag'+(x.dangerous?' dang':'')+'">'+esc(String(x.type||'').replace(/_/g,' '))+(x.dangerous?' DANGEROUS':'')+'</span> '+esc(x.text||'')+'</li>' }); h+='</ul>' }
  h+='</div>';
 });
 h+='</div>';
 out.innerHTML=h;
}
function toast(m){ var e=document.createElement('div'); e.textContent=m; e.setAttribute('style','position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111;color:#fff;padding:10px 16px;border-radius:8px;z-index:9999;font-size:14px'); document.body.appendChild(e); setTimeout(function(){ if(e.parentNode) e.parentNode.removeChild(e) },1800) }
function shareIt(reg){ var url=location.origin+'/check/'+encodeURIComponent(reg);
 if(navigator.share){ navigator.share({title:'MOT history for '+reg, url:url}).catch(function(){}); return }
 if(navigator.clipboard){ navigator.clipboard.writeText(url).then(function(){ toast('Link copied') }).catch(function(){ prompt('Copy this link', url) }); return }
 prompt('Copy this link', url); }
document.addEventListener('click',function(e){ var b=e.target.closest?e.target.closest('.js-share'):null; if(b){ shareIt(b.getAttribute('data-reg')) } });
function run(){ var el=$('#reg'); var reg=String(el.value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 if(reg.length<2) return;
 $('#out').innerHTML='<div class="card"><p>Checking '+esc(reg)+' with DVSA...</p></div>';
 fetch('/api/mot?reg='+encodeURIComponent(reg)).then(function(r){return r.json()}).then(render).catch(function(){ $('#out').innerHTML='<div class="card"><p>Could not reach the DVSA service just now. Please try again in a moment.</p></div>' }); }
$('#f').addEventListener('submit',function(e){ e.preventDefault(); run() });
$('#reg').addEventListener('input',function(){ this.value=this.value.toUpperCase() });
if(location.pathname.indexOf('/check/')===0 && !$('#reg').value){ $('#reg').value=decodeURIComponent(location.pathname.slice(7)).toUpperCase() }
if(String($('#reg').value||'').trim().length>1){ run() }
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
