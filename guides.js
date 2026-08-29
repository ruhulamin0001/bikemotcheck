/* Remote guides. A new guide goes live with ONE commit to guides-data.json,
   with no container rebuild. Falls back to the built-in guides if anything fails. */
var _https = require('https');
var REMOTE = [];
var REMOTE_URL = 'https://raw.githubusercontent.com/ruhulamin0001/bikemotcheck/main/guides-data.json';
function allGuides(){ try { return REMOTE.concat(BUILTIN); } catch(e){ return []; } }
function loadRemoteGuides(){
  try {
    _https.get(REMOTE_URL, { headers: { 'User-Agent': 'motcheck-guides' } }, function(res){
      if (res.statusCode !== 200) { res.resume(); return; }
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function(c){ body += c; if (body.length > 5000000) res.destroy(); });
      res.on('end', function(){
        try {
          var arr = JSON.parse(body);
          if (!Array.isArray(arr)) return;
          var builtin = BUILTIN.map(function(x){ return x.slug; });
          var seen = {};
          var out = [];
          arr.forEach(function(x){
            if (!x || typeof x.slug !== 'string' || typeof x.title !== 'string' || typeof x.body !== 'string') return;
            if (!/^[a-z0-9-]{3,80}$/.test(x.slug)) return;
            if (builtin.indexOf(x.slug) > -1) return;
            if (seen[x.slug]) return;
            seen[x.slug] = 1;
            out.push({ slug: x.slug, title: x.title, desc: String(x.desc || ''), date: String(x.date || ''), mins: Number(x.mins) || 6, body: x.body });
          });
          REMOTE = out;
          console.log('remote guides loaded: ' + REMOTE.length);
        } catch(e) { console.log('remote guides parse failed'); }
      });
    }).on('error', function(){ console.log('remote guides fetch failed'); });
  } catch(e) {}
}
loadRemoteGuides();
setInterval(loadRemoteGuides, 300000);

const http = require('http');
const PORT = process.env.PORT || 8080;
const SITE = 'https://bikemotcheckuk.cloud';

function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

const CSS = [
":root{--bg:#f7f9f8;--card:#fff;--ink:#14201b;--mut:#5d6b64;--line:#e2e9e5;--brand:#0a8f5b;--warn:#d18a00;--bad:#d33}",
"@media(prefers-color-scheme:dark){:root{--bg:#0f1512;--card:#161d19;--ink:#e8efea;--mut:#9db0a5;--line:#26302b}}",
"*{box-sizing:border-box}",
"body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}",
".wrap{max-width:760px;margin:0 auto;padding:20px 18px 64px}",
"header.site{border-bottom:1px solid var(--line);background:var(--card)}",
"header.site .wrap{padding:14px 18px;display:flex;justify-content:space-between;align-items:center;gap:12px}",
"a{color:var(--brand)}",
".brand{font-weight:700;text-decoration:none;color:var(--ink)}",
".cta{display:inline-block;background:var(--brand);color:#fff;text-decoration:none;padding:9px 15px;border-radius:9px;font-size:14px;font-weight:600}",
"h1{font-size:31px;line-height:1.22;margin:22px 0 10px}",
"h2{font-size:22px;margin:32px 0 10px;scroll-margin-top:80px}",
"h3{font-size:18px;margin:22px 0 8px}",
".stand{font-size:18px;color:var(--mut);margin:0 0 18px}",
".meta{color:var(--mut);font-size:14px}",
".card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:20px 0}",
".short li{margin:7px 0}",
"table{width:100%;border-collapse:collapse;margin:16px 0;font-size:15px}",
"th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}",
"th{background:rgba(10,143,91,.07);font-weight:600}",
".toc a{display:block;padding:4px 0}",
".tag{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.03em;padding:2px 8px;border-radius:20px;background:rgba(10,143,91,.12);color:var(--brand)}",
".t-bad{background:rgba(221,51,51,.14);color:var(--bad)}",
".t-warn{background:rgba(209,138,0,.16);color:var(--warn)}",
"footer{border-top:1px solid var(--line);margin-top:40px;padding-top:18px;color:var(--mut);font-size:14px}",
".gcard{display:block;text-decoration:none;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:12px 0}",
".gcard:hover{border-color:var(--brand)}",
".gcard h3{margin:0 0 5px;font-size:18px;color:var(--ink)}",
".gcard p{margin:0;color:var(--mut);font-size:15px}",
".consent{position:fixed;left:14px;right:14px;bottom:14px;z-index:120;max-width:640px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:0 18px 50px rgba(15,23,42,.22);display:flex;gap:14px;align-items:center;flex-wrap:wrap}",
".consent p{margin:0;flex:1 1 280px;font-size:14px;color:var(--mut);line-height:1.5}",
".consent div{display:flex;gap:8px;flex:0 0 auto}",
".consent button{cursor:pointer;font:inherit;font-size:14px;font-weight:700;border-radius:10px;padding:9px 16px;border:0}",
".consent .yes{background:var(--brand);color:#fff}",
".consent .no{background:transparent;color:var(--brand);border:1.5px solid var(--line)}"
].join('');

const AUTHOR = "Written by Ruhul Amin, Hertfordshire. I built the free MOT history checker on this site. I am not a mechanic, so everything here is sourced from DVSA and GOV.UK rather than from opinion.";
const DISCLAIM = "This guide is general information about the MOT test in England, Scotland and Wales. It is not legal advice and it is not a substitute for a qualified mechanic looking at your vehicle.";

const BUILTIN = [
{
 slug: 'what-fails-an-mot-uk',
 title: 'What Actually Fails an MOT in the UK, and What It Costs to Put Right',
 desc: 'Roughly one in four cars fails its first MOT attempt. Here is what really causes it, using DVSA data, and what each repair usually costs.',
 date: '2026-08-21',
 mins: 7,
 body: [
"<p class='stand'>About 27% of cars and light vans fail at the first attempt. Almost none of it is exotic. The same handful of parts account for most of it, and several of them cost less than the retest.</p>",
"<div class='card short'><strong>The short version</strong><ul>",
"<li><strong>78.3% pass first time</strong> across roughly 57.6 million tests, so the initial failure rate sits around 21 to 27% depending on vehicle class and quarter. DVSA recorded a <strong>27.24% initial failure rate for class 3 and 4 vehicles</strong> in April to June 2025.</li>",
"<li><strong>Lamps, reflectors and electrical equipment</strong> is consistently the single biggest failure category, at roughly <strong>11% of all fails</strong>. A bulb costs a few pounds.</li>",
"<li><strong>Suspension</strong> appears in close to <strong>20% of initial failures</strong>. That one is not cheap.</li>",
"<li>An analysis of over <strong>200 million DVSA test records</strong> put <strong>handbrake inefficiency</strong> top of the individual defect list, with over 9.1 million recorded failures since 2005.</li>",
"<li>The MOT fee is capped by law at <strong>&pound;54.85 for a car</strong> and <strong>&pound;29.65 for a motorcycle</strong>. Garages can charge less. Many do.</li>",
"</ul></div>",
"<div class='card toc'><strong>On this page</strong>",
"<a href='#categories'>1. Where the failures actually come from</a>",
"<a href='#cheap'>2. The cheap fixes people still fail on</a>",
"<a href='#expensive'>3. The expensive ones</a>",
"<a href='#costs'>4. Rough repair costs</a>",
"<a href='#retest'>5. The retest rules that save you money</a>",
"<a href='#check'>6. A ten minute check before you book</a>",
"<a href='#faq'>Frequently asked</a></div>",
"<h2 id='categories'>1. Where the failures actually come from</h2>",
"<p>DVSA groups defects into sections, and the ranking barely moves year to year. Lighting and electrics is always first. Suspension is always near the top by share of failures. Tyres, brakes and driver visibility fill out the rest.</p>",
"<table><thead><tr><th>Area</th><th>Share of failures</th><th>Typical cause</th></tr></thead><tbody>",
"<tr><td>Lamps, reflectors, electrical</td><td>Around 11%</td><td>Blown bulb, cracked lens, misaligned headlamp</td></tr>",
"<tr><td>Suspension</td><td>Close to 20% of initial fails</td><td>Worn bushes, leaking shock absorber, corroded spring</td></tr>",
"<tr><td>Brakes</td><td>High, often flagged dangerous</td><td>Handbrake efficiency, worn pads, imbalance</td></tr>",
"<tr><td>Tyres</td><td>High</td><td>Below 1.6mm tread, sidewall damage, wrong sizes</td></tr>",
"<tr><td>Driver visibility</td><td>Moderate</td><td>Wipers, washers, chip in the swept area</td></tr>",
"</tbody></table>",
"<p class='meta'>Shares vary by source and by quarter because different datasets count initial fails, final fails and individual defects differently. Treat these as the shape of the problem rather than exact numbers.</p>",
"<h2 id='cheap'>2. The cheap fixes people still fail on</h2>",
"<p>This is the frustrating part. A large slice of MOT failures are things you could have found in your driveway in ten minutes.</p>",
"<p><strong>Bulbs.</strong> Every bulb has to work, including the number plate lights and the rear fog. A single dead bulb is a major defect and a fail.</p>",
"<p><strong>Washers and wipers.</strong> Empty washer bottle, torn wiper blade, or a smear across the swept area of the screen. All fails. The washer bottle is free to fix.</p>",
"<p><strong>Number plate.</strong> Wrong font, wrong spacing, a green flash where it should not be, or a plate so faded the tester cannot read it.</p>",
"<p><strong>Registered keeper details on the screen.</strong> Not a fail, but a chip larger than 10mm in the driver's line of sight is, and larger than 40mm anywhere else in the swept area is too.</p>",
"<p><strong>Boot and bonnet catches, seatbelts, horn, mirrors.</strong> All checked. All cheap.</p>",
"<h2 id='expensive'>3. The expensive ones</h2>",
"<p><strong>Suspension.</strong> The single biggest cost risk. A leaking shock absorber, a snapped coil spring or perished bushes are common on any car over about eight years old, and they are labour heavy.</p>",
"<p><strong>Corrosion.</strong> If a structural area within 30cm of a mounting point for the suspension, steering, seatbelts or brakes is corroded, it fails. On an older car this can be the end of it economically.</p>",
"<p><strong>Emissions.</strong> A diesel that smokes visibly fails outright. A failed catalytic converter or diesel particulate filter is a four figure job on some cars.</p>",
"<p><strong>Brakes.</strong> Pads and discs are routine. A seized caliper or a corroded brake line is not.</p>",
"<h2 id='costs'>4. Rough repair costs</h2>",
"<table><thead><tr><th>Job</th><th>Typical UK cost</th></tr></thead><tbody>",
"<tr><td>Bulb replacement</td><td>&pound;5 to &pound;25 fitted</td></tr>",
"<tr><td>Wiper blades, pair</td><td>&pound;15 to &pound;45</td></tr>",
"<tr><td>Front brake pads</td><td>&pound;90 to &pound;180</td></tr>",
"<tr><td>Front pads and discs</td><td>&pound;180 to &pound;350</td></tr>",
"<tr><td>One shock absorber</td><td>&pound;120 to &pound;300</td></tr>",
"<tr><td>Coil spring</td><td>&pound;120 to &pound;250</td></tr>",
"<tr><td>Budget tyre, fitted, 15 to 16 inch</td><td>&pound;45 to &pound;80</td></tr>",
"<tr><td>Windscreen replacement</td><td>&pound;180 to &pound;450, often free on a chip repair with comprehensive cover</td></tr>",
"</tbody></table>",
"<p class='meta'>These are indicative independent garage prices for a common family car in August 2026. Franchised dealers charge more. Always get the price before you agree to the work.</p>",
"<h2 id='retest'>5. The retest rules that save you money</h2>",
"<p>If your vehicle fails, you get a partial retest free if you leave it at the test centre and it is repaired and retested <strong>before the end of the next working day</strong>. If you take it away and bring it back <strong>within 10 working days</strong>, you get a partial retest, and many garages do that free or at a reduced fee, though they are allowed to charge.</p>",
"<p>Beyond 10 working days it is a full test at the full fee. So if you fail on a Friday, that clock matters.</p>",
"<p>You also do not have to use the garage that failed it. If the quote feels high, take the failure sheet elsewhere. The defect list is standardised.</p>",
"<h2 id='check'>6. A ten minute check before you book</h2>",
"<ol>",
"<li>Ask someone to stand outside while you work every light: side, dip, main, indicators both sides, hazards, brake lights, reverse, fog front and rear, number plate lights.</li>",
"<li>Push a 20p coin into the tread groove. If the outer band of the coin is visible, the tread is likely under 1.6mm and it is a fail.</li>",
"<li>Check tyre sidewalls for bulges and cuts, and check the pressures.</li>",
"<li>Top up the washer bottle and run the wipers on a wet screen.</li>",
"<li>Pull the handbrake. If it comes up to the last click or the car rolls on a slope, get it adjusted first.</li>",
"<li>Look at the windscreen from the driver's seat for chips.</li>",
"<li>Check the horn, the seatbelts for fraying, and that both mirrors are secure.</li>",
"</ol>",
"<p>None of that guarantees a pass. It removes the cheap, avoidable fails, which is most of them.</p>",
"<h2 id='faq'>Frequently asked</h2>",
"<p><strong>Can I drive my car to the MOT if the current one has expired?</strong> Yes, but only to a pre booked test appointment, or to or from a garage for repairs. Anywhere else and you risk the fine.</p>",
"<p><strong>Does a service count as an MOT?</strong> No. They are separate. A service is the garage's own checklist. The MOT is a legal roadworthiness test with a standardised defect list.</p>",
"<p><strong>Will the garage fail it on purpose to sell me work?</strong> The vast majority will not, and DVSA audits testers. If you are unsure, take the failure sheet to a second garage for a quote. You are never obliged to have the repairs done where you tested.</p>",
"<p><strong>Does an advisory mean I have to fix something?</strong> No. An advisory is a note that something will need attention later. It does not affect the pass.</p>"
 ].join('')
},
{
 slug: 'spot-a-clocked-car-uk',
 title: 'How to Spot a Clocked Car Before You Hand Over the Money',
 desc: 'Mileage fraud is legal to commit and illegal to profit from. The MOT history is the cheapest way to catch it. Here is exactly what to look for.',
 date: '2026-08-21',
 mins: 7,
 body: [
"<p class='stand'>Adjusting an odometer is not itself a criminal offence in the UK. Selling a vehicle without disclosing it is. That gap is why clocking is still common, and why the free MOT history is the single most useful thing a private buyer can read.</p>",
"<div class='card short'><strong>The short version</strong><ul>",
"<li>Every MOT test since 2005 records the odometer reading. That gives you a <strong>timestamped mileage trail you cannot easily fake</strong>, because it sits on DVSA's systems, not the seller's.</li>",
"<li>A reading that goes <strong>down</strong> between tests is the obvious red flag, but it is not always fraud. A replaced instrument cluster or a keying error does the same thing.</li>",
"<li>The UK average is roughly <strong>7,100 miles a year for a car</strong> and about <strong>3,000 for a motorcycle</strong>. A car doing 2,000 a year is as worth questioning as one doing 25,000.</li>",
"<li>A <strong>gap in the MOT record</strong> can hide a period of heavy use, an insurance write off, or a SORN.</li>",
"<li>Check the mileage against the <strong>wear</strong>. A 40,000 mile car with a polished steering wheel and worn pedal rubbers is telling you something.</li>",
"</ul></div>",
"<div class='card toc'><strong>On this page</strong>",
"<a href='#why'>1. Why clocking still happens</a>",
"<a href='#mot'>2. What the MOT history shows you</a>",
"<a href='#reading'>3. Reading the mileage line properly</a>",
"<a href='#innocent'>4. Innocent explanations that look bad</a>",
"<a href='#physical'>5. The physical checks that back it up</a>",
"<a href='#worked'>6. A worked example</a>",
"<a href='#faq'>Frequently asked</a></div>",
"<h2 id='why'>1. Why clocking still happens</h2>",
"<p>Mileage moves money. On a typical five year old hatchback, taking 40,000 miles off the clock can add well over a thousand pounds to the asking price, and the tools to do it are cheap and widely sold as mileage correction equipment.</p>",
"<p>The law sits in an awkward place. Adjusting the reading is not an offence in itself, because there are legitimate reasons to do it, such as fitting a replacement instrument cluster. Selling the vehicle afterwards without telling the buyer is a offence under consumer protection law. In practice, proving what the seller knew is the hard part, which is why prevention beats redress here.</p>",
"<h2 id='mot'>2. What the MOT history shows you</h2>",
"<p>Since 2005 the tester records the odometer at every test. DVSA publishes that history free, and our <a href='/'>MOT history checker</a> reads it directly from the DVSA API and lays the readings out in order.</p>",
"<p>What you get for each test:</p>",
"<ul>",
"<li>The date the test was completed</li>",
"<li>The odometer reading and its unit, miles or kilometres</li>",
"<li>Whether the reading was read from the dash, entered by the customer, or not recorded at all</li>",
"<li>Pass or fail, and every defect and advisory in full text</li>",
"<li>The expiry date of the certificate</li>",
"</ul>",
"<p>That last point about how the reading was captured matters. A reading marked as customer entered rather than read carries less weight.</p>",
"<h2 id='reading'>3. Reading the mileage line properly</h2>",
"<p><strong>Look for any drop.</strong> Sort the tests oldest to newest and read down the mileage column. It should only ever go up. Our checker flags a drop automatically.</p>",
"<p><strong>Look for a flat spell followed by a jump.</strong> Three years at 3,000 miles a year then a single year at 22,000 usually means the car changed hands and changed job, from a second car to a commute. Not fraud, but it changes what you are buying.</p>",
"<p><strong>Look at the shape, not just the total.</strong> A car with 90,000 miles accumulated evenly over 12 years has had a gentler life than one that did 90,000 in four years and then sat.</p>",
"<p><strong>Check the units.</strong> An import may have kilometre readings in the early history. 100,000 km is 62,137 miles. If someone has recorded kilometres as miles at some point, the trail goes strange.</p>",
"<h2 id='innocent'>4. Innocent explanations that look bad</h2>",
"<p>Not every anomaly is a crime. Before you walk away, ask the seller and see whether the answer is ready and specific.</p>",
"<table><thead><tr><th>What you see</th><th>Innocent explanation</th><th>What to ask for</th></tr></thead><tbody>",
"<tr><td>Reading drops by a large round number</td><td>Replacement instrument cluster fitted</td><td>The invoice for the cluster, with date and mileage</td></tr>",
"<tr><td>Reading drops by a digit or two</td><td>Tester keyed it wrong</td><td>Nothing, but check the next test corrects it</td></tr>",
"<tr><td>Two year gap in tests</td><td>SORN, off road restoration, or stored abroad</td><td>The SORN confirmation or storage evidence</td></tr>",
"<tr><td>Very low annual mileage</td><td>Second car, retired owner, short journeys</td><td>Look for short journey wear: exhaust, battery, brake corrosion</td></tr>",
"</tbody></table>",
"<h2 id='physical'>5. The physical checks that back it up</h2>",
"<p>The clock can lie. The car finds it harder.</p>",
"<ul>",
"<li><strong>Steering wheel.</strong> A shiny, smooth rim on a 30,000 mile car is wrong.</li>",
"<li><strong>Pedal rubbers.</strong> Worn through, or suspiciously new on an older car.</li>",
"<li><strong>Driver's seat bolster.</strong> The outer edge of the driver's seat wears first.</li>",
"<li><strong>Gear knob and door handle.</strong> Same logic.</li>",
"<li><strong>Service book and stamps.</strong> Cross reference the mileage at each stamp against the MOT trail. Fraudsters often forget the service book.</li>",
"<li><strong>Screws around the instrument cluster.</strong> Chewed heads suggest the dash has been apart.</li>",
"<li><strong>Timing belt sticker</strong> under the bonnet often records a mileage.</li>",
"</ul>",
"<h2 id='worked'>6. A worked example</h2>",
"<p>Say a 2013 estate is advertised at 68,000 miles for &pound;5,400. You run the registration and the MOT history shows:</p>",
"<ul>",
"<li>2019: 71,204 miles</li>",
"<li>2020: 76,110 miles</li>",
"<li>2021: no test recorded</li>",
"<li>2022: 62,300 miles</li>",
"<li>2023 to 2026: rising steadily to 68,000</li>",
"</ul>",
"<p>The reading in 2022 is nearly 14,000 miles below 2020, with a missing year in between. On a comparable honest example at around 82,000 real miles, the trade guide value is closer to &pound;4,100. The 68,000 mile figure is doing roughly &pound;1,300 of work in that advert.</p>",
"<p>Ask for the cluster invoice. If it does not exist, that is your answer. If you have already bought it, you have a claim against the seller under the Consumer Rights Act if they were a trader, and a harder civil claim if they were private.</p>",
"<h2 id='faq'>Frequently asked</h2>",
"<p><strong>Is clocking illegal?</strong> Adjusting an odometer is not an offence by itself. Selling the vehicle without disclosing the adjustment is, under the Consumer Protection from Unfair Trading Regulations.</p>",
"<p><strong>Does the MOT history cover Northern Ireland?</strong> No. DVSA holds records for England, Scotland and Wales. Northern Ireland MOTs are run by the DVA and are not in this dataset.</p>",
"<p><strong>Can a car have no odometer reading recorded?</strong> Yes. Older records and some tests show no reading, and our checker labels those honestly rather than guessing.</p>",
"<p><strong>Is a paid HPI style check still worth it?</strong> For outstanding finance, theft markers and insurance write off categories, yes, because none of that is in the MOT data. For mileage and condition history, the free MOT record is usually enough.</p>"
 ].join('')
}
];

BUILTIN.push({
 slug: 'mot-rules-fines-uk',
 title: 'MOT Rules in Plain English: When It Is Due, What It Costs, What You Get Fined',
 desc: 'The three year rule, the one month early rule, the £1,000 fine, and the handful of exemptions that actually apply. Sourced from GOV.UK.',
 date: '2026-08-21',
 mins: 6,
 body: [
"<p class='stand'>Most of what people believe about MOT rules is roughly right and wrong in the expensive places. Here is what GOV.UK actually says, with the numbers.</p>",
"<div class='card short'><strong>The short version</strong><ul>",
"<li>In Great Britain, cars, vans and motorcycles get their <strong>first MOT at three years old</strong>, counted from first registration. The government consulted on moving this to four years and <strong>decided in 2024 to keep it at three</strong>.</li>",
"<li>After that it is <strong>every 12 months</strong>.</li>",
"<li>You can test it <strong>up to one month minus a day early</strong> and keep your existing renewal date. Do this. It is free money.</li>",
"<li>Driving without a valid MOT can cost you <strong>up to &pound;1,000</strong>.</li>",
"<li>The maximum fee is set in law: <strong>&pound;54.85 for a car</strong>, <strong>&pound;29.65 for a motorcycle</strong>. That is a cap, not a price.</li>",
"<li>No valid MOT usually means <strong>no valid insurance cover</strong> in practice, which is the much bigger risk.</li>",
"</ul></div>",
"<div class='card toc'><strong>On this page</strong>",
"<a href='#due'>1. When your MOT is due</a>",
"<a href='#early'>2. The one month early rule</a>",
"<a href='#fines'>3. What it costs if you get it wrong</a>",
"<a href='#insurance'>4. The insurance problem nobody mentions</a>",
"<a href='#exempt'>5. Vehicles that do not need one</a>",
"<a href='#cost'>6. What you should pay</a>",
"<a href='#faq'>Frequently asked</a></div>",
"<h2 id='due'>1. When your MOT is due</h2>",
"<p>A new car, van or motorcycle registered in Great Britain needs its first MOT on the third anniversary of registration. Then annually.</p>",
"<p>There was a serious push to move that first test to four years, on the argument that modern cars are more reliable. The Department for Transport consulted, looked at the road safety evidence, and in 2024 confirmed the first MOT stays at three years. So if you have read otherwise on an older page, that is why.</p>",
"<p>Some vehicles are tested earlier or more often. Taxis, private hire vehicles and ambulances are typically tested from one year old and annually after that.</p>",
"<h2 id='early'>2. The one month early rule</h2>",
"<p>This is the single most useful rule and the most commonly wasted.</p>",
"<p>You can have the test done <strong>up to one month minus one day</strong> before the current certificate expires, and the new certificate still runs to the same date next year. So if yours expires on 30 September, you can test it from 1 September and still get an expiry of 30 September next year.</p>",
"<p>Why it matters: it gives you a month of buffer. If it fails, you can drive the car legally while the parts are ordered, and you can shop the repair around instead of accepting the first quote because the certificate runs out on Tuesday.</p>",
"<p>Test it any earlier than that and you lose the days. Test it after expiry and you cannot legally drive it there except to a pre booked appointment.</p>",
"<h2 id='fines'>3. What it costs if you get it wrong</h2>",
"<table><thead><tr><th>Situation</th><th>Penalty</th></tr></thead><tbody>",
"<tr><td>Driving without a valid MOT</td><td>Up to &pound;1,000</td></tr>",
"<tr><td>Driving with a dangerous defect recorded</td><td>Up to &pound;2,500, 3 penalty points, possible disqualification</td></tr>",
"<tr><td>Vehicle on the road untaxed because MOT lapsed</td><td>Separate DVLA penalty, plus clamping</td></tr>",
"</tbody></table>",
"<p>Enforcement is largely automatic. ANPR cameras cross reference the MOT database in real time, so the old assumption that nobody checks is out of date.</p>",
"<h2 id='insurance'>4. The insurance problem nobody mentions</h2>",
"<p>Most comprehensive policies require the vehicle to be roadworthy and, in the wording of many insurers, to hold a valid MOT where one is required. If you have a collision without one, the insurer may still have to meet a third party claim, because that is a statutory duty, but it may then pursue you for the money, and it may decline the damage to your own vehicle.</p>",
"<p>So the &pound;1,000 fine is not the real number. The real number is the value of the other person's car.</p>",
"<h2 id='exempt'>5. Vehicles that do not need one</h2>",
"<ul>",
"<li>Vehicles built or first registered <strong>more than 40 years ago</strong> that have not been substantially changed in the last 30 years. This rolls forward each year, so it is a moving date, not a fixed one.</li>",
"<li>Goods vehicles powered by electricity and registered before 1 March 2015.</li>",
"<li>Tractors and some agricultural machines.</li>",
"<li>Vehicles under three years old, as above.</li>",
"</ul>",
"<p>Exempt is not the same as excused. A 40 year old car still has to be roadworthy, and you can still be prosecuted if it is not. Many owners of exempt classics choose to have a voluntary test anyway, partly for that reason and partly because it helps at resale.</p>",
"<h2 id='cost'>6. What you should pay</h2>",
"<p>The statutory maximum is &pound;54.85 for a car up to eight passenger seats and &pound;29.65 for a motorcycle. Those are ceilings.</p>",
"<p>In practice many independent garages charge &pound;35 to &pound;45, and fast fit chains often discount the test heavily, sometimes to &pound;25 or even free, because the test is a route to selling you the repair. That is not sinister, it is just the business model. It does mean it is worth taking a failure sheet elsewhere for a second quote.</p>",
"<p>You can also sign up for free MOT reminders from DVSA by text or email, or use the calendar reminder button on our <a href='/'>MOT history checker</a> after you look up a registration.</p>",
"<h2 id='faq'>Frequently asked</h2>",
"<p><strong>Can I drive to the test centre if my MOT has expired?</strong> Yes, to a pre booked test, or to or from a garage for repair work. Not to the shops on the way.</p>",
"<p><strong>Does the MOT prove the car is safe?</strong> No. It is a snapshot of minimum roadworthiness on the day of the test. It is not a mechanical warranty and it says nothing about the engine or gearbox.</p>",
"<p><strong>What if I lose the certificate?</strong> It does not matter. The record is digital. Any garage or the GOV.UK service can look it up from the registration.</p>",
"<p><strong>Is the first MOT moving to four years?</strong> No. The government confirmed in 2024 that it stays at three years.</p>"
 ].join('')
});

BUILTIN.push({
 slug: 'mot-defect-categories-uk',
 title: 'Dangerous, Major, Minor and Advisory: What Your MOT Result Actually Means',
 desc: 'The four MOT result categories, which ones fail you, which one means you must not drive the car at all, and how to read a defect list.',
 date: '2026-08-21',
 mins: 5,
 body: [
"<p class='stand'>Since 20 May 2018 the MOT has used four categories rather than a simple pass or fail. Two of them fail you. One of them means you should not drive the car off the forecourt. Most people cannot tell them apart.</p>",
"<div class='card short'><strong>The short version</strong><ul>",
"<li><span class='tag t-bad'>DANGEROUS</span> Direct and immediate risk to road safety or the environment. <strong>Fail. Do not drive it.</strong></li>",
"<li><span class='tag t-warn'>MAJOR</span> May affect safety or the environment. <strong>Fail.</strong> You can normally drive it to a garage for repair.</li>",
"<li><span class='tag'>MINOR</span> No significant effect on safety. <strong>Pass</strong>, but fix it soon.</li>",
"<li><span class='tag'>ADVISORY</span> Something to monitor. <strong>Pass.</strong> No action required now.</li>",
"<li>The categories were introduced on <strong>20 May 2018</strong>, so any test before that date in a vehicle's history uses the older wording.</li>",
"</ul></div>",
"<div class='card toc'><strong>On this page</strong>",
"<a href='#four'>1. The four categories</a>",
"<a href='#dangerous'>2. What dangerous really means</a>",
"<a href='#history'>3. Reading them in a vehicle's history</a>",
"<a href='#buying'>4. What this tells you when buying</a>",
"<a href='#faq'>Frequently asked</a></div>",
"<h2 id='four'>1. The four categories</h2>",
"<table><thead><tr><th>Category</th><th>Result</th><th>What it means</th></tr></thead><tbody>",
"<tr><td>Dangerous</td><td>Fail</td><td>Direct and immediate risk to road safety, or a serious environmental impact. Must not be driven until repaired.</td></tr>",
"<tr><td>Major</td><td>Fail</td><td>May affect safety, put others at risk, or harm the environment. Repair immediately.</td></tr>",
"<tr><td>Minor</td><td>Pass</td><td>No significant effect on safety or the environment. Repair as soon as possible.</td></tr>",
"<tr><td>Advisory</td><td>Pass</td><td>Could become more serious in future. Monitor and repair if necessary.</td></tr>",
"</tbody></table>",
"<p>There is also a fifth outcome you will see in the data: a <strong>pass with no defects at all</strong>. That is genuinely uncommon on an older vehicle and worth noticing.</p>",
"<h2 id='dangerous'>2. What dangerous really means</h2>",
"<p>A dangerous defect is not a strong opinion from the tester. It is a defined category, and it carries a legal consequence: driving a vehicle with a dangerous defect can cost up to &pound;2,500, three penalty points and, in serious cases, disqualification.</p>",
"<p>Typical examples: a brake pipe corroded to the point of failure, a tyre with the cords showing, a suspension component about to separate, a steering fault, a fuel leak.</p>",
"<p>If your car is recorded as having a dangerous defect, the garage will normally tell you plainly that it should not leave on its own wheels. Recovery is the correct answer, not a careful drive home.</p>",
"<h2 id='history'>3. Reading them in a vehicle's history</h2>",
"<p>When you look up a registration on our <a href='/'>MOT history checker</a>, every test shows its full defect list with the category tag against each line. That is more useful than the pass or fail on its own.</p>",
"<p>What to look for:</p>",
"<ul>",
"<li><strong>Any dangerous defect ever recorded.</strong> One is worth asking about. Several across different years suggests the car has been run to the point of failure repeatedly.</li>",
"<li><strong>An advisory that becomes a major the following year.</strong> That is the normal, healthy pattern of a car being maintained reactively rather than proactively. It is not alarming, but it tells you the owner waited.</li>",
"<li><strong>The same advisory repeated for four years running.</strong> That is a fault nobody has ever fixed. Corrosion advisories in particular tend to get worse, not better.</li>",
"<li><strong>A long defect list on a pass.</strong> Lots of minors and advisories still means a long list of jobs waiting for you.</li>",
"</ul>",
"<h2 id='buying'>4. What this tells you when buying</h2>",
"<p>The defect history is a maintenance diary written by someone with no incentive to flatter the car. Use it that way.</p>",
"<p>A car with three advisories a year, each one addressed by the next test, has been looked after. A car with a clean sheet for six years and then a page of majors has probably sat unused, which brings its own problems: perished rubber, seized calipers, a tired battery.</p>",
"<p>And remember what the MOT does not test. It says nothing about the clutch, the gearbox, the engine internals, the air conditioning, or the electronics. A car can pass its MOT on the morning its head gasket fails.</p>",
"<h2 id='faq'>Frequently asked</h2>",
"<p><strong>Can I drive away after a major defect fail?</strong> If the previous certificate is still valid and the vehicle is otherwise roadworthy, generally yes, to get it repaired. If the certificate has expired, you may only drive to a pre booked test or to a garage for repair.</p>",
"<p><strong>Do minors show on the certificate?</strong> Yes, minors and advisories are both printed on the pass certificate.</p>",
"<p><strong>Can I challenge a result?</strong> Yes. You can appeal a failure to DVSA within 14 working days of the test, or a pass within 3 months. There is a fee, which is refunded if the appeal succeeds.</p>",
"<p><strong>Why does an old test in the history not show categories?</strong> Because the categories only started on 20 May 2018. Earlier tests recorded failure items and advisories under the previous system.</p>"
 ].join('')
});

BUILTIN.push({
 slug: 'mot-statistics-uk',
 title: 'UK MOT Statistics 2026: Pass Rates, Failure Reasons and Test Volumes',
 desc: 'Official DVSA MOT testing figures for Great Britain, laid out plainly. Test volumes, initial failure rates by class and by vehicle age, and the defect categories behind the failures.',
 date: '2026-08-21',
 mins: 8,
 body: [
"<p class='stand'>DVSA publishes its MOT testing data every year, and almost nobody reads it because it arrives as a pile of CSV files. This page pulls out the figures people actually look for, says where each one comes from, and says plainly where the numbers disagree with each other.</p>",
"<div class='card'><strong>Using these figures</strong><p class='meta' style='margin:6px 0 0'>All DVSA data on this page is published under the Open Government Licence v3.0. You are welcome to quote or chart anything here. If it is useful, a link back to this page is appreciated but not required. Figures compiled August 2026 from the 2025 test year release, published 22 June 2026.</p></div>",
"<div class='card short'><strong>The headline numbers</strong><ul>",
"<li><strong>29.5 million</strong> class 3 and 4 MOT tests were carried out in the 2025 test year. Across all classes DVSA processed <strong>38.1 million test records</strong>.</li>",
"<li>The initial failure rate for class 4 vehicles, ordinary cars, was <strong>27.24%</strong> in April to June 2025. Roughly <strong>78.3%</strong> of tests overall end in a pass.</li>",
"<li>Failure rate climbs hard with age: about <strong>20% at three years old</strong>, rising past <strong>50% by twelve years old</strong>.</li>",
"<li><strong>Lamps, reflectors and electrical equipment</strong> is the biggest single defect category at <strong>24.60%</strong> of failures, then <strong>suspension at 20.65%</strong> and <strong>brakes at 12.99%</strong>.</li>",
"<li>Commercial vehicles do far better than cars. HGV initial failure was <strong>10.40%</strong>, buses and coaches <strong>8.65%</strong>, trailers <strong>7.56%</strong>.</li>",
"<li>The MOT fee is capped in law at <strong>&pound;54.85</strong> for a car and <strong>&pound;29.65</strong> for a motorcycle.</li>",
"</ul></div>",
"<div class='card toc'><strong>On this page</strong>",
"<a href='#volume'>1. How many MOTs happen</a>",
"<a href='#pass'>2. Pass and failure rates</a>",
"<a href='#age'>3. Failure rate by vehicle age</a>",
"<a href='#defect'>4. What the failures are</a>",
"<a href='#class'>5. Cars against commercial vehicles</a>",
"<a href='#cost'>6. What it costs</a>",
"<a href='#care'>7. Where these numbers get misused</a>",
"<a href='#sources'>8. Sources</a></div>",
"<h2 id='volume'>1. How many MOTs happen</h2>",
"<p>The MOT is one of the largest recurring inspection programmes in the country. In the 2025 test year there were <strong>29.5 million class 3 and 4 tests</strong>, the classes that cover ordinary cars and light vehicles. Counting every class, DVSA processed <strong>38.1 million test records</strong>.</p>",
"<p>To put that in perspective, that is roughly one test for every adult in Great Britain, every year, and it generates a public dataset going back to 2005 that includes an odometer reading for almost every test. That mileage trail is the single most useful free resource available to a used vehicle buyer, and it is why <a href='/'>checking a registration</a> before you buy is worth the sixty seconds it takes.</p>",
"<h2 id='pass'>2. Pass and failure rates</h2>",
"<p>There are two different numbers in circulation and they measure different things, which is where most of the confusion comes from.</p>",
"<table><thead><tr><th>Measure</th><th>Figure</th><th>What it means</th></tr></thead><tbody>",
"<tr><td>Overall pass rate</td><td>About 78.3%</td><td>Share of all tests ending in a pass</td></tr>",
"<tr><td>Class 4 initial failure rate</td><td>27.24%, Apr to Jun 2025</td><td>Share failing at the first attempt, before any repair and retest</td></tr>",
"</tbody></table>",
"<p>Those two do not add to 100 and they are not supposed to. The initial failure rate counts first attempts only. The overall pass rate includes retests, which mostly pass because the fault has just been fixed. If a headline says a quarter of cars fail their MOT, it is quoting the initial figure. If another says four in five pass, it is quoting the overall figure. Both can be right at once.</p>",
"<h2 id='age'>3. Failure rate by vehicle age</h2>",
"<p>This is the most useful pattern in the whole dataset and the one most often left out.</p>",
"<table><thead><tr><th>Vehicle age</th><th>Approximate initial failure rate</th></tr></thead><tbody>",
"<tr><td>3 years, first test</td><td>About 20%</td></tr>",
"<tr><td>6 to 8 years</td><td>Rising through the 30s</td></tr>",
"<tr><td>12 years and over</td><td>Over 50%</td></tr>",
"</tbody></table>",
"<p>Read that as a budgeting tool rather than a warning. A twelve year old car is not unsafe, but on the balance of probability it will need work at test time, and that cost should sit in your calculation when you compare it against a newer example. A car three years old still fails one time in five, which is a useful corrective to the idea that a nearly new vehicle is a certainty.</p>",
"<p>Worth knowing: the government consulted on moving the first MOT from three years to four and, in 2024, <strong>confirmed it would stay at three</strong>, on road safety grounds. The one in five first test failure rate is a large part of why.</p>",
"<h2 id='defect'>4. What the failures are</h2>",
"<p>DVSA groups defects into sections. The ranking barely moves from year to year.</p>",
"<table><thead><tr><th>Defect category</th><th>Share of failures</th><th>Typical cost to fix</th></tr></thead><tbody>",
"<tr><td>Lamps, reflectors and electrical equipment</td><td>24.60%</td><td>&pound;5 to &pound;25</td></tr>",
"<tr><td>Suspension</td><td>20.65%</td><td>&pound;120 to &pound;300 per corner</td></tr>",
"<tr><td>Brakes</td><td>12.99%</td><td>&pound;90 to &pound;350</td></tr>",
"<tr><td>Tyres</td><td>High, varies by year</td><td>&pound;45 to &pound;80 per tyre</td></tr>",
"<tr><td>Driver visibility, wipers and washers</td><td>Moderate</td><td>&pound;0 to &pound;45</td></tr>",
"</tbody></table>",
"<p class='meta'>Repair costs are indicative independent garage prices for a common family car in August 2026 and are our own estimate, not DVSA data.</p>",
"<p>The uncomfortable finding is at the top of that table. The single largest category of MOT failure in Great Britain is lighting, and a bulb costs a few pounds and takes minutes. Close to a quarter of all failures are, in principle, avoidable in a driveway with somebody standing outside the car calling out which lights work.</p>",
"<p>Suspension in second place is a different story. That one is genuinely expensive, genuinely age related, and not something you can check yourself with any confidence.</p>",
"<h2 id='class'>5. Cars against commercial vehicles</h2>",
"<p>Commercial vehicles fail far less often than private cars, and the gap is large enough to be worth explaining.</p>",
"<table><thead><tr><th>Vehicle type</th><th>Initial failure rate, Q1 2025 to 2026</th></tr></thead><tbody>",
"<tr><td>Cars, class 4</td><td>27.24%</td></tr>",
"<tr><td>HGVs</td><td>10.40%</td></tr>",
"<tr><td>Buses and coaches</td><td>8.65%</td></tr>",
"<tr><td>Trailers</td><td>7.56%</td></tr>",
"</tbody></table>",
"<p>The reason is not that lorries are better built. It is that commercial operators run scheduled preventative maintenance because an operator licence depends on it, and a roadside prohibition costs them money immediately. Private motorists overwhelmingly run reactive maintenance, which means the MOT is the inspection, rather than a confirmation of one.</p>",
"<p>That is the practical lesson buried in the data. The difference between a 27% failure rate and a 10% one is mostly a service schedule.</p>",
"<h2 id='cost'>6. What it costs</h2>",
"<p>The maximum MOT fee is set in law, not by the garage.</p>",
"<table><thead><tr><th>Vehicle</th><th>Statutory maximum fee</th></tr></thead><tbody>",
"<tr><td>Car, up to 8 passenger seats</td><td>&pound;54.85</td></tr>",
"<tr><td>Motorcycle</td><td>&pound;29.65</td></tr>",
"</tbody></table>",
"<p>Those are ceilings. Many independents charge &pound;35 to &pound;45, and fast fit chains often discount the test heavily because it is a route to selling the repair. Neither is sinister, but it does mean a failure sheet is worth a second quote elsewhere.</p>",
"<p>Driving without a valid MOT can cost <strong>up to &pound;1,000</strong>. Driving with a recorded dangerous defect can cost <strong>up to &pound;2,500</strong>, three penalty points and possible disqualification.</p>",
"<h2 id='care'>7. Where these numbers get misused</h2>",
"<p>Three things to watch for, including in our own writing.</p>",
"<p><strong>Initial and overall rates get swapped.</strong> A quarter fail and four in five pass are both true and describe different measures. Any article using both interchangeably has not read the source.</p>",
"<p><strong>Defect shares are measured differently by different publishers.</strong> Some count failures, some count individual defect items, some count the worst defect per test. That is why you will see lamps quoted anywhere between 11% and 25% depending on the source. We have used DVSA's own category share here and said so.</p>",
"<p><strong>Age curves are averages across every make and model.</strong> They tell you what a twelve year old car does on average. They tell you nothing about the specific car in front of you, which is exactly what the <a href='/'>MOT history for that registration</a> does tell you.</p>",
"<h2 id='sources'>8. Sources</h2>",
"<ul>",
"<li>DVSA MOT testing data for Great Britain, 2025 test year, published 22 June 2026. Open Government Licence v3.0.</li>",
"<li>DVSA commercial vehicle testing data for Great Britain, quarterly release.</li>",
"<li>GOV.UK, Getting an MOT, for fees, the three year rule and penalties.</li>",
"<li>Department for Transport, date of the first MOT test consultation response, 2024.</li>",
"</ul>",
"<p>Something wrong or out of date on this page? It is maintained by a person, not a content farm. Tell us and it gets fixed.</p>"
 ].join('')
});

function head(title, desc, canon, extra){
 return [
 "<!doctype html><html lang='en-GB'><head><meta charset='utf-8'>",
 "<meta name='viewport' content='width=device-width,initial-scale=1'>",
 "<title>" + esc(title) + "</title>",
 "<meta name='description' content='" + esc(desc) + "'>",
 "<link rel='canonical' href='" + canon + "'>",
 "<meta name='robots' content='index,follow,max-image-preview:large,max-snippet:-1'>",
 "<meta property='og:type' content='article'>",
 "<meta property='og:site_name' content='MOT Check UK'>",
 "<meta property='og:title' content='" + esc(title) + "'>",
 "<meta property='og:description' content='" + esc(desc) + "'>",
 "<meta property='og:url' content='" + canon + "'>",
 "<meta name='twitter:card' content='summary'>",
 "<meta name='twitter:title' content='" + esc(title) + "'>",
 "<meta name='twitter:description' content='" + esc(desc) + "'>",
 "<style>" + CSS + "</style>",
 (extra || ""),
 "</head><body>",
 "<header class='site'><div class='wrap'><a class='brand' href='/'>MOT Check UK</a><a class='cta' href='/'>Free MOT check</a></div></header>",
 "<div class='wrap'>"
 ].join('');
}
function foot(){
 return [
 "<footer><p>", DISCLAIM, "</p>",
 "<p>Sources: GOV.UK Getting an MOT, DVSA MOT testing data, DVSA MOT History API. Figures checked August 2026.</p>",
 "<p><a href='/guides'>All guides</a> &middot; <a href='/'>MOT history checker</a></p></footer>",
 "<p>Something wrong or out of date? Email <a href='mailto:support@adminruhulamin.co.uk'>support@adminruhulamin.co.uk</a> and a person will read it.</p>",
'<script>' + [
'(function(){',
'var K="bmc_consent_v1",G="G-VX0H5Z7VVV";',
'function load(){if(window.__gaOn)return;window.__gaOn=1;',
'var s=document.createElement("script");s.async=1;',
's.src="https://www.googletagmanager.com/gtag/js?id="+G;document.head.appendChild(s);',
'window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments)};',
'window.gtag("js",new Date());window.gtag("config",G,{anonymize_ip:true});}',
'function set(v){try{localStorage.setItem(K,v)}catch(e){}',
'var b=document.querySelector(".consent");if(b&&b.parentNode)b.parentNode.removeChild(b);',
'if(v==="yes")load();}',
'var c=null;try{c=localStorage.getItem(K)}catch(e){}',
'if(c==="yes"){load();}else if(c!=="no"){',
'var d=document.createElement("div");d.className="consent";',
'd.innerHTML="<p>We use Google Analytics to see which guides people actually read. No advertising cookies.</p><div><button type=\\"button\\" class=\\"no\\">No thanks</button><button type=\\"button\\" class=\\"yes\\">Allow</button></div>";',
'document.body.appendChild(d);',
'd.querySelector(".yes").addEventListener("click",function(){set("yes")});',
'd.querySelector(".no").addEventListener("click",function(){set("no")});',
'}})();'
].join('') + '<' + '/script>',
"</div></body></html>"
 ].join('');
}
function related(slug){
 var others = allGuides().filter(function(g){ return g.slug !== slug; });
 var h = "<div class='card'><strong>More guides</strong>";
 others.forEach(function(g){ h += "<a class='gcard' href='/guides/" + g.slug + "'><h3>" + esc(g.title) + "</h3><p>" + esc(g.desc) + "</p></a>"; });
 return h + "</div>";
}
function articleJsonLd(g){
 var o = {
  "@context":"https://schema.org","@type":"Article",
  "headline": g.title, "description": g.desc,
  "datePublished": g.date, "dateModified": g.date,
  "author": {"@type":"Person","name":"Ruhul Amin"},
  "publisher": {"@type":"Organization","name":"MOT Check UK","url":SITE},
  "mainEntityOfPage": SITE + "/guides/" + g.slug,
  "inLanguage":"en-GB"
 };
 var b = {
  "@context":"https://schema.org","@type":"BreadcrumbList",
  "itemListElement":[
   {"@type":"ListItem","position":1,"name":"Home","item":SITE + "/"},
   {"@type":"ListItem","position":2,"name":"Guides","item":SITE + "/guides"},
   {"@type":"ListItem","position":3,"name":g.title,"item":SITE + "/guides/" + g.slug}
  ]
 };
 return "<script type='application/ld+json'>" + JSON.stringify(o) + "<" + "/script><script type='application/ld+json'>" + JSON.stringify(b) + "<" + "/script>";
}
function guidePage(g){
 return [
  head(g.title + " | MOT Check UK", g.desc, SITE + "/guides/" + g.slug, articleJsonLd(g)),
  "<p class='meta'><a href='/'>Home</a> &rsaquo; <a href='/guides'>Guides</a></p>",
  "<h1>" + esc(g.title) + "</h1>",
  "<p class='meta'>By Ruhul Amin &middot; Published 21 August 2026 &middot; " + g.mins + " min read &middot; Figures checked August 2026</p>",
  g.body,
  "<div class='card'><strong>Check a vehicle now</strong><p class='meta'>Free, no sign up. Full MOT history, mileage chart and an automatic buyer report from DVSA data.</p><p><a class='cta' href='/'>Run a free MOT check</a></p></div>",
  related(g.slug),
  "<div class='card'><p class='meta'>" + AUTHOR + "</p></div>",
  foot()
 ].join('');
}
function indexPage(){
 var h = head("MOT Guides for UK Drivers and Buyers | MOT Check UK",
  "Plain English guides to the UK MOT: what fails, what the defect categories mean, the rules and fines, and how to spot a clocked car.",
  SITE + "/guides", "");
 h += "<p class='meta'><a href='/'>Home</a> &rsaquo; Guides</p>";
 h += "<h1>MOT guides</h1>";
 h += "<p class='stand'>Short, sourced guides to the things people actually get wrong about the MOT. Every figure comes from GOV.UK or DVSA, and every one says plainly when the answer is that it does not matter.</p>";
 allGuides().forEach(function(g){
  h += "<a class='gcard' href='/guides/" + g.slug + "'><h3>" + esc(g.title) + "</h3><p>" + esc(g.desc) + "</p></a>";
 });
 h += "<div class='card'><strong>Looking up a specific vehicle?</strong><p class='meta'>The free checker reads the DVSA MOT history for any registration in England, Scotland or Wales, draws the mileage trail, and flags anything that looks off.</p><p><a class='cta' href='/'>Run a free MOT check</a></p></div>";
 return h + foot();
}
function sitemap(){
 var urls = ["<url><loc>" + SITE + "/guides</loc><priority>0.8</priority><changefreq>monthly</changefreq></url>"];
 allGuides().forEach(function(g){
  urls.push("<url><loc>" + SITE + "/guides/" + g.slug + "</loc><lastmod>" + g.date + "</lastmod><priority>0.9</priority><changefreq>monthly</changefreq></url>");
 });
 return "<?xml version='1.0' encoding='UTF-8'?><urlset xmlns='http://www.sitemaps.org/schemas/sitemap/0.9'>" + urls.join('') + "</urlset>";
}
function send(res, code, type, body){
 res.writeHead(code, {'Content-Type': type, 'Cache-Control': 'public, max-age=600'});
 res.end(body);
}
http.createServer(function(req, res){
 var raw = req.url || '/';
 var q = raw.indexOf('?');
 var p = q === -1 ? raw : raw.slice(0, q);
 if(p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
 if(p === '/guides/sitemap.xml'){ return send(res, 200, 'application/xml; charset=utf-8', sitemap()); }
 if(p === '/guides/healthz'){ return send(res, 200, 'application/json', JSON.stringify({ok:true, guides:allGuides().length})); }
 if(p === '/guides' || p === '/guides/'){ return send(res, 200, 'text/html; charset=utf-8', indexPage()); }
 if(p.indexOf('/guides/') === 0){
  var slug = p.slice(8);
  for(var i = 0; i < allGuides().length; i++){
   if(allGuides()[i].slug === slug){ return send(res, 200, 'text/html; charset=utf-8', guidePage(allGuides()[i])); }
  }
  res.writeHead(302, {'Location': '/guides'});
  return res.end();
 }
 res.writeHead(302, {'Location': '/guides'});
 res.end();
}).listen(PORT, function(){ console.log('guides on ' + PORT); });
