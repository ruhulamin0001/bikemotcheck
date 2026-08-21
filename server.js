const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 8080;
const CLIENT_ID = process.env.DVSA_CLIENT_ID;
const CLIENT_SECRET = process.env.DVSA_CLIENT_SECRET;
const API_KEY = process.env.DVSA_API_KEY;
const TOKEN_URL = process.env.DVSA_TOKEN_URL;
const SCOPE = process.env.DVSA_SCOPE;
const SITE = 'https://bikemotcheckuk.cloud';
const GSC = 'KhRBFVP7OVrVE72qDvl89_7zPquRjgVfkbOfVHh3Y6w';
const BING = '5FFD67C969758EBF56D9070C84A31597';

function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function cleanReg(s){ return String(s==null?'':s).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12); }

var tokenValue = null, tokenExpiry = 0, tokenPending = null;
function postForm(urlStr, body){
  return new Promise(function(resolve, reject){
    var u = new URL(urlStr);
    var data = Buffer.from(body, 'utf8');
    var req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type':'application/x-www-form-urlencoded', 'Content-Length': data.length }
    }, function(res){
      var chunks = [];
      res.on('data', function(c){ chunks.push(c); });
      res.on('end', function(){ resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    req.setTimeout(15000, function(){ req.destroy(new Error('token timeout')); });
    req.end(data);
  });
}
function getToken(){
  var now = Date.now();
  if (tokenValue && now < tokenExpiry) return Promise.resolve(tokenValue);
  if (tokenPending) return tokenPending;
  var form = 'grant_type=client_credentials'
    + '&client_id=' + encodeURIComponent(CLIENT_ID)
    + '&client_secret=' + encodeURIComponent(CLIENT_SECRET)
    + '&scope=' + encodeURIComponent(SCOPE);
  tokenPending = postForm(TOKEN_URL, form).then(function(r){
    tokenPending = null;
    if (r.status !== 200) throw new Error('token http ' + r.status);
    var j = JSON.parse(r.body);
    tokenValue = j.access_token;
    tokenExpiry = Date.now() + ((j.expires_in || 3600) - 300) * 1000;
    return tokenValue;
  }).catch(function(e){ tokenPending = null; throw e; });
  return tokenPending;
}

var lastCall = 0;
function paced(){
  var wait = Math.max(0, 120 - (Date.now() - lastCall));
  lastCall = Date.now() + wait;
  return new Promise(function(r){ setTimeout(r, wait); });
}

var cache = {};
function cacheGet(k){ var e = cache[k]; if (e && Date.now() < e.exp) return e.val; if (e) delete cache[k]; return null; }
function cacheSet(k, v){ cache[k] = { val: v, exp: Date.now() + 6*3600*1000 };
  var keys = Object.keys(cache); if (keys.length > 5000) { for (var i=0;i<1000;i++) delete cache[keys[i]]; } }

var hits = {};
function allowed(ip){
  var now = Date.now(), h = hits[ip];
  if (!h || now > h.reset) { hits[ip] = { n: 1, reset: now + 3600*1000 }; return true; }
  h.n++; return h.n <= 40;
}

function apiGet(reg, token){
  return new Promise(function(resolve, reject){
    var req = https.request({
      hostname: 'history.mot.api.gov.uk',
      path: '/v1/trade/vehicles/registration/' + encodeURIComponent(reg),
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'X-API-Key': API_KEY, 'Accept': 'application/json' }
    }, function(res){
      var chunks = [];
      res.on('data', function(c){ chunks.push(c); });
      res.on('end', function(){ resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    req.setTimeout(20000, function(){ req.destroy(new Error('api timeout')); });
    req.end();
  });
}

function lookup(reg){
  var hit = cacheGet(reg);
  if (hit) return Promise.resolve(hit);
  return getToken().then(function(tok){
    return paced().then(function(){ return apiGet(reg, tok); });
  }).then(function(r){
    if (r.status === 404) { var nf = { error: 'No MOT record found for ' + reg + '. Vehicles under three years old have no MOT yet, and some imports are missing.' }; cacheSet(reg, nf); return nf; }
    if (r.status === 200) { var j = JSON.parse(r.body); cacheSet(reg, j); return j; }
    if (r.status === 401 || r.status === 403) { tokenValue = null; tokenExpiry = 0; }
    return { error: 'The DVSA service returned an error (' + r.status + '). Please try again shortly.', transient: true };
  });
}

function pad(n){ return n < 10 ? '0' + n : String(n); }
function icsStamp(d){ return d.getUTCFullYear() + pad(d.getUTCMonth()+1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00Z'; }
function icsDate(d){ return d.getUTCFullYear() + pad(d.getUTCMonth()+1) + pad(d.getUTCDate()); }
function buildIcs(reg, dateStr, vehicle){
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  var end = new Date(d.getTime() + 86400000);
  var title = 'MOT due: ' + reg + (vehicle ? ' (' + vehicle + ')' : '');
  return [
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Bike MOT Check UK//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + reg + '-' + icsDate(d) + '@bikemotcheckuk.cloud',
    'DTSTAMP:' + icsStamp(new Date()),
    'DTSTART;VALUE=DATE:' + icsDate(d),
    'DTEND;VALUE=DATE:' + icsDate(end),
    'SUMMARY:' + title,
    'DESCRIPTION:The MOT certificate for ' + reg + ' expires on this date. Book the test up to one month minus a day early to keep the same renewal date.',
    'URL:' + SITE + '/check/' + reg,
    'BEGIN:VALARM','TRIGGER:-P21D','ACTION:DISPLAY','DESCRIPTION:' + title,'END:VALARM',
    'BEGIN:VALARM','TRIGGER:-P7D','ACTION:DISPLAY','DESCRIPTION:' + title,'END:VALARM',
    'END:VEVENT','END:VCALENDAR',''
  ].join('\r\n');
}

const ICON_SVG = [
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
'<stop offset="0" stop-color="#6366f1"/><stop offset="0.55" stop-color="#8b5cf6"/><stop offset="1" stop-color="#14b8a6"/>',
'</linearGradient></defs>',
'<rect width="64" height="64" rx="14" fill="url(#g)"/>',
'<path d="M14 39c0-9.4 7.6-17 17-17h2c9.4 0 17 7.6 17 17" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity="0.55"/>',
'<path d="M32 39 44 27" stroke="#fff" stroke-width="5" stroke-linecap="round"/>',
'<circle cx="32" cy="39" r="4.5" fill="#fff"/>',
'<rect x="18" y="45" width="28" height="5" rx="2.5" fill="#fff" opacity="0.85"/>',
'</svg>'
].join('');

const CSS = [
':root{--ink:#0e1117;--mut:#5b6472;--line:rgba(15,23,42,.10);--glass:rgba(255,255,255,.72);--card:#fff;',
'--i1:#6366f1;--i2:#8b5cf6;--i3:#14b8a6;--ok:#0f9d63;--warn:#c98a00;--bad:#e0453f;--r:16px}',
'@media(prefers-color-scheme:dark){:root{--ink:#e9edf3;--mut:#93a0b4;--line:rgba(255,255,255,.10);',
'--glass:rgba(20,26,36,.66);--card:#141a24;--ok:#28c98a;--warn:#e8ad2a;--bad:#ff6b66}}',
'*{box-sizing:border-box}',
'html{scroll-behavior:smooth}',
'body{margin:0;color:var(--ink);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
'background:#f6f7fb;overflow-x:hidden;-webkit-font-smoothing:antialiased}',
'@media(prefers-color-scheme:dark){body{background:#0a0e14}}',
'.mesh{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none}',
'.mesh i{position:absolute;display:block;border-radius:50%;filter:blur(70px);opacity:.42;animation:float 22s ease-in-out infinite}',
'.mesh i:nth-child(1){width:46vw;height:46vw;background:#6366f1;top:-12vw;left:-8vw}',
'.mesh i:nth-child(2){width:38vw;height:38vw;background:#14b8a6;top:6vw;right:-10vw;animation-delay:-7s}',
'.mesh i:nth-child(3){width:34vw;height:34vw;background:#8b5cf6;top:52vw;left:24vw;animation-delay:-14s}',
'@keyframes float{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(4vw,-3vw) scale(1.08)}66%{transform:translate(-3vw,4vw) scale(.94)}}',
'@media(prefers-reduced-motion:reduce){.mesh i{animation:none}*{transition:none!important}}',
'.wrap{max-width:940px;margin:0 auto;padding:0 20px}',
'header.site{position:sticky;top:0;z-index:50;backdrop-filter:saturate(180%) blur(14px);-webkit-backdrop-filter:saturate(180%) blur(14px);',
'background:var(--glass);border-bottom:1px solid var(--line)}',
'header.site .wrap{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 20px}',
'.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink);font-weight:750;letter-spacing:-.02em}',
'.brand svg{width:30px;height:30px;border-radius:9px;display:block}',
'.nav{display:flex;gap:18px;align-items:center;font-size:14.5px}',
'.nav a{color:var(--mut);text-decoration:none;font-weight:600}.nav a:hover{color:var(--ink)}',
'.hero{padding:56px 0 12px;text-align:center}',
'h1{font-size:clamp(30px,5.4vw,52px);line-height:1.06;letter-spacing:-.035em;margin:0 0 14px;font-weight:800}',
'.grad{background:linear-gradient(100deg,var(--i1),var(--i2) 45%,var(--i3));-webkit-background-clip:text;background-clip:text;color:transparent}',
'.sub{font-size:clamp(16px,2.1vw,19px);color:var(--mut);max-width:640px;margin:0 auto 26px}',
'.trust{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:20px 0 0}',
'.trust span{font-size:13px;font-weight:600;color:var(--mut);background:var(--glass);border:1px solid var(--line);',
'padding:6px 12px;border-radius:99px;backdrop-filter:blur(8px)}',
'form.search{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:0 auto;max-width:640px}',
'.plate{display:flex;align-items:stretch;border-radius:12px;overflow:hidden;border:2px solid #0b0b0b;',
'box-shadow:0 12px 34px rgba(15,23,42,.16);flex:1 1 340px;min-width:280px;transition:transform .18s,box-shadow .18s}',
'.plate:focus-within{transform:translateY(-2px);box-shadow:0 18px 44px rgba(99,102,241,.34)}',
'.plate .gb{background:#063298;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;',
'padding:0 9px;font-size:10px;font-weight:800;letter-spacing:.06em;line-height:1.15}',
'.plate .gb b{font-size:13px;line-height:1}',
'.plate input{flex:1;border:0;outline:0;background:#ffd400;color:#0b0b0b;font-weight:800;',
'font-size:clamp(24px,4.4vw,34px);letter-spacing:.10em;text-align:center;text-transform:uppercase;padding:14px 10px;min-width:0}',
'.plate input::placeholder{color:#9a8300}',
'.btn{border:0;cursor:pointer;font:inherit;font-weight:700;font-size:16px;color:#fff;padding:0 26px;border-radius:12px;',
'background:linear-gradient(100deg,var(--i1),var(--i2));box-shadow:0 10px 26px rgba(99,102,241,.36);',
'transition:transform .16s,box-shadow .16s,filter .16s;flex:0 0 auto;min-height:56px}',
'.btn:hover{transform:translateY(-2px);box-shadow:0 16px 34px rgba(99,102,241,.46);filter:brightness(1.05)}',
'.btn:active{transform:translateY(0)}',
'.btn[disabled]{opacity:.6;cursor:not-allowed;transform:none}',
'.btn.ghost{background:transparent;color:var(--i1);border:1.5px solid var(--line);box-shadow:none;padding:9px 16px;min-height:0;font-size:14.5px}',
'.btn.ghost:hover{border-color:var(--i1);transform:none;box-shadow:none}',
'.hint{font-size:13.5px;color:var(--mut);text-align:center;margin:12px 0 0}',
'.recent{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:16px 0 0}',
'.chip{cursor:pointer;border:1px solid var(--line);background:var(--glass);backdrop-filter:blur(8px);border-radius:99px;',
'padding:6px 13px;font-size:13.5px;font-weight:700;letter-spacing:.05em;color:var(--ink);transition:.16s}',
'.chip:hover{border-color:var(--i1);color:var(--i1);transform:translateY(-1px)}',
'.chip.lbl{cursor:default;background:none;border:0;color:var(--mut);font-weight:600;letter-spacing:0}',
'.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:22px 24px;margin:18px 0;',
'box-shadow:0 4px 22px rgba(15,23,42,.055)}',
'.card.glass{background:var(--glass);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}',
'.card h2{margin-top:0}',
'section{animation:rise .5s cubic-bezier(.22,1,.36,1) both}',
'@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}',
'h2{font-size:clamp(20px,2.7vw,26px);letter-spacing:-.02em;margin:34px 0 12px}',
'h3{font-size:17.5px;margin:20px 0 8px;letter-spacing:-.01em}',
'.meta{color:var(--mut);font-size:14px}',
'a{color:var(--i1)}',
'.vhead{display:flex;flex-wrap:wrap;align-items:center;gap:14px;justify-content:space-between}',
'.vhead h2{margin:0;font-size:clamp(21px,3vw,29px)}',
'.miniplate{display:inline-flex;align-items:center;border-radius:6px;overflow:hidden;border:1.5px solid #0b0b0b;font-weight:800}',
'.miniplate .gb{background:#063298;color:#fff;font-size:8px;padding:3px 5px;line-height:1.1;text-align:center}',
'.miniplate .no{background:#ffd400;color:#0b0b0b;padding:3px 9px;letter-spacing:.07em;font-size:15px}',
'.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0}',
'.stat{background:var(--glass);border:1px solid var(--line);border-radius:13px;padding:14px 16px;backdrop-filter:blur(10px)}',
'.stat .k{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--mut)}',
'.stat .v{font-size:26px;font-weight:800;letter-spacing:-.03em;margin-top:3px;line-height:1.15}',
'.stat .n{font-size:12.5px;color:var(--mut);margin-top:2px}',
'.v.ok{color:var(--ok)}.v.warn{color:var(--warn)}.v.bad{color:var(--bad)}',
'.cd{display:flex;align-items:center;gap:16px;flex-wrap:wrap}',
'.ring{position:relative;width:104px;height:104px;flex:0 0 auto}',
'.ring svg{transform:rotate(-90deg);display:block}',
'.ring .t{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}',
'.ring .t b{font-size:25px;font-weight:800;letter-spacing:-.03em;line-height:1}',
'.ring .t span{font-size:11px;color:var(--mut);font-weight:600}',
'.flag{display:flex;gap:12px;align-items:flex-start;padding:13px 0;border-bottom:1px solid var(--line)}',
'.flag:last-child{border-bottom:0}',
'.flag p{margin:3px 0 0}',
'.dot{width:11px;height:11px;border-radius:50%;flex:0 0 11px;margin-top:6px;box-shadow:0 0 0 4px rgba(0,0,0,.05)}',
'.d-green{background:var(--ok)}.d-amber{background:var(--warn)}.d-red{background:var(--bad)}',
'.test{border:1px solid var(--line);border-radius:13px;padding:14px 16px;margin:10px 0;background:var(--card)}',
'.test .top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
'.pill{font-size:11.5px;font-weight:800;letter-spacing:.06em;padding:3px 10px;border-radius:99px}',
'.p-pass{background:rgba(15,157,99,.14);color:var(--ok)}.p-fail{background:rgba(224,69,63,.14);color:var(--bad)}',
'.defects{list-style:none;padding:0;margin:10px 0 0}',
'.defects li{padding:7px 0;border-top:1px dashed var(--line);font-size:14.5px}',
'.tag{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.05em;padding:2px 7px;border-radius:5px;',
'background:rgba(99,102,241,.12);color:var(--i1);margin-right:7px;vertical-align:1px}',
'.tag.dang{background:var(--bad);color:#fff}',
'table{width:100%;border-collapse:collapse;font-size:15px;margin:14px 0}',
'th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}',
'th{font-size:12.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut)}',
'.chart{margin:12px 0}',
'.chart path.ln{stroke-dasharray:1200;stroke-dashoffset:1200;animation:draw 1.4s cubic-bezier(.4,0,.2,1) forwards}',
'@keyframes draw{to{stroke-dashoffset:0}}',
'.cmp{display:grid;grid-template-columns:1fr 1fr;gap:14px}',
'@media(max-width:640px){.cmp{grid-template-columns:1fr}}',
'.cmp .col{min-width:0}',
'.sk{border-radius:10px;background:linear-gradient(90deg,rgba(120,130,150,.10),rgba(120,130,150,.20),rgba(120,130,150,.10));',
'background-size:200% 100%;animation:sh 1.15s linear infinite;height:15px;margin:9px 0}',
'@keyframes sh{to{background-position:-200% 0}}',
'.actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}',
'footer{border-top:1px solid var(--line);margin-top:52px;padding:24px 0 46px;color:var(--mut);font-size:14px}',
'.toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,14px);background:#0e1117;color:#fff;padding:11px 18px;',
'border-radius:11px;z-index:99;font-size:14px;opacity:0;transition:.25s;box-shadow:0 12px 30px rgba(0,0,0,.3)}',
'.toast.on{opacity:1;transform:translate(-50%,0)}',
'*:focus-visible{outline:2.5px solid var(--i1);outline-offset:2px;border-radius:6px}',
'@media print{.mesh,header.site,form.search,.recent,.trust,.actions,.nav,footer,.noprint{display:none!important}',
'body{background:#fff}.card{box-shadow:none;border:1px solid #ccc;break-inside:avoid}',
'.stat{border:1px solid #ccc}a{color:#000;text-decoration:none}}'
].join('');

const ICON_URI = 'data:image/svg+xml,' + encodeURIComponent(ICON_SVG);

function jsonLd(){
  var app = {
    '@context':'https://schema.org','@type':'WebApplication',
    name:'Bike MOT Check UK', url:SITE, applicationCategory:'UtilitiesApplication',
    operatingSystem:'Any', browserRequirements:'Requires JavaScript',
    description:'Free MOT history check for any UK registration. Full test history, mileage chart and an automatic buyer report built from DVSA data.',
    offers:{'@type':'Offer',price:'0',priceCurrency:'GBP'}, inLanguage:'en-GB'
  };
  var org = { '@context':'https://schema.org','@type':'Organization', name:'Bike MOT Check UK', url:SITE, logo:SITE + '/icon.svg', founder:{'@type':'Person',name:'Ruhul Amin'} };
  var site = { '@context':'https://schema.org','@type':'WebSite', name:'Bike MOT Check UK', url:SITE,
    potentialAction:{'@type':'SearchAction',target:{'@type':'EntryPoint',urlTemplate:SITE + '/check/{search_term_string}'},'query-input':'required name=search_term_string'} };
  var faq = { '@context':'https://schema.org','@type':'FAQPage','mainEntity':[
      {'@type':'Question',name:'Is the MOT history check really free?',acceptedAnswer:{'@type':'Answer',text:'Yes. There is no sign up, no payment and no limit for normal use. The data comes from the DVSA MOT History API, which is free to read.'}},
      {'@type':'Question',name:'How far back does the MOT history go?',acceptedAnswer:{'@type':'Answer',text:'DVSA records go back to 2005, including the odometer reading taken at each test.'}},
      {'@type':'Question',name:'Does it cover Northern Ireland?',acceptedAnswer:{'@type':'Answer',text:'No. DVSA holds records for England, Scotland and Wales. Northern Ireland MOTs are run by the DVA and are not in this dataset.'}},
      {'@type':'Question',name:'Can I tell if a car has been clocked?',acceptedAnswer:{'@type':'Answer',text:'Often, yes. Every MOT records the mileage, so a reading that drops between tests is visible immediately. This checker flags any drop automatically, though a replaced instrument cluster can cause the same pattern innocently.'}},
      {'@type':'Question',name:'What does the MOT not tell me?',acceptedAnswer:{'@type':'Answer',text:'It says nothing about the clutch, gearbox, engine internals, air conditioning or outstanding finance. It is a roadworthiness snapshot on the day of the test, not a mechanical warranty.'}}
  ]};
  return [app,org,site,faq].map(function(o){ return '<script type="application/ld+json">' + JSON.stringify(o) + '<' + '/script>'; }).join('');
}

function head(title, desc, canon){
  return [
  '<!doctype html><html lang="en-GB"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
  '<meta name="google-site-verification" content="' + GSC + '">',
  '<meta name="msvalidate.01" content="' + BING + '">',
  '<title>' + esc(title) + '</title>',
  '<meta name="description" content="' + esc(desc) + '">',
  '<link rel="canonical" href="' + canon + '">',
  '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">',
  '<meta name="theme-color" content="#6366f1">',
  '<link rel="icon" href="/icon.svg" type="image/svg+xml">',
  '<link rel="apple-touch-icon" href="/icon.svg">',
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<meta property="og:type" content="website">',
  '<meta property="og:site_name" content="Bike MOT Check UK">',
  '<meta property="og:locale" content="en_GB">',
  '<meta property="og:title" content="' + esc(title) + '">',
  '<meta property="og:description" content="' + esc(desc) + '">',
  '<meta property="og:url" content="' + canon + '">',
  '<meta property="og:image" content="' + SITE + '/og.png">',
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  '<meta name="twitter:card" content="summary_large_image">',
  '<meta name="twitter:title" content="' + esc(title) + '">',
  '<meta name="twitter:description" content="' + esc(desc) + '">',
  '<meta name="twitter:image" content="' + SITE + '/og.png">',
  jsonLd(),
  '<style>' + CSS + '</style>',
  '</head><body>',
  '<div class="mesh" aria-hidden="true"><i></i><i></i><i></i></div>',
  '<header class="site"><div class="wrap">',
  '<a class="brand" href="/">' + ICON_SVG + '<span>Bike MOT Check<span style="color:var(--mut);font-weight:600"> UK</span></span></a>',
  '<nav class="nav"><a href="/guides">Guides</a><a href="/compare">Compare</a></nav>',
  '</div></header>'
  ].join('');
}

function footer(){
  return [
  '<footer><div class="wrap">',
  '<p><strong>Bike MOT Check UK</strong> reads the official DVSA MOT History API. It is free, needs no account, and we do not store the registrations you look up.</p>',
  '<p>Data covers England, Scotland and Wales. Northern Ireland MOTs are administered by the DVA and are not included. An MOT is a roadworthiness snapshot on the day of the test, not a mechanical warranty, and this site is general information rather than advice on any individual purchase.</p>',
  '<p><a href="/guides">MOT guides</a> &middot; <a href="/compare">Compare two vehicles</a> &middot; <a href="/">Run a check</a></p>',
  '<p class="meta">Built by Ruhul Amin, Hertfordshire. Figures checked August 2026.</p>',
  '</div></footer></body></html>'
  ].join('');
}

function searchBlock(prefill){
  return [
  '<form class="search" id="f" autocomplete="off">',
  '<label class="plate" for="reg">',
  '<span class="gb"><b>&#9733;</b>GB</span>',
  '<input id="reg" name="reg" placeholder="AB12 CDE" aria-label="Vehicle registration" spellcheck="false" autocapitalize="characters" value="' + esc(prefill || '') + '">',
  '</label>',
  '<button class="btn" id="go" type="submit">Check MOT history</button>',
  '</form>',
  '<p class="hint">Type the registration as it appears on the plate. Spaces do not matter.</p>',
  '<div class="recent" id="recent"></div>'
  ].join('');
}

function homePage(prefill){
  return [
  head(prefill ? (prefill + ' MOT history, mileage and failures | Bike MOT Check UK')
               : 'Free MOT History Check UK - Mileage, Failures and Buyer Report',
       'Free MOT history check for any UK registration. Every test, every mileage reading and every advisory since 2005, plus an automatic buyer report that flags mileage rollbacks and recurring faults.',
       prefill ? (SITE + '/check/' + encodeURIComponent(prefill)) : (SITE + '/')),
  '<main class="wrap">',
  '<section class="hero">',
  '<h1>Check any UK vehicle&rsquo;s<br><span class="grad">MOT history, free</span></h1>',
  '<p class="sub">Every test, every mileage reading and every advisory since 2005. Cars, vans, motorcycles, HGVs and trailers. You also get an automatic buyer report that flags the things worth arguing about.</p>',
  searchBlock(prefill),
  '<div class="trust"><span>Official DVSA data</span><span>No sign up</span><span>No payment</span><span>Records since 2005</span><span>Nothing stored</span></div>',
  '</section>',
  '<div id="out"></div>',
  '<section>',
  '<h2>How to read an MOT history before you buy</h2>',
  '<p>An MOT record is written by the testing station, not by the seller. That makes it the most honest document you will see about a used vehicle, and it is free to read.</p>',
  '<h3>Mileage is the part that matters most</h3>',
  '<p>Every test records the odometer reading. Put those readings in order and you get a mileage history nobody can quietly edit. If the number ever drops, or jumps by an implausible amount, something needs explaining: a replaced instrument cluster, a keying error, or a clocked vehicle. This checker flags any drop automatically and draws the whole trail as a chart.</p>',
  '<p>Context matters as much as the total. The UK average is roughly 7,100 miles a year for a car and about 3,000 for a motorcycle, so a car doing 2,000 a year deserves as much thought as one doing 25,000. Very low mileage often means short cold journeys, which are hard on the exhaust, battery and brakes.</p>',
  '<h3>Read the defects, not just the pass or fail</h3>',
  '<p>Since 20 May 2018 every defect carries a category. Dangerous and major are failures. Minor and advisory still pass. The pattern across years tells you more than any single result: an advisory that becomes a major the next year is normal reactive maintenance, but the same advisory repeated four years running is a fault nobody has ever fixed.</p>',
  '<h3>What the MOT does not tell you</h3>',
  '<p>It says nothing about the clutch, the gearbox, the engine internals, the air conditioning or outstanding finance. A car can pass its MOT on the morning its head gasket fails. For finance, theft markers and write off categories you still need a paid provenance check.</p>',
  '</section>',
  '<section class="card glass">',
  '<h2 style="margin-top:0">MOT guides</h2>',
  '<p class="meta">Plain English, sourced from GOV.UK and DVSA. We say plainly when something does not matter.</p>',
  '<ul>',
  '<li><a href="/guides/what-fails-an-mot-uk">What actually fails an MOT, and what it costs to put right</a></li>',
  '<li><a href="/guides/spot-a-clocked-car-uk">How to spot a clocked car before you hand over the money</a></li>',
  '<li><a href="/guides/mot-rules-fines-uk">MOT rules in plain English: when it is due, and what you get fined</a></li>',
  '<li><a href="/guides/mot-defect-categories-uk">Dangerous, major, minor and advisory: what your result means</a></li>',
  '</ul>',
  '<p><a href="/guides">See all guides</a></p>',
  '</section>',
  '<section>',
  '<h2>Frequently asked</h2>',
  '<h3>Is the MOT history check really free?</h3>',
  '<p>Yes. No sign up, no payment and no limit for normal use. The data comes from the DVSA MOT History API, which is free to read. We pay for the server, not for the data.</p>',
  '<h3>How far back does the history go?</h3>',
  '<p>DVSA records go back to 2005, including the odometer reading taken at each test.</p>',
  '<h3>Does it cover Northern Ireland?</h3>',
  '<p>No. DVSA holds records for England, Scotland and Wales. Northern Ireland MOTs are run by the DVA and are not in this dataset.</p>',
  '<h3>Why does it say no record found?</h3>',
  '<p>Usually because the vehicle is under three years old and has never needed a test, because the registration was typed incorrectly, or because it is a Northern Ireland or recently imported vehicle.</p>',
  '<h3>Do you store the registrations I look up?</h3>',
  '<p>No. Lookups are cached in memory for a few hours so that repeated searches do not hit the DVSA quota, and that cache clears when the server restarts. Your recent searches are saved in your own browser only, and the Clear button removes them.</p>',
  '</section>',
  '</main>',
  footer(),
  '<script src="/app.js" defer></' + 'script>'
  ].join('');
}

function comparePage(){
  return [
  head('Compare Two Vehicles Side by Side | Bike MOT Check UK',
       'Put two UK registrations side by side and compare MOT pass rate, average annual mileage, dangerous defects and recurring faults before you choose which one to buy.',
       SITE + '/compare'),
  '<main class="wrap">',
  '<section class="hero" style="padding-top:44px">',
  '<h1>Compare <span class="grad">two vehicles</span></h1>',
  '<p class="sub">Deciding between two cars? Put both registrations in and see the mileage, pass rate, dangerous defects and recurring faults next to each other.</p>',
  '<form class="search" id="cf" autocomplete="off" style="flex-direction:column;align-items:center">',
  '<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;width:100%">',
  '<label class="plate" for="ra" style="flex:1 1 240px"><span class="gb"><b>&#9733;</b>GB</span>',
  '<input id="ra" placeholder="AB12 CDE" aria-label="First registration" spellcheck="false" autocapitalize="characters" style="font-size:24px"></label>',
  '<label class="plate" for="rb" style="flex:1 1 240px"><span class="gb"><b>&#9733;</b>GB</span>',
  '<input id="rb" placeholder="XY68 ZZZ" aria-label="Second registration" spellcheck="false" autocapitalize="characters" style="font-size:24px"></label>',
  '</div>',
  '<button class="btn" id="cgo" type="submit" style="margin-top:12px">Compare both</button>',
  '</form>',
  '</section>',
  '<div id="cout"></div>',
  '<section>',
  '<h2>What to compare, and what to ignore</h2>',
  '<p>Two cars of the same age and price can have very different histories. The things that genuinely separate them are the mileage trail, how often they failed, and whether the same fault keeps reappearing.</p>',
  '<p><strong>Pass rate</strong> against the national 78.3% tells you how the vehicle has been maintained. <strong>Average annual mileage</strong> tells you what kind of life it has had. <strong>Dangerous defects</strong> tell you whether it has been run until something broke. <strong>Recurring themes</strong> tell you about the owner.</p>',
  '<p>What to ignore: a single advisory, a one off failure on a bulb, and the total mileage on its own without the shape of how it accumulated.</p>',
  '<p>New to reading these? Start with <a href="/guides/mot-defect-categories-uk">what the defect categories mean</a>.</p>',
  '</section>',
  '</main>',
  footer(),
  '<script src="/app.js" defer></' + 'script>'
  ].join('');
}

const OG_SVG = [
'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">',
'<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
'<stop offset="0" stop-color="#6366f1"/><stop offset="0.5" stop-color="#8b5cf6"/><stop offset="1" stop-color="#14b8a6"/></linearGradient></defs>',
'<rect width="1200" height="630" fill="#0e1117"/>',
'<rect width="1200" height="630" fill="url(#bg)" opacity="0.20"/>',
'<text x="80" y="250" fill="#fff" font-family="Helvetica,Arial,sans-serif" font-size="78" font-weight="bold">Check any UK vehicle</text>',
'<text x="80" y="340" fill="#a5b4fc" font-family="Helvetica,Arial,sans-serif" font-size="78" font-weight="bold">MOT history, free</text>',
'<rect x="80" y="400" width="430" height="92" rx="12" fill="#ffd400" stroke="#0b0b0b" stroke-width="5"/>',
'<rect x="80" y="400" width="62" height="92" rx="12" fill="#063298"/>',
'<text x="96" y="458" fill="#fff" font-family="Helvetica,Arial,sans-serif" font-size="24" font-weight="bold">GB</text>',
'<text x="172" y="470" fill="#0b0b0b" font-family="Helvetica,Arial,sans-serif" font-size="58" font-weight="bold" letter-spacing="6">AB12 CDE</text>',
'<text x="80" y="560" fill="#93a0b4" font-family="Helvetica,Arial,sans-serif" font-size="30">Mileage trail, failures, advisories and an automatic buyer report</text>',
'</svg>'
].join('');

var CLIENT_JS = '';
try { CLIENT_JS = require('fs').readFileSync(__dirname + '/client.js', 'utf8'); }
catch(e) { CLIENT_JS = 'console.error("client.js missing");'; }

var OG_PNG = null, ICON_PNG = null;
try {
  var _a = require('fs').readFileSync(__dirname + '/assets.b64', 'utf8').split('\n');
  if (_a[0]) OG_PNG = Buffer.from(_a[0].trim(), 'base64');
  if (_a[1]) ICON_PNG = Buffer.from(_a[1].trim(), 'base64');
} catch(e) {}

const MANIFEST = JSON.stringify({
  name: 'Bike MOT Check UK', short_name: 'MOT Check',
  description: 'Free MOT history check for any UK registration.',
  start_url: '/', display: 'standalone', background_color: '#f6f7fb', theme_color: '#6366f1',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
});

const ROBOTS = [
  'User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /calendar/', '',
  'Sitemap: ' + SITE + '/sitemap.xml',
  'Sitemap: ' + SITE + '/guides/sitemap.xml', ''
].join('\n');

const SITEMAP = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  '<url><loc>' + SITE + '/</loc><priority>1.0</priority><changefreq>weekly</changefreq></url>',
  '<url><loc>' + SITE + '/compare</loc><priority>0.8</priority><changefreq>monthly</changefreq></url>',
  '</urlset>'
].join('');

function send(res, code, type, body, cache){
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': cache || 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  res.end(body);
}

http.createServer(function(req, res){
  var raw = req.url || '/';
  var qi = raw.indexOf('?');
  var path = qi === -1 ? raw : raw.slice(0, qi);
  var query = qi === -1 ? '' : raw.slice(qi + 1);
  if(path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
  var params = new URLSearchParams(query);

  if(path === '/healthz') return send(res, 200, 'application/json', JSON.stringify({ ok:true, cached:Object.keys(cache).length }), 'no-store');
  if(path === '/robots.txt') return send(res, 200, 'text/plain; charset=utf-8', ROBOTS, 'public, max-age=3600');
  if(path === '/sitemap.xml') return send(res, 200, 'application/xml; charset=utf-8', SITEMAP, 'public, max-age=3600');
  if(path === '/manifest.webmanifest') return send(res, 200, 'application/manifest+json', MANIFEST, 'public, max-age=86400');
  if(path === '/icon.svg' || path === '/favicon.svg' || path === '/favicon.ico')
    return send(res, 200, 'image/svg+xml', ICON_SVG, 'public, max-age=604800');
  if(path === '/og.png' && OG_PNG) return send(res, 200, 'image/png', OG_PNG, 'public, max-age=604800');
  if(path === '/apple-touch-icon.png' && ICON_PNG) return send(res, 200, 'image/png', ICON_PNG, 'public, max-age=604800');
  if(path === '/apple-touch-icon.png') return send(res, 200, 'image/svg+xml', ICON_SVG, 'public, max-age=604800');
  if(path === '/og.svg') return send(res, 200, 'image/svg+xml', OG_SVG, 'public, max-age=604800');
  if(path === '/app.js') return send(res, 200, 'application/javascript; charset=utf-8', CLIENT_JS, 'public, max-age=600');

  if(path === '/api/mot'){
    var ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    if(!allowed(ip)) return send(res, 429, 'application/json', JSON.stringify({ error:'Too many lookups from this connection. Please try again later.' }), 'no-store');
    var reg = cleanReg(params.get('reg'));
    if(reg.length < 2) return send(res, 400, 'application/json', JSON.stringify({ error:'Enter a registration.' }), 'no-store');
    return lookup(reg).then(function(data){
      var code = data && data.error ? (data.transient ? 502 : 404) : 200;
      send(res, code, 'application/json; charset=utf-8', JSON.stringify(data), 'public, max-age=600');
    }).catch(function(err){
      send(res, 502, 'application/json', JSON.stringify({ error:'Could not reach the DVSA service. Please try again shortly.' }), 'no-store');
    });
  }

  if(path.indexOf('/calendar/') === 0 && path.slice(-4) === '.ics'){
    var creg = cleanReg(path.slice(10, -4));
    var ics = buildIcs(creg, params.get('d'), params.get('v'));
    if(!ics) return send(res, 400, 'text/plain', 'Bad date', 'no-store');
    res.writeHead(200, { 'Content-Type':'text/calendar; charset=utf-8', 'Content-Disposition':'attachment; filename="MOT-' + creg + '.ics"', 'Cache-Control':'no-store' });
    return res.end(ics);
  }

  if(path === '/compare') return send(res, 200, 'text/html; charset=utf-8', comparePage());

  if(path.indexOf('/check/') === 0){
    var pre = cleanReg(decodeURIComponent(path.slice(7)));
    if(!pre) { res.writeHead(302, { Location:'/' }); return res.end(); }
    return send(res, 200, 'text/html; charset=utf-8', homePage(pre));
  }

  if(path === '' || path === '/') return send(res, 200, 'text/html; charset=utf-8', homePage(cleanReg(params.get('reg'))));

  res.writeHead(301, { Location:'/' });
  res.end();
}).listen(PORT, function(){ console.log('bikemotcheck listening on ' + PORT); });
