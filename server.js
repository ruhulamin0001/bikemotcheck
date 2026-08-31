/* EMO_MAIN_404: return a real 404 for unknown paths.
   Before this, every unknown URL returned 200 with the homepage, which is a soft 404 and
   Google treats it as thin duplicate content. The allowlist below was read directly out of
   this file's own router (every path === comparison and every path.indexOf prefix) and then
   verified against the live site, so it cannot silently drop a real route. */
(function(){
  var _h = require('http');
  if (_h.__emoMain404) { return; }
  _h.__emoMain404 = true;
  var EXACT = {
    '/': 1, '/healthz': 1, '/robots.txt': 1, '/sitemap.xml': 1, '/manifest.webmanifest': 1,
    '/icon.svg': 1, '/favicon.svg': 1, '/favicon.ico': 1, '/og.png': 1, '/og.svg': 1,
    '/apple-touch-icon.png': 1, '/app.js': 1, '/api/mot': 1, '/ulez': 1, '/compare': 1,
    '/scorecard': 1, '/trade': 1, '/reminders': 1,
    '/check': 1, '/calendar': 1
  };
  var PREFIX = ['/check/', '/calendar/', '/guides'];
  var PAGE = "<!doctype html><html lang=\"en-GB\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Page not found | MOT Check UK</title><meta name=\"robots\" content=\"noindex, follow\"><style>body{font:16px/1.65 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:56px 20px;color:#14201b;background:#f7f9f8}.w{max-width:640px;margin:0 auto}h1{font-size:28px;margin:0 0 12px}ul{padding-left:20px}a{color:#0a8f5b}</style></head><body><div class=\"w\"><h1>Page not found</h1><p>That page does not exist on this site.</p><ul><li><a href=\"/\">Free MOT history check for any UK car, van, motorcycle or lorry</a></li><li><a href=\"/ulez\">ULEZ and clean air zone checker</a></li><li><a href=\"/compare\">Compare two vehicles</a></li><li><a href=\"/guides\">MOT guides</a></li></ul></div></body></html>";
  var _orig = _h.createServer;
  _h.createServer = function(handler){
    var wrapped = function(req, res){
      try {
        /* www serves a full duplicate of the site otherwise: Traefik routes both hosts
           here and canonical tags alone leave two indexable copies. 301 to the apex. */
        var host = String(req.headers.host || '').toLowerCase();
        if (host.indexOf('www.') === 0) {
          res.writeHead(301, { 'Location': 'https://' + host.slice(4) + String(req.url || '/') });
          res.end();
          return;
        }
        var p = String(req.url || '').split('?')[0].split('#')[0];
        var known = false;
        for (var i = 0; i < PREFIX.length; i++) { if (p.indexOf(PREFIX[i]) === 0) { known = true; break; } }
        if (!known && /^\/[0-9a-f]{32}\.txt$/.test(p)) { known = true; }
        if (!known) {
          var n = p.length > 1 ? p.replace(/\/+$/, '') : p;
          if (n === '') { n = '/'; }
          if (EXACT[n]) { known = true; }
        }
        if (!known) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(PAGE);
          return;
        }
      } catch(e) {}
      return handler(req, res);
    };
    return _orig.call(_h, wrapped);
  };
})();

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
  /* the map grows one entry per unique IP and nothing ever deleted them; on a
     long-lived container that is a slow leak, so reset it when it gets large */
  if (!h && Object.keys(hits).length > 20000) hits = {};
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
/* ICS text values must not carry raw newlines or unescaped separators, or a crafted
   ?v= parameter could inject extra calendar properties into the downloaded file. */
function icsText(s){
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/([\\;,])/g, '\\$1').slice(0, 120);
}
function buildIcs(reg, dateStr, vehicle){
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  var end = new Date(d.getTime() + 86400000);
  var title = 'MOT due: ' + reg + (vehicle ? ' (' + icsText(vehicle) + ')' : '');
  return [
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//MOT Check UK//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH',
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
'.consent{position:fixed;left:14px;right:14px;bottom:14px;z-index:120;max-width:640px;margin:0 auto;'
+'background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;'
+'box-shadow:0 18px 50px rgba(15,23,42,.22);display:flex;gap:14px;align-items:center;flex-wrap:wrap}',
'.consent p{margin:0;flex:1 1 280px;font-size:14px;color:var(--mut);line-height:1.5}',
'.consent div{display:flex;gap:8px;flex:0 0 auto}',
'.consent .btn{min-height:0;padding:9px 16px;font-size:14px}',
'*:focus-visible{outline:2.5px solid var(--i1);outline-offset:2px;border-radius:6px}',
'@media print{.mesh,header.site,form.search,.recent,.trust,.actions,.nav,footer,.noprint{display:none!important}',
'body{background:#fff}.card{box-shadow:none;border:1px solid #ccc;break-inside:avoid}',
'.stat{border:1px solid #ccc}a{color:#000;text-decoration:none}}'
].join('');

const ICON_URI = 'data:image/svg+xml,' + encodeURIComponent(ICON_SVG);

/* FAQ structured data must match what the visitor can actually read on that page,
   so each page passes its own list and pages with no FAQ pass nothing. */
const MOT_FAQ = [
  { q:'Is the MOT history check really free?', a:'Yes. No sign up, no payment and no limit for normal use. The data comes from the DVSA MOT History API, which is free to read. We pay for the server, not for the data.' },
  { q:'How far back does the history go?', a:'DVSA records go back to 2005, including the odometer reading taken at each test.' },
  { q:'Does it cover Northern Ireland?', a:'No. DVSA holds records for England, Scotland and Wales. Northern Ireland MOTs are run by the DVA and are not in this dataset.' },
  { q:'Why does it say no record found?', a:'Usually because the vehicle is under three years old and has never needed a test, because the registration was typed incorrectly, or because it is a Northern Ireland or recently imported vehicle.' },
  { q:'Do you store the registrations I look up?', a:'No. Lookups are cached in memory for a few hours so that repeated searches do not hit the DVSA quota, and that cache clears when the server restarts. Your recent searches are saved in your own browser only.' }
];
const ULEZ_FAQ = [
  { q:'Is my petrol car ULEZ compliant?', a:'Almost certainly yes if it was first registered from 2006 onwards, and quite possibly yes if it is from 2003 to 2005, because many manufacturers met Euro 4 early. Check the registration to be sure.' },
  { q:'Why is my diesel not compliant when it is only ten years old?', a:'Because diesels are held to Euro 6 rather than Euro 4, and Euro 6 only became compulsory for new cars in September 2015. A 2014 diesel is usually Euro 5 and does pay.' },
  { q:'Does the ULEZ charge apply at weekends?', a:'Yes. It runs 24 hours a day, every day except Christmas Day.' },
  { q:'Are electric cars exempt?', a:'Yes. Fully electric and hydrogen vehicles produce no tailpipe emissions and are not charged anywhere.' },
  { q:'Is this the official checker?', a:'No. The DVSA MOT dataset does not publish the Euro standard, so we estimate it from fuel type and first registration date. For the definitive answer use the free official checker at TfL.' }
];
function jsonLd(faqList){
  var app = {
    '@context':'https://schema.org','@type':'WebApplication',
    name:'MOT Check UK', url:SITE, applicationCategory:'UtilitiesApplication',
    operatingSystem:'Any', browserRequirements:'Requires JavaScript',
    description:'Free MOT history check for any UK registration. Full test history, mileage chart and an automatic buyer report built from DVSA data.',
    offers:{'@type':'Offer',price:'0',priceCurrency:'GBP'}, inLanguage:'en-GB'
  };
  var org = { '@context':'https://schema.org','@type':'Organization', name:'MOT Check UK', url:SITE, logo:SITE + '/icon.svg', founder:{'@type':'Person',name:'Ruhul Amin'} };
  var site = { '@context':'https://schema.org','@type':'WebSite', name:'MOT Check UK', url:SITE,
    potentialAction:{'@type':'SearchAction',target:{'@type':'EntryPoint',urlTemplate:SITE + '/check/{search_term_string}'},'query-input':'required name=search_term_string'} };
  var out = [app, org, site];
  if(faqList && faqList.length){
    out.push({ '@context':'https://schema.org','@type':'FAQPage','mainEntity': faqList.map(function(f){
      return { '@type':'Question', name:f.q, acceptedAnswer:{ '@type':'Answer', text:f.a } };
    }) });
  }
  return out.map(function(o){
 return '<script type="application/ld+json">' + JSON.stringify(o) + '<' + '/script>'; }).join('');
}

function head(title, desc, canon, faqList){
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
  '<meta property="og:site_name" content="MOT Check UK">',
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
  jsonLd(faqList),
  '<style>' + CSS + '</style>',
  '</head><body>',
  '<div class="mesh" aria-hidden="true"><i></i><i></i><i></i></div>',
  '<header class="site"><div class="wrap">',
  '<a class="brand" href="/">' + ICON_SVG + '<span>MOT Check<span style="color:var(--mut);font-weight:600"> UK</span></span></a>',
  '<nav class="nav"><a href="/ulez">ULEZ</a><a href="/guides">Guides</a><a href="/compare">Compare</a><a href="/reminders">Reminders</a></nav>',
  '</div></header>'
  ].join('');
}

function footer(){
  return [
  '<footer><div class="wrap">',
  '<p><strong>MOT Check UK</strong> reads the official DVSA MOT History API. It is free, needs no account, and we do not store the registrations you look up.</p>',
  '<p>Data covers England, Scotland and Wales. Northern Ireland MOTs are administered by the DVA and are not included. An MOT is a roadworthiness snapshot on the day of the test, not a mechanical warranty, and this site is general information rather than advice on any individual purchase.</p>',
  '<p><a href="/guides">MOT guides</a> &middot; <a href="/compare">Compare two vehicles</a> &middot; <a href="/reminders">MOT reminders</a> &middot; <a href="/">Run a check</a></p>',
  '<p>Something wrong, out of date, or a vehicle we got wrong? Email <a href="mailto:support@adminruhulamin.co.uk">support@adminruhulamin.co.uk</a> and a person will read it.</p>',
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

function ulezPage(){
  return [
  head('ULEZ Check: Is My Car ULEZ Compliant? Free Registration Check',
       'Free ULEZ and Clean Air Zone check for any UK registration. See if a vehicle is likely to pay the London ULEZ charge, plus Birmingham, Bristol and Scotland.',
       SITE + '/ulez', ULEZ_FAQ),
  '<main class="wrap">',
  '<section class="hero">',
  '<h1>Is my car <span class="grad">ULEZ compliant?</span></h1>',
  '<p class="sub">Enter a registration and we will estimate its emissions zone status from the official DVSA record, alongside its full MOT history. Free, no sign up.</p>',
  searchBlock(''),
  '<div class="trust"><span>London ULEZ</span><span>Birmingham and Bristol CAZ</span><span>Scottish LEZ</span><span>No sign up</span></div>',
  '</section>',
  '<div id="out"></div>',
  '<section>',
  '<h2>What decides whether you pay</h2>',
  '<p>Emissions zones do not care how old your car looks or what it costs. They care about one thing: the <strong>Euro emissions standard</strong> it was built to.</p>',
  '<table><thead><tr><th>Vehicle</th><th>Standard needed</th><th>Roughly means first registered</th></tr></thead><tbody>',
  '<tr><td>Petrol car</td><td>Euro 4</td><td>From January 2006</td></tr>',
  '<tr><td>Diesel car</td><td>Euro 6</td><td>From 1 September 2015</td></tr>',
  '<tr><td>Diesel van</td><td>Euro 6</td><td>From September 2016</td></tr>',
  '<tr><td>Motorcycle or moped</td><td>Euro 3</td><td>From around July 2007</td></tr>',
  '<tr><td>Fully electric or hydrogen</td><td>Exempt</td><td>Any date</td></tr>',
  '<tr><td>Historic vehicle</td><td>Exempt</td><td>Built over 40 years ago, and in the historic tax class</td></tr>',
  '</tbody></table>',
  '<p class="meta">Registration date is a guide, not a guarantee. Some vehicles met the standard before it became compulsory, and a few later ones did not. That is why we call our result an estimate and point you at the official checker.</p>',
  '<h2>What it costs if you are not compliant</h2>',
  '<table><thead><tr><th>Zone</th><th>Daily charge for a non compliant car</th></tr></thead><tbody>',
  '<tr><td><strong>London ULEZ</strong>, all 32 boroughs and the City</td><td><strong>&pound;12.50</strong>, 24 hours a day, every day of the year</td></tr>',
  '<tr><td>Birmingham Clean Air Zone, inside the A4540 ring road</td><td>&pound;8</td></tr>',
  '<tr><td>Bristol Clean Air Zone, central area</td><td>&pound;9</td></tr>',
  '<tr><td>Bath, Sheffield, Bradford, Portsmouth, Tyneside</td><td>No charge for private cars, commercial vehicles only</td></tr>',
  '<tr><td>Glasgow, Edinburgh, Aberdeen, Dundee</td><td>There is no charge to pay. Non compliant vehicles are simply banned, and the penalty starts at &pound;60</td></tr>',
  '</tbody></table>',
  '<p>The London number is the one that hurts. <strong>Driving in five days a week at &pound;12.50 a day is about &pound;3,000 a year</strong>, which is more than many people pay to insure the car. If you are buying and the vehicle is not compliant, that is a real cost and a real negotiating point.</p>',
  '<h2>Scotland works completely differently</h2>',
  '<p>England charges you. Scotland does not. In Glasgow, Edinburgh, Aberdeen and Dundee you cannot pay a daily fee to enter, because non compliant vehicles are not allowed in at all. Drive in and a camera issues a penalty starting at &pound;60. If you are buying a car to use in a Scottish city, compliance is not a cost question, it is a can-you-use-it-at-all question.</p>',
  '<h2>Frequently asked</h2>',
  '<h3>Is my petrol car ULEZ compliant?</h3>',
  '<p>Almost certainly yes if it was first registered from 2006 onwards, and quite possibly yes if it is from 2003 to 2005, because many manufacturers met Euro 4 early. Check the registration to be sure.</p>',
  '<h3>Why is my diesel not compliant when it is only ten years old?</h3>',
  '<p>Because diesels are held to Euro 6 rather than Euro 4, and Euro 6 only became compulsory for new cars in September 2015. A 2014 diesel is usually Euro 5 and does pay.</p>',
  '<h3>Does the ULEZ charge apply at weekends?</h3>',
  '<p>Yes. It runs 24 hours a day, every day except Christmas Day.</p>',
  '<h3>Are electric cars exempt?</h3>',
  '<p>Yes. Fully electric and hydrogen vehicles produce no tailpipe emissions and are not charged anywhere.</p>',
  '<h3>Is this the official checker?</h3>',
  '<p>No, and we say so plainly. The DVSA MOT dataset we read does not publish the Euro standard, so we estimate it from fuel type and first registration date. For the definitive answer use the free official checker at <a href="https://tfl.gov.uk/modes/driving/check-your-vehicle/" rel="noopener" target="_blank">TfL</a>. Our value is that you get the emissions estimate together with the full MOT and mileage history in one search.</p>',
  '</section>',
  '<section class="card glass">',
  '<h2 style="margin-top:0">Related guides</h2>',
  '<ul>',
  '<li><a href="/guides/mot-statistics-uk">UK MOT statistics 2026</a></li>',
  '<li><a href="/guides/what-fails-an-mot-uk">What actually fails an MOT</a></li>',
  '<li><a href="/guides/spot-a-clocked-car-uk">How to spot a clocked car</a></li>',
  '</ul>',
  '</section>',
  '</main>',
  footer(),
  '<script src="/app.js" defer></' + 'script>'
  ].join('');
}
function homePage(prefill){
  return [
  head(prefill ? (prefill + ' MOT history, mileage and failures | MOT Check UK')
               : 'Free MOT History Check: Cars, Vans, Motorcycles and Lorries',
       'Free MOT history check for any UK car, van, motorcycle or lorry. Every test, mileage reading and advisory since 2005, plus an automatic buyer report.',
       prefill ? (SITE + '/check/' + encodeURIComponent(prefill)) : (SITE + '/'), MOT_FAQ),
  '<main class="wrap">',
  '<section class="hero">',
  '<h1>Check any UK vehicle&rsquo;s<br><span class="grad">MOT history, free</span></h1>',
  '<p class="sub">Every test, every mileage reading and every advisory since 2005. Works for cars, vans, motorcycles, lorries (HGVs) and trailers. You also get an automatic buyer report that flags the things worth arguing about.</p>',
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
  head('Compare Two Vehicles Side by Side | MOT Check UK',
       'Put two UK registrations side by side and compare MOT pass rate, average annual mileage, dangerous defects and recurring faults before you choose which one to buy.',
       SITE + '/compare', null),
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

/* ---- Roadmap item 1: MOT reminder landing page. The .ics machinery (buildIcs and
   /calendar/<REG>.ics with alarms at 21 and 7 days) already existed; this page fronts it.
   Tax reminders need the DVLA Vehicle Enquiry Service API and its own key — not registered
   yet, so tax is deliberately absent. Hook: add tax expiry here once a VES key exists. ---- */
function remindersPage(prefill){
  var faq = [
    { q:'When is my MOT due?',
      a:'Enter the registration above. We read the official DVSA record and show the exact expiry date, with a countdown of the days left.' },
    { q:'How early can I book the test?',
      a:'Up to one month minus a day before the expiry date. Book inside that window and the new certificate keeps the old renewal date, so you lose nothing by testing early.' },
    { q:'How does the calendar reminder work?',
      a:'One click downloads a small calendar file with the MOT due date and two built-in alerts, 21 days and 7 days before. It works with Google Calendar, Apple Calendar and Outlook. No email, no account, and we keep no copy.' },
    { q:'What happens if my MOT runs out?',
      a:'You can only drive the vehicle to a pre-booked test or to a repair appointment. Driving otherwise risks a fine of up to £1,000, and up to £2,500 if the vehicle is judged dangerous.' }
  ];
  return [
  head('Free MOT Reminder: Check Your Due Date, Get Alerts',
       'Check the exact MOT due date for any UK car, van, motorcycle or lorry, then add it to your calendar with alerts 21 and 7 days before. Free, no account.',
       SITE + '/reminders', faq),
  '<main class="wrap">',
  '<section class="hero" style="padding-top:44px">',
  '<h1>Never miss <span class="grad">an MOT again</span></h1>',
  '<p class="sub">Enter a registration and we show the exact due date from the official DVSA record, with one click to put it in your calendar with alerts 21 and 7 days before. No email, no account, nothing stored.</p>',
  searchBlock(prefill),
  '<div class="trust"><span>Official DVSA data</span><span>Works with Google, Apple and Outlook</span><span>No email needed</span><span>Free</span></div>',
  '</section>',
  '<div id="out"></div>',
  '<section>',
  '<h2>How this works</h2>',
  '<ol>',
  '<li>Run the check. The result shows the MOT expiry date and how many days are left.</li>',
  '<li>Click <strong>Add reminder to calendar</strong> on the result. Your phone or computer saves the due date with alerts 21 days and 7 days before.</li>',
  '<li>Book the test up to a month minus a day early. Do that and the new certificate keeps your old renewal date, so early testing costs you nothing.</li>',
  '</ol>',
  '<p>The reminder lives in your own calendar, not on our server. We do not take your email address and we do not store the registration. That is the whole point: a reminder service with nothing to sign up for.</p>',
  '<h2>Why the two alerts are set where they are</h2>',
  '<p>The 21 day alert lands inside the early-booking window, so you can book at a convenient garage rather than whoever has a slot left. The 7 day alert is the backstop. About <a href="/guides/what-fails-an-mot-uk">one car in four fails its first attempt</a>, and a failed test with days in hand is an inconvenience rather than a crisis.</p>',
  '<h2>Frequently asked</h2>',
  faq.map(function(f){ return '<h3>' + esc(f.q) + '</h3><p>' + esc(f.a) + '</p>'; }).join(''),
  '<p>The rules and fines around due dates are covered properly in <a href="/guides/mot-rules-fines-uk">MOT rules in plain English</a>, and <a href="/guides/mot-cost-uk">the legal maximum test fee</a> is worth knowing before you book.</p>',
  '</section>',
  '</main>',
  footer(),
  '<script src="/app.js" defer></' + 'script>'
  ].join('');
}

/* ---- Roadmap item 5: buyer scorecard landing page. Score itself renders client-side
   in the report (client.js), from the same DVSA history the checker already fetches. ---- */
function scorecardPage(prefill){
  return [
  head('Is This Car a Good Buy? Free MOT Buyer Scorecard',
       'A free buyer scorecard for any UK vehicle, built only from official DVSA MOT history. Mileage, failures, dangerous defects and advisories in plain English.',
       SITE + '/scorecard', null),
  '<main class="wrap">',
  '<section class="hero" style="padding-top:44px">',
  '<h1>Is this vehicle <span class="grad">a good buy?</span></h1>',
  '<p class="sub">Enter a registration for any UK car, van, motorcycle or lorry. We read the official DVSA MOT history and turn it into a plain scorecard: what is fine, what to ask about, and what should stop you. Free, no sign up.</p>',
  searchBlock(prefill),
  '</section>',
  '<div id="out"></div>',
  '<section>',
  '<h2>What the score is, and what it is not</h2>',
  '<p>This is our arithmetic on public DVSA data. It is not a DVSA rating and it is not a mechanical inspection. It cannot see outstanding finance, insurance write-offs or stolen markers, because none of that is public data. What it does is read the MOT trail the way an experienced buyer would, and show its working.</p>',
  '<h2>What we deduct for</h2>',
  '<ul>',
  '<li><strong>A mileage reading that falls between tests.</strong> The heaviest deduction, because it is the only thing on this page we can prove.</li>',
  '<li><strong>Gaps of more than 18 months</strong> between tests.</li>',
  '<li><strong>Dangerous defects</strong> in the record.</li>',
  '<li><strong>A failure rate above half</strong> of all tests taken.</li>',
  '<li><strong>The same advisory appearing three times or more</strong> without being fixed.</li>',
  '<li><strong>Very low annual mileage</strong> on a vehicle old enough for it to matter.</li>',
  '</ul>',
  '<p>Read <a href="/guides/spot-a-clocked-car-uk">how to spot a clocked vehicle</a> and <a href="/guides/mot-defect-categories-uk">what dangerous, major and minor mean</a> for the method behind the first and third of those.</p>',
  '</section>',
  '</main>',
  footer(),
  '<script src="/app.js" defer></' + 'script>'
  ].join('');
}

/* ---- Roadmap item 7: trade page for small dealers, garages and fleets ---- */
function tradePage(){
  var faq = [
    { q:'Is the checker free for trade use?',
      a:'Yes. There is no account, no rate card and no per-check charge. If you are checking stock you have taken in, that is the same lookup a private buyer makes.' },
    { q:'Can I check a list of registrations in one go?',
      a:'Not yet. Bulk upload is the thing we are building next and the form on this page is how you tell us what you need.' },
    { q:'Where does the data come from?',
      a:'The official DVSA MOT History API, for England, Scotland and Wales. Northern Ireland MOTs are administered by the DVA and are not included.' },
    { q:'Does it tell me about finance, write-offs or theft?',
      a:'No. This site reads the MOT record only. Finance, write-off and stolen markers come from separate commercial databases we do not licence, and we will not imply otherwise.' }
  ];
  return [
  head('Bulk MOT Checking for Dealers, Garages and Fleets | MOT Check UK',
       'Free MOT history checks for dealers, garages and van fleets. What the DVSA record tells you about stock, what it cannot, and what we are building next.',
       SITE + '/trade', faq),
  '<main class="wrap">',
  '<h1>MOT checking for dealers, garages and fleets</h1>',
  '<p class="sub">Free, unlimited, no account. Cars, vans, motorcycles and lorries. If you buy stock at auction, take part exchanges, or run a handful of vans, the DVSA MOT record is the cheapest due diligence available and most people read about a third of what is in it.</p>',
  '<section>',
  '<h2>What the MOT record is genuinely good for</h2>',
  '<ul>',
  '<li><strong>Mileage verification.</strong> Every test writes a dated odometer reading. A reading that falls between tests is the one thing you can actually prove, and it is the single most valuable line in the file.</li>',
  '<li><strong>Advisory patterns.</strong> The same advisory three years running is a job nobody has done. On a part exchange that is a number you can put in the offer.</li>',
  '<li><strong>Gaps.</strong> A missing year usually means the vehicle sat. Perished rubber, seized calipers and a tired battery follow.</li>',
  '<li><strong>Failure rate against the fleet.</strong> The national initial failure rate gives you a baseline to judge a specific vehicle against.</li>',
  '</ul>',
  '<h2>What it is not</h2>',
  '<p>Being straight about this is the whole point of the site. The MOT record carries <strong>no</strong> finance, write-off, theft, keeper or import data. Those sit in separate commercial databases that we do not licence. Anyone offering you those from a free MOT lookup is either reselling somebody else&rsquo;s report or guessing. If you need a provenance check before you buy at auction, buy one from a provider who holds the licences, and treat this site as the free layer underneath it.</p>',
  '<p>The MOT also says nothing about the clutch, the gearbox, the engine internals, the air conditioning or the electronics. A vehicle can pass on the morning its head gasket goes.</p>',
  '<h2>Using it today</h2>',
  '<ol>',
  '<li>Run the registration on the <a href="/">free checker</a>. Full history, mileage chart and an automatic buyer report.</li>',
  '<li>Put a part exchange next to the vehicle you are selling on the <a href="/compare">compare page</a>.</li>',
  '<li>For vans and lorries, check which test regime applies before you quote: <a href="/guides/hgv-trailer-annual-test-vs-van-mot-uk">the 3,500kg line</a> decides whether a vehicle gets an MOT or a DVSA annual test.</li>',
  '<li>For anything over 40 years old, expect the record to stop: <a href="/guides/classic-car-mot-exemption-uk">MOT exemption</a> means the vehicle stops generating history.</li>',
  '</ol>',
  '<h2>What we are building</h2>',
  '<p>Bulk checking is the next thing on the list: paste or upload a list of registrations, get the MOT history for all of them back in one table you can export. It is not built yet and we are not taking sign-ups or payment for it. If it would be useful, say so and say roughly how many vehicles a month you would run, because that decides whether it is worth building.</p>',
  '<p>Email <a href="mailto:support@adminruhulamin.co.uk">support@adminruhulamin.co.uk</a>. A person reads it.</p>',
  '<h2>The commercial position, stated plainly</h2>',
  '<p>This site is free and stays free for the MOT record, because the MOT record is public data and charging for it would be indefensible. If a paid product ever appears here it will be for data we have had to licence, it will say exactly what is in it before you pay, and it will be priced against what the market actually charges rather than against the old anchor.</p>',
  '<h2>Frequently asked</h2>',
  faq.map(function(f){ return '<h3>' + esc(f.q) + '</h3><p>' + esc(f.a) + '</p>'; }).join(''),
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
  name: 'MOT Check UK', short_name: 'MOT Check',
  description: 'Free MOT history check for any UK registration.',
  start_url: '/', display: 'standalone', background_color: '#f6f7fb', theme_color: '#6366f1',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
});

const INDEXNOW_KEY = '7c4f9a2be85d41d0ab63f1e770c9d284';

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
  '<url><loc>' + SITE + '/ulez</loc><priority>0.9</priority><changefreq>monthly</changefreq></url>',
  '<url><loc>' + SITE + '/scorecard</loc><priority>0.9</priority><changefreq>monthly</changefreq></url>',
  '<url><loc>' + SITE + '/reminders</loc><priority>0.9</priority><changefreq>monthly</changefreq></url>',
  '<url><loc>' + SITE + '/trade</loc><priority>0.6</priority><changefreq>monthly</changefreq></url>',
  '</urlset>'
].join('');

var zlib = require('zlib');
function send(res, code, type, body, cache){
  var headers = {
    'Content-Type': type,
    'Cache-Control': cache || 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=15552000'
  };
  /* nothing upstream compresses (no CDN in front), so a 21KB page went out as 21KB.
     Text bodies over 1KB are gzipped here when the client accepts it. */
  var compressible = /^(text\/|application\/(json|xml|javascript|manifest))/.test(type) || type.indexOf('svg') > -1;
  if (res._gz && compressible && typeof body === 'string' && body.length > 1024) {
    body = zlib.gzipSync(Buffer.from(body, 'utf8'));
    headers['Content-Encoding'] = 'gzip';
  }
  if (compressible) headers['Vary'] = 'Accept-Encoding';
  res.writeHead(code, headers);
  res.end(body);
}

http.createServer(function(req, res){
  var raw = req.url || '/';
  var qi = raw.indexOf('?');
  var path = qi === -1 ? raw : raw.slice(0, qi);
  var query = qi === -1 ? '' : raw.slice(qi + 1);
  res._gz = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  if(path.length > 1 && path.charAt(path.length - 1) === '/'){
    /* /ulez/ used to serve a 200 duplicate of /ulez; one canonical URL per page */
    var stripped = path.replace(/\/+$/, '') || '/';
    res.writeHead(301, { Location: stripped + (query ? '?' + query : '') });
    return res.end();
  }
  var params = new URLSearchParams(query);

  if(path === '/healthz') return send(res, 200, 'application/json', JSON.stringify({ ok:true, cached:Object.keys(cache).length }), 'no-store');
  if(path === '/' + INDEXNOW_KEY + '.txt') return send(res, 200, 'text/plain; charset=utf-8', INDEXNOW_KEY, 'public, max-age=86400');
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

  if(path === '/ulez') return send(res, 200, 'text/html; charset=utf-8', ulezPage());
  if(path === '/compare') return send(res, 200, 'text/html; charset=utf-8', comparePage());
  if(path === '/scorecard') return send(res, 200, 'text/html; charset=utf-8', scorecardPage(cleanReg(params.get('reg'))));
  if(path === '/reminders') return send(res, 200, 'text/html; charset=utf-8', remindersPage(cleanReg(params.get('reg'))));
  if(path === '/trade') return send(res, 200, 'text/html; charset=utf-8', tradePage());

  if(path.indexOf('/check/') === 0){
    var pre0 = cleanReg(decodeURIComponent(path.slice(7)));
    if(!pre0) { res.writeHead(302, { Location:'/' }); return res.end(); }
    /* These are share links for one specific vehicle. There are millions of possible
       registrations and the served HTML is the same shell every time, so letting Google
       index them would burn crawl budget on near duplicates and leave the pages that
       matter uncrawled. Serve them, but keep them out of the index. */
    var body0 = homePage(pre0).replace(
      '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">',
      '<meta name="robots" content="noindex,follow">'
    ).replace(
      '<link rel="canonical" href="' + SITE + '/check/' + encodeURIComponent(pre0) + '">',
      '<link rel="canonical" href="' + SITE + '/">'
    );
    return send(res, 200, 'text/html; charset=utf-8', body0);
  }
  if(false){
    var pre = cleanReg(decodeURIComponent(path.slice(7)));
    if(!pre) { res.writeHead(302, { Location:'/' }); return res.end(); }
    return send(res, 200, 'text/html; charset=utf-8', homePage(pre));
  }

  if(path === '' || path === '/') return send(res, 200, 'text/html; charset=utf-8', homePage(cleanReg(params.get('reg'))));

  res.writeHead(301, { Location:'/' });
  res.end();
}).listen(PORT, function(){ console.log('bikemotcheck listening on ' + PORT); });
