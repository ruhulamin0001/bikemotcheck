(function(){
'use strict';
var $ = function(s){ return document.querySelector(s); };
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function num(v){ var n = parseInt(String(v==null?'':v).replace(/[^0-9]/g,''),10); return isNaN(n)?null:n; }
function dt(s){ if(!s) return null; var x = new Date(s); return isNaN(x.getTime())?null:x; }
var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmt(s){ var x = dt(s); if(!x) return ''; return x.getDate()+' '+MON[x.getMonth()]+' '+x.getFullYear(); }
function mi(t){ var n = num(t.odometerValue); if(n==null) return null;
  var u = String(t.odometerUnit==null?'':t.odometerUnit).toUpperCase();
  if(u.charAt(0)==='K') n = Math.round(n*0.621371); return n; }
function cm(n){ return String(n).replace(/(.)(?=(...)+$)/g,'$1,'); }
function cleanReg(s){ return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12); }
function plate(r){ return '<span class="miniplate"><span class="gb">GB</span><span class="no">'+esc(r)+'</span></span>'; }

/* Bike detection. The DVSA dataset has no vehicle class, so this is a heuristic.
   Rule: makes that ONLY sell motorcycles in the UK are treated as bikes outright.
   Makes that sell both, such as Honda and Suzuki, need strong extra evidence,
   because calling a car a motorcycle skews the mileage benchmark and the ULEZ standard.
   When unsure we default to CAR, which is the far more common case. */
var BIKE_ONLY = ['yamaha','kawasaki','ducati','ktm','triumph','harley-davidson','harley davidson',
  'aprilia','piaggio','vespa','lexmoto','sinnis','royal enfield','moto guzzi','husqvarna','benelli',
  'keeway','zontes','mutt','herald','fantic','sym','kymco','mv agusta','indian','norton','bullit',
  'rieju','beta','gas gas','sherco','lambretta','niu','super soco'];
var BIKE_MAYBE = ['honda','suzuki','bmw','peugeot','kawasaki motors'];
function isBike(v){
  var m = String(v.make == null ? '' : v.make).toLowerCase().trim();
  if(BIKE_ONLY.indexOf(m) > -1) return true;
  if(BIKE_MAYBE.indexOf(m) > -1){
    var e = num(v.engineSize);
    var fuel = String(v.fuelType == null ? '' : v.fuelType).toUpperCase();
    /* a sub 900cc petrol from a maker that sells both is almost certainly a bike,
       because essentially no UK car from these makers is under 900cc */
    if(e != null && e < 900 && fuel.indexOf('PETROL') > -1) return true;
  }
  return false;
}
var UK_CAR = 7100, UK_BIKE = 3000, UK_PASS = 78.3;

/* ---------- toast ---------- */
var toastEl = null;
function toast(msg){
  if(!toastEl){ toastEl = document.createElement('div'); toastEl.className='toast'; document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.classList.add('on');
  clearTimeout(toastEl._t); toastEl._t = setTimeout(function(){ toastEl.classList.remove('on'); }, 2000);
}

/* ---------- recent checks, this browser only ---------- */
var RKEY = 'bmc_recent_v1';
function readRecent(){ try{ return JSON.parse(localStorage.getItem(RKEY)||'[]'); }catch(e){ return []; } }
function pushRecent(reg, name){
  try{
    var list = readRecent().filter(function(x){ return x.reg !== reg; });
    list.unshift({ reg: reg, name: name || '' });
    localStorage.setItem(RKEY, JSON.stringify(list.slice(0,8)));
  }catch(e){}
  paintRecent();

/* ---------- analytics, loaded ONLY after the visitor agrees ----------
   UK PECR requires opt in for non essential cookies, so nothing loads until
   Allow is clicked. Declining is remembered too, so we stop asking. */
var GA_ID = 'G-VX0H5Z7VVV';
var CKEY = 'bmc_consent_v1';
function loadGA(){
  if(window.__gaOn) return;
  window.__gaOn = true;
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function(){ window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, { anonymize_ip: true });
}
function setConsent(v){
  try{ localStorage.setItem(CKEY, v); }catch(e){}
  var bar = document.querySelector('.consent');
  if(bar && bar.parentNode) bar.parentNode.removeChild(bar);
  if(v === 'yes') loadGA();
  toast(v === 'yes' ? 'Thanks, analytics on' : 'No analytics, noted');
}
function consentInit(){
  var c = null;
  try{ c = localStorage.getItem(CKEY); }catch(e){}
  if(c === 'yes'){ loadGA(); return; }
  if(c === 'no') return;
  var bar = document.createElement('div');
  bar.className = 'consent';
  bar.innerHTML = '<p>We use Google Analytics to see which pages people actually find useful. '
    + 'The registrations you look up are never sent to it, and there are no advertising cookies here.</p>'
    + '<div><button type="button" class="btn ghost js-consent-no">No thanks</button>'
    + '<button type="button" class="btn js-consent-yes">Allow</button></div>';
  document.body.appendChild(bar);
}
consentInit();

}
function paintRecent(){
  var box = $('#recent'); if(!box) return;
  var list = readRecent();
  if(!list.length){ box.innerHTML=''; return; }
  var h = '<span class="chip lbl">Recent</span>';
  list.forEach(function(x){
    h += '<button type="button" class="chip js-recent" data-reg="'+esc(x.reg)+'" title="'+esc(x.name||x.reg)+'">'+esc(x.reg)+'</button>';
  });
  h += '<button type="button" class="chip js-clear" style="font-weight:600">Clear</button>';
  box.innerHTML = h;
}

/* ---------- analysis ---------- */
function analyse(v){
  var raw = (v.motTests||[]).slice();
  var tests = raw.filter(function(t){ return !!t.completedDate; });
  tests.sort(function(a,b){ return new Date(a.completedDate) - new Date(b.completedDate); });
  var total = tests.length, passed = 0;
  tests.forEach(function(t){ if(String(t.testResult||'').toUpperCase().indexOf('PASS')===0) passed++; });
  var passRate = total ? Math.round(passed/total*1000)/10 : null;
  var pts = [];
  tests.forEach(function(t){ var m = mi(t), x = dt(t.completedDate); if(m!=null && x && m>0) pts.push({t:x.getTime(), m:m, date:t.completedDate}); });
  var back = [];
  for(var i=1;i<pts.length;i++){ if(pts[i].m < pts[i-1].m - 100){ pts[i].back = true; back.push({a:pts[i-1], b:pts[i]}); } }
  var apm = null;
  if(pts.length>=2){ var yrs = (pts[pts.length-1].t - pts[0].t)/31557600000, dm = pts[pts.length-1].m - pts[0].m;
    if(yrs>0.5 && dm>0) apm = Math.round(dm/yrs); }
  var dang = 0, defs = [];
  tests.forEach(function(t){ (t.defects||[]).forEach(function(x){ if(x.dangerous) dang++; defs.push(String(x.text||'').toLowerCase()); }); });
  var kws = ['tyre','brake','suspension','lamp','light','corros','exhaust','steering','emission','wiper','mirror','shock','leak','play','bulb'];
  var themes = [];
  kws.forEach(function(k){ var n = 0; defs.forEach(function(s){ if(s.indexOf(k)>-1) n++; }); if(n>=3) themes.push({k:k,n:n}); });
  themes.sort(function(a,b){ return b.n - a.n; });
  var gaps = [];
  for(var g=1;g<tests.length;g++){ var a1 = dt(tests[g-1].completedDate), b1 = dt(tests[g].completedDate);
    if(a1&&b1){ var days = Math.round((b1-a1)/86400000); if(days>430) gaps.push({from:tests[g-1].completedDate, to:tests[g].completedDate, days:days}); } }
  var expiry = null;
  raw.forEach(function(t){ if(t.expiryDate){ if(!expiry || t.expiryDate > expiry) expiry = t.expiryDate; } });
  var bike = isBike(v);
  var daysLeft = null;
  if(expiry){ var ex = dt(expiry); if(ex) daysLeft = Math.round((ex - new Date())/86400000); }
  return { tests:tests, total:total, passed:passed, passRate:passRate, pts:pts, back:back, apm:apm,
    dang:dang, themes:themes, gaps:gaps, expiry:expiry, daysLeft:daysLeft, bike:bike,
    bench: bike?UK_BIKE:UK_CAR, latest: pts.length?pts[pts.length-1].m:null };
}

/* ---------- mileage chart ---------- */
function chart(pts){
  if(!pts || pts.length < 2) return '';
  var W = 680, H = 240, P = 52;
  var xs = [], ys = [];
  pts.forEach(function(p){ xs.push(p.t); ys.push(p.m); });
  var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
  if(x1 === x0) return '';
  var y1 = Math.max.apply(null, ys) * 1.1;
  var px = function(t){ return P + (t-x0)/(x1-x0) * (W-P-20); };
  var py = function(m){ return H - 32 - (m/y1) * (H-32-18); };
  var d = '';
  pts.forEach(function(p,i){ d += (i?' L':'M') + px(p.t).toFixed(1) + ' ' + py(p.m).toFixed(1); });
  var area = d + ' L' + px(pts[pts.length-1].t).toFixed(1) + ' ' + (H-32) + ' L' + px(pts[0].t).toFixed(1) + ' ' + (H-32) + ' Z';
  var dots = '';
  pts.forEach(function(p){
    dots += '<circle cx="' + px(p.t).toFixed(1) + '" cy="' + py(p.m).toFixed(1) + '" r="4" fill="' + (p.back?'#e0453f':'#6366f1') + '">'
         +  '<title>' + fmt(p.date) + ': ' + cm(p.m) + ' miles</title></circle>';
  });
  var grid = '';
  for(var k=0;k<=3;k++){
    var vv = y1*k/3, yy = py(vv);
    grid += '<line x1="' + P + '" y1="' + yy.toFixed(1) + '" x2="' + (W-20) + '" y2="' + yy.toFixed(1) + '" stroke="currentColor" stroke-opacity="0.12"/>'
         +  '<text x="4" y="' + (yy+4).toFixed(1) + '" font-size="11" fill="currentColor" fill-opacity="0.55">' + Math.round(vv/1000) + 'k</text>';
  }
  var lab = '<text x="' + P + '" y="' + (H-8) + '" font-size="11" fill="currentColor" fill-opacity="0.55">' + new Date(x0).getFullYear() + '</text>'
          + '<text x="' + (W-52) + '" y="' + (H-8) + '" font-size="11" fill="currentColor" fill-opacity="0.55">' + new Date(x1).getFullYear() + '</text>';
  return '<div class="chart"><h3>Recorded mileage over time</h3>'
       + '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Recorded mileage over time">'
       + '<defs><linearGradient id="ar" x1="0" y1="0" x2="0" y2="1">'
       + '<stop offset="0" stop-color="#6366f1" stop-opacity="0.28"/><stop offset="1" stop-color="#6366f1" stop-opacity="0"/>'
       + '</linearGradient></defs>'
       + grid + lab
       + '<path d="' + area + '" fill="url(#ar)"/>'
       + '<path class="ln" d="' + d + '" fill="none" stroke="#6366f1" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
       + dots + '</svg>'
       + '<p class="meta">Red points are readings lower than the one before. Hover a point for the exact figure.</p></div>';
}

/* ---------- MOT countdown ring ---------- */
function ring(days){
  var pct = Math.max(0, Math.min(1, days/365));
  var r = 46, c = 2*Math.PI*r, off = c*(1-pct);
  var col = days < 0 ? '#e0453f' : (days < 30 ? '#c98a00' : '#0f9d63');
  return '<div class="ring"><svg width="104" height="104">'
       + '<circle cx="52" cy="52" r="' + r + '" fill="none" stroke="currentColor" stroke-opacity="0.14" stroke-width="9"/>'
       + '<circle cx="52" cy="52" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="9" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/>'
       + '</svg><div class="t"><b style="color:' + col + '">' + Math.abs(days) + '</b><span>' + (days<0?'days over':'days left') + '</span></div></div>';
}

/* ---------- buyer report flags ---------- */
/* ---------- ULEZ and Clean Air Zone estimate ---------- */
/* Estimated from fuel type and first registration date on the DVSA record.
   Registration date is indicative of the Euro standard, not proof of it. */
function ulezCheck(v, bike){
  var fuel = String(v.fuelType == null ? '' : v.fuelType).toUpperCase();
  var d = dt(v.firstUsedDate) || dt(v.registrationDate) || dt(v.manufactureDate);
  var res = { known:false, compliant:null, standard:'', exempt:false, note:'' };
  if(!d) return res;
  res.known = true;
  res.date = d;

  if(fuel.indexOf('ELECTRIC') > -1 || fuel.indexOf('HYDROGEN') > -1 || fuel.indexOf('FUEL CELL') > -1){
    if(fuel.indexOf('PETROL') === -1 && fuel.indexOf('DIESEL') === -1 && fuel.indexOf('HYBRID') === -1){
      res.compliant = true; res.exempt = true; res.standard = 'Zero emission';
      res.note = 'Fully electric and hydrogen vehicles produce no tailpipe emissions, so they are not charged in any UK zone.';
      return res;
    }
  }

  var years = (Date.now() - d.getTime()) / 31557600000;
  if(years >= 40){
    res.compliant = true; res.exempt = true; res.historic = true; res.standard = 'Historic';
    res.note = 'Vehicles built more than 40 years ago are exempt, but only once they are registered in the historic tax class. That sits on the V5C, not on the MOT record, so confirm it before relying on it.';
    return res;
  }

  var threshold, label, plain;
  if(bike){
    threshold = Date.UTC(2007, 6, 1); label = 'Euro 3';
    plain = 'Motorcycles and mopeds need to meet Euro 3, which generally means first registered from around July 2007.';
  } else if(fuel.indexOf('DIESEL') > -1 || fuel.indexOf('HEAVY OIL') > -1){
    threshold = Date.UTC(2015, 8, 1); label = 'Euro 6';
    plain = 'Diesel cars need to meet Euro 6, which generally means first registered from 1 September 2015. Diesel vans are usually September 2016.';
  } else {
    threshold = Date.UTC(2006, 0, 1); label = 'Euro 4';
    plain = 'Petrol cars need to meet Euro 4, which generally means first registered from January 2006.';
  }
  res.standard = label;
  res.note = plain;
  res.compliant = d.getTime() >= threshold;
  return res;
}

function ulezHtml(v, a){
  var u = ulezCheck(v, a.bike);
  if(!u.known){
    return '<h3>ULEZ and Clean Air Zone</h3><p class="meta">There is no first registration date on the DVSA record for this vehicle, so we cannot estimate its emissions zone status.</p>';
  }
  var ok = u.compliant;
  var cls = ok ? 'ok' : 'bad';
  var word = u.exempt ? 'Exempt' : (ok ? 'Likely compliant' : 'Likely NOT compliant');
  var h = '<h3>ULEZ and Clean Air Zone estimate</h3>';
  h += '<div class="flag"><span class="dot ' + (ok ? 'd-green' : 'd-red') + '"></span><div>'
     + '<strong style="font-size:19px" class="v ' + cls + '">' + word + '</strong>'
     + '<p class="meta">' + esc(u.note) + '</p>'
     + '<p class="meta">This vehicle was first used ' + fmt(u.date) + ' and is recorded as ' + esc(String(v.fuelType || 'unknown fuel').toLowerCase()) + '.</p>'
     + '</div></div>';

  if(!ok){
    h += '<p class="meta">If that is right, here is what it costs to drive into each charging zone.</p>';
    h += '<table><thead><tr><th>Zone</th><th>Daily charge for a non compliant car</th></tr></thead><tbody>';
    h += '<tr><td><strong>London ULEZ</strong>, all 32 boroughs</td><td><strong>&pound;12.50</strong>, every day of the year including weekends</td></tr>';
    h += '<tr><td>Birmingham Clean Air Zone</td><td>&pound;8</td></tr>';
    h += '<tr><td>Bristol Clean Air Zone</td><td>&pound;9</td></tr>';
    h += '<tr><td>Bath, Sheffield, Bradford, Portsmouth, Tyneside</td><td>No charge for private cars</td></tr>';
    h += '<tr><td>Glasgow, Edinburgh, Aberdeen, Dundee</td><td>You cannot pay. Non compliant vehicles are banned, and the penalty starts at &pound;60</td></tr>';
    h += '</tbody></table>';
    h += '<p class="meta"><strong>Commuting into London five days a week at &pound;12.50 a day is roughly &pound;3,000 a year.</strong> That is worth knowing before you buy, and it is worth negotiating with.</p>';
  } else if(!u.exempt){
    h += '<p class="meta">On this estimate you would not pay the &pound;12.50 London ULEZ charge, the &pound;8 Birmingham charge or the &pound;9 Bristol charge, and you would not be turned away from the Scottish low emission zones.</p>';
  }

  h += '<p class="meta" style="border-top:1px solid var(--line);padding-top:10px;margin-top:12px">'
     + '<strong>This is an estimate, not the official answer.</strong> We work it out from the fuel type and first registration date in the DVSA record, because the actual Euro standard is not published in that dataset. '
     + 'Registration date is a good guide, but the real standard varies by make, model and engine, and some vehicles met the standard early. '
     + 'Before you rely on it, check the free official checker at '
     + '<a href="https://tfl.gov.uk/modes/driving/check-your-vehicle/" rel="noopener" target="_blank">TfL</a>, which reads the actual vehicle record.</p>';
  return h;
}

function flagsOf(a, v){
  var f = [];
  if(a.back.length){
    f.push({c:'red', t:'Recorded mileage goes backwards',
      d:'On ' + fmt(a.back[0].b.date) + ' the reading was ' + cm(a.back[0].b.m) + ' miles, lower than ' + cm(a.back[0].a.m) + ' recorded on ' + fmt(a.back[0].a.date) + '. That can be a clerical error, a replaced instrument cluster, or a clocked vehicle. Ask the seller for the explanation in writing.'});
  } else if(a.pts.length >= 2){
    f.push({c:'green', t:'Mileage reads consistently forward',
      d:'Every recorded reading is equal to or higher than the one before it across ' + a.pts.length + ' tests.'});
  }
  if(a.apm != null){
    var pc = Math.round(a.apm/a.bench*100);
    var c = (pc > 150 || pc < 45) ? 'amber' : 'green';
    f.push({c:c, t:'About ' + cm(a.apm) + ' miles a year',
      d:'The UK average is roughly ' + cm(a.bench) + ' miles a year for a ' + (a.bike?'motorcycle':'car') + ', so this is around ' + pc + '% of typical use. '
        + (pc>150 ? 'High mileage is not automatically bad, but expect more wear on the clutch, suspension and bushes.'
        : (pc<45 ? 'Very low mileage can mean short cold journeys, which are hard on the exhaust, brakes and battery.'
        : 'That is in the normal range.'))});
  }
  if(a.passRate != null){
    var ok = a.passRate >= UK_PASS;
    f.push({c: ok?'green':'amber', t:'Passed ' + a.passed + ' of ' + a.total + ' tests, ' + a.passRate + '%',
      d:'The UK average first time pass rate is about ' + UK_PASS + '%. ' + (ok?'This vehicle is at or above that.':'This vehicle is below that, so budget for repair work at test time.')});
  }
  if(a.dang > 0){
    f.push({c:'red', t:a.dang + ' dangerous defect' + (a.dang>1?'s':'') + ' recorded',
      d:'A dangerous defect means the vehicle should not have been driven until it was repaired. Ask what was done and whether there is a receipt.'});
  }
  if(a.themes.length){
    var s = a.themes.slice(0,3).map(function(x){ return x.k + ' (' + x.n + ')'; }).join(', ');
    f.push({c:'amber', t:'Recurring theme: ' + s,
      d:'The same area has come up repeatedly across tests. That is usually either an unfixed underlying fault or an owner who only repairs at MOT time.'});
  }
  if(a.gaps.length){
    f.push({c:'amber', t:'Gap of ' + a.gaps[0].days + ' days between tests',
      d:'Between ' + fmt(a.gaps[0].from) + ' and ' + fmt(a.gaps[0].to) + ' there is no MOT record. The vehicle may have been off the road, declared SORN, or driven untested.'});
  }
  if(v.hasOutstandingRecall === 'Yes'){
    f.push({c:'red', t:'Outstanding safety recall',
      d:'DVSA records an unresolved manufacturer recall. A franchised dealer will normally fix this free of charge.'});
  }
  return f;
}

/* ---------- stat tiles ---------- */
function stats(a){
  var h = '<div class="stats">';
  if(a.latest != null) h += '<div class="stat"><div class="k">Latest mileage</div><div class="v">' + cm(a.latest) + '</div><div class="n">miles at last test</div></div>';
  if(a.apm != null){
    var pc = Math.round(a.apm/a.bench*100);
    var cls = (pc>150||pc<45) ? 'warn' : 'ok';
    h += '<div class="stat"><div class="k">Per year</div><div class="v ' + cls + '">' + cm(a.apm) + '</div><div class="n">UK average ' + cm(a.bench) + '</div></div>';
  }
  if(a.passRate != null){
    var pcls = a.passRate >= UK_PASS ? 'ok' : 'warn';
    h += '<div class="stat"><div class="k">Pass rate</div><div class="v ' + pcls + '">' + a.passRate + '%</div><div class="n">' + a.passed + ' of ' + a.total + ' tests</div></div>';
  }
  var dcls = a.dang > 0 ? 'bad' : 'ok';
  h += '<div class="stat"><div class="k">Dangerous</div><div class="v ' + dcls + '">' + a.dang + '</div><div class="n">defects recorded</div></div>';
  return h + '</div>';
}

/* ---------- full report ---------- */
function reportHtml(v, a){
  var reg = String(v.registration||'').toUpperCase();
  var name = String(v.make||'') + ' ' + String(v.model||'');
  var h = '<section class="card">';
  h += '<div class="vhead"><div><h2>' + esc(name.trim()) + '</h2>'
     + '<p class="meta" style="margin:6px 0 0">' + plate(reg)
     + (v.primaryColour ? ' &nbsp;' + esc(v.primaryColour) : '')
     + (v.fuelType ? ' &middot; ' + esc(v.fuelType) : '')
     + (v.engineSize ? ' &middot; ' + esc(v.engineSize) + 'cc' : '')
     + (v.firstUsedDate ? ' &middot; first used ' + fmt(v.firstUsedDate) : '') + '</p></div>';
  if(a.daysLeft != null){
    h += '<div class="cd">' + ring(a.daysLeft) + '<div><div class="k meta" style="font-weight:700;text-transform:uppercase;font-size:12px">MOT expires</div>'
       + '<div style="font-size:19px;font-weight:800;letter-spacing:-.02em">' + fmt(a.expiry) + '</div>'
       + '<a class="btn ghost" style="display:inline-block;margin-top:8px;text-decoration:none" href="/calendar/' + encodeURIComponent(reg) + '.ics?d=' + encodeURIComponent(a.expiry) + '&v=' + encodeURIComponent(name.trim()) + '">Add reminder to calendar</a></div></div>';
  }
  h += '</div>';
  h += stats(a);
  h += '<h3>Buyer report</h3>';
  flagsOf(a, v).forEach(function(f){
    h += '<div class="flag"><span class="dot d-' + f.c + '"></span><div><strong>' + esc(f.t) + '</strong><p class="meta">' + esc(f.d) + '</p></div></div>';
  });
  h += chart(a.pts);
  h += ulezHtml(v, a);
  h += '<div class="actions noprint">'
     + '<button type="button" class="btn ghost js-share" data-reg="' + esc(reg) + '">Share this check</button>'
     + '<button type="button" class="btn ghost js-print">Print or save as PDF</button>'
     + '<a class="btn ghost" style="text-decoration:none" href="/compare?a=' + encodeURIComponent(reg) + '">Compare with another vehicle</a>'
     + '</div>';
  h += '</section>';
  h += '<section class="card"><h3 style="margin-top:0">Full MOT history, ' + a.total + ' tests</h3>';
  a.tests.slice().reverse().forEach(function(t){
    var p = String(t.testResult||'').toUpperCase().indexOf('PASS') === 0;
    var m = mi(t);
    h += '<div class="test"><div class="top"><span class="pill ' + (p?'p-pass':'p-fail') + '">' + (p?'PASS':'FAIL') + '</span>'
       + '<strong>' + fmt(t.completedDate) + '</strong>'
       + '<span class="meta" style="margin-left:auto">' + (m!=null ? cm(m)+' miles' : 'no odometer reading') + '</span></div>';
    if(t.expiryDate) h += '<p class="meta" style="margin:5px 0 0">Valid to ' + fmt(t.expiryDate) + '</p>';
    if(t.defects && t.defects.length){
      h += '<ul class="defects">';
      t.defects.forEach(function(x){
        h += '<li><span class="tag' + (x.dangerous?' dang':'') + '">' + esc(String(x.type||'').replace(/_/g,' ')) + (x.dangerous?' DANGEROUS':'') + '</span>' + esc(x.text||'') + '</li>';
      });
      h += '</ul>';
    }
    h += '</div>';
  });
  h += '</section>';
  return h;
}

function notFound(v, reg){
  return '<section class="card"><h2 style="margin-top:0">' + esc((v && v.error) ? v.error : ('No record found for ' + reg)) + '</h2>'
       + '<p class="meta">Check the registration and try again. DVSA holds records for England, Scotland and Wales only. Northern Ireland MOTs are run by the DVA and are not included. Vehicles under three years old have not had a first MOT yet.</p></section>';
}

function skeleton(reg){
  return '<section class="card"><p class="meta">Checking ' + esc(reg) + ' with DVSA</p>'
       + '<div class="sk" style="width:52%;height:26px"></div><div class="sk" style="width:32%"></div>'
       + '<div class="stats"><div class="stat"><div class="sk" style="width:60%"></div><div class="sk" style="height:26px"></div></div>'
       + '<div class="stat"><div class="sk" style="width:60%"></div><div class="sk" style="height:26px"></div></div>'
       + '<div class="stat"><div class="sk" style="width:60%"></div><div class="sk" style="height:26px"></div></div>'
       + '<div class="stat"><div class="sk" style="width:60%"></div><div class="sk" style="height:26px"></div></div></div>'
       + '<div class="sk" style="width:88%"></div><div class="sk" style="width:76%"></div><div class="sk" style="width:81%"></div></section>';
}

function fetchReg(reg){
  return fetch('/api/mot?reg=' + encodeURIComponent(reg)).then(function(r){ return r.json(); });
}

/* ---------- single vehicle flow ---------- */
function render(v, reg){
  var out = $('#out'); if(!out) return;
  if(!v || v.error || !v.registration){ out.innerHTML = notFound(v, reg); return; }
  var a = analyse(v);
  var r = String(v.registration||reg||'').toUpperCase();
  var name = (String(v.make||'') + ' ' + String(v.model||'')).trim();
  document.title = r + ' MOT history, mileage and failures | Bike MOT Check UK';
  out.innerHTML = reportHtml(v, a);
  pushRecent(r, name);
  try{ history.replaceState({}, '', '/check/' + encodeURIComponent(r)); }catch(e){}
  var y = out.getBoundingClientRect().top + window.scrollY - 70;
  if(window.scrollY < y - 40) window.scrollTo({ top:y, behavior:'smooth' });
}

function run(reg){
  var el = $('#reg');
  reg = cleanReg(reg != null ? reg : (el ? el.value : ''));
  if(reg.length < 2){ toast('Enter a registration'); return; }
  if(el) el.value = reg;
  var out = $('#out'); if(out) out.innerHTML = skeleton(reg);
  var btn = $('#go'); if(btn){ btn.disabled = true; btn.textContent = 'Checking'; }
  fetchReg(reg).then(function(v){ render(v, reg); }).catch(function(){
    if(out) out.innerHTML = '<section class="card"><h2 style="margin-top:0">Could not reach the DVSA service</h2><p class="meta">This is usually temporary. Please try again in a moment.</p></section>';
  }).then(function(){
    if(btn){ btn.disabled = false; btn.textContent = 'Check MOT history'; }
  });
}

/* ---------- compare flow ---------- */
function cmpCol(v, reg){
  if(!v || v.error || !v.registration){
    return '<div class="col card"><h3 style="margin-top:0">' + esc(reg) + '</h3><p class="meta">' + esc((v&&v.error)?v.error:'No record found.') + '</p></div>';
  }
  var a = analyse(v);
  var r = String(v.registration).toUpperCase();
  var name = (String(v.make||'') + ' ' + String(v.model||'')).trim();
  var h = '<div class="col card"><h3 style="margin-top:0">' + esc(name) + '</h3>';
  h += '<p class="meta">' + plate(r) + (v.firstUsedDate ? ' &nbsp;first used ' + fmt(v.firstUsedDate) : '') + '</p>';
  h += '<table>';
  h += '<tr><th>Latest mileage</th><td>' + (a.latest!=null ? cm(a.latest) + ' mi' : 'not recorded') + '</td></tr>';
  h += '<tr><th>Miles per year</th><td>' + (a.apm!=null ? cm(a.apm) + ' (UK avg ' + cm(a.bench) + ')' : 'not enough data') + '</td></tr>';
  h += '<tr><th>Pass rate</th><td>' + (a.passRate!=null ? a.passRate + '% of ' + a.total + ' tests' : 'no tests') + '</td></tr>';
  h += '<tr><th>Dangerous defects</th><td>' + a.dang + '</td></tr>';
  h += '<tr><th>Mileage rollback</th><td>' + (a.back.length ? 'Yes, ' + a.back.length : 'None found') + '</td></tr>';
  h += '<tr><th>Recurring faults</th><td>' + (a.themes.length ? esc(a.themes.slice(0,3).map(function(x){return x.k;}).join(', ')) : 'None') + '</td></tr>';
  h += '<tr><th>MOT expires</th><td>' + (a.expiry ? fmt(a.expiry) + (a.daysLeft!=null ? ' (' + (a.daysLeft<0 ? Math.abs(a.daysLeft) + ' days over' : a.daysLeft + ' days left') + ')' : '') : 'unknown') + '</td></tr>';
  h += '</table>';
  h += chart(a.pts);
  h += '<p><a href="/check/' + encodeURIComponent(r) + '">Full report for ' + esc(r) + '</a></p>';
  return h + '</div>';
}

function verdict(va, vb, ra, rb){
  if(!va || va.error || !vb || vb.error) return '';
  var a = analyse(va), b = analyse(vb);
  var pa = 0, pb = 0, notes = [];
  if(a.dang !== b.dang){ if(a.dang < b.dang){ pa++; notes.push(ra + ' has fewer dangerous defects'); } else { pb++; notes.push(rb + ' has fewer dangerous defects'); } }
  if(a.passRate != null && b.passRate != null && a.passRate !== b.passRate){
    if(a.passRate > b.passRate){ pa++; notes.push(ra + ' has the better pass rate'); } else { pb++; notes.push(rb + ' has the better pass rate'); } }
  if(a.back.length !== b.back.length){ if(a.back.length < b.back.length){ pa++; notes.push(ra + ' has a cleaner mileage trail'); } else { pb++; notes.push(rb + ' has a cleaner mileage trail'); } }
  if(a.themes.length !== b.themes.length){ if(a.themes.length < b.themes.length){ pa++; notes.push(ra + ' has fewer recurring faults'); } else { pb++; notes.push(rb + ' has fewer recurring faults'); } }
  var lead = pa === pb ? 'These two look closely matched on the MOT record.' : ('On the MOT record alone, ' + (pa>pb?ra:rb) + ' looks like the stronger history.');
  return '<section class="card glass"><h3 style="margin-top:0">What the records say</h3><p><strong>' + esc(lead) + '</strong></p>'
       + (notes.length ? '<ul><li>' + notes.map(esc).join('</li><li>') + '</li></ul>' : '')
       + '<p class="meta">This only compares MOT history. It says nothing about price, condition, service history or outstanding finance, and a better MOT record does not make a vehicle the better buy on its own.</p></section>';
}

function runCompare(ra, rb){
  ra = cleanReg(ra); rb = cleanReg(rb);
  var out = $('#cout'); if(!out) return;
  if(ra.length < 2 || rb.length < 2){ toast('Enter both registrations'); return; }
  out.innerHTML = '<div class="cmp">' + skeleton(ra) + skeleton(rb) + '</div>';
  var btn = $('#cgo'); if(btn){ btn.disabled = true; btn.textContent = 'Comparing'; }
  Promise.all([fetchReg(ra), fetchReg(rb)]).then(function(res){
    out.innerHTML = verdict(res[0], res[1], ra, rb) + '<div class="cmp">' + cmpCol(res[0], ra) + cmpCol(res[1], rb) + '</div>'
      + '<div class="actions noprint"><button type="button" class="btn ghost js-print">Print or save as PDF</button></div>';
    try{ history.replaceState({}, '', '/compare?a=' + encodeURIComponent(ra) + '&b=' + encodeURIComponent(rb)); }catch(e){}
    if(res[0] && res[0].registration) pushRecent(ra, (String(res[0].make||'') + ' ' + String(res[0].model||'')).trim());
    if(res[1] && res[1].registration) pushRecent(rb, (String(res[1].make||'') + ' ' + String(res[1].model||'')).trim());
  }).catch(function(){
    out.innerHTML = '<section class="card"><p>Could not reach the DVSA service. Please try again in a moment.</p></section>';
  }).then(function(){ if(btn){ btn.disabled = false; btn.textContent = 'Compare both'; } });
}

/* ---------- share ---------- */
function shareIt(reg){
  var url = location.origin + '/check/' + encodeURIComponent(reg);
  if(navigator.share){ navigator.share({ title:'MOT history for ' + reg, url:url }).catch(function(){}); return; }
  if(navigator.clipboard){ navigator.clipboard.writeText(url).then(function(){ toast('Link copied'); }).catch(function(){ prompt('Copy this link', url); }); return; }
  prompt('Copy this link', url);
}

/* ---------- wiring ---------- */
document.addEventListener('click', function(e){
  var t = e.target;
  if(!t || !t.closest) return;
  var s = t.closest('.js-share'); if(s){ shareIt(s.getAttribute('data-reg')); return; }
  if(t.closest('.js-print')){ window.print(); return; }
  var rc = t.closest('.js-recent');
  if(rc){
    var reg = rc.getAttribute('data-reg');
    if($('#ra')){ if(!$('#ra').value) $('#ra').value = reg; else $('#rb').value = reg; return; }
    if($('#reg')){ $('#reg').value = reg; run(reg); }
    return;
  }
  if(t.closest('.js-consent-yes')){ setConsent('yes'); return; }
  if(t.closest('.js-consent-no')){ setConsent('no'); return; }
  if(t.closest('.js-clear')){ try{ localStorage.removeItem(RKEY); }catch(err){} paintRecent(); toast('Recent checks cleared'); return; }
});

['#reg','#ra','#rb'].forEach(function(sel){
  var el = $(sel); if(!el) return;
  el.addEventListener('input', function(){
    var p = this.selectionStart, before = this.value;
    this.value = this.value.toUpperCase();
    if(before !== this.value){ try{ this.setSelectionRange(p,p); }catch(e){} }
  });
});

var f = $('#f');
if(f) f.addEventListener('submit', function(e){ e.preventDefault(); run(); });
var cf = $('#cf');
if(cf) cf.addEventListener('submit', function(e){ e.preventDefault(); runCompare($('#ra').value, $('#rb').value); });

paintRecent();

(function boot(){
  var q = new URLSearchParams(location.search);
  if($('#ra')){
    var qa = q.get('a'), qb = q.get('b');
    if(qa) $('#ra').value = cleanReg(qa);
    if(qb) $('#rb').value = cleanReg(qb);
    if(qa && qb) runCompare(qa, qb);
    return;
  }
  var el = $('#reg'); if(!el) return;
  if(!el.value && location.pathname.indexOf('/check/') === 0){
    el.value = cleanReg(decodeURIComponent(location.pathname.slice(7)));
  }
  if(!el.value && q.get('reg')) el.value = cleanReg(q.get('reg'));
  if(el.value.length > 1) run(el.value);
})();
})();
