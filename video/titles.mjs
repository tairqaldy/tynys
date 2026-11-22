// Animated title pages for the start and the end, in the site's dark palette and fonts.
const FONTS = 'https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600&family=Literata:opsz,wght@7..72,400;7..72,500&display=block';
const C = ['#86c0d6', '#d6b654', '#dd7c3f', '#cf5e88'];
const MARK = (size) => `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 28 28" aria-hidden="true">
  <circle class="ring" cx="14" cy="14" r="12" fill="none" stroke-width="1.2"/>
  <path class="b1" d="M5.5 12.2c2.6-2.4 5.2-2.4 7.8 0s5.2 2.4 7.8 0" fill="none" stroke-width="1.5" stroke-linecap="round"/>
  <path class="b2" d="M8 17.2c2-1.8 4-1.8 6 0s4 1.8 6 0" fill="none" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const BASE = `*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:#0e1316;color:#e9eef0;font-family:'Golos Text',system-ui,sans-serif;display:grid;place-items:center;opacity:0}
body.go{opacity:1}
.in{opacity:0;transform:translateY(10px)}
body.go .in{animation:rise 700ms cubic-bezier(.16,1,.3,1) forwards;animation-delay:var(--t)}
@keyframes rise{to{opacity:1;transform:none}}
.mark .ring{stroke:#a9b5ba;stroke-dasharray:76;stroke-dashoffset:76}
.mark .b1{stroke:${C[0]};stroke-dasharray:24;stroke-dashoffset:24}
.mark .b2{stroke:${C[0]};opacity:.7;stroke-dasharray:20;stroke-dashoffset:20}
body.go .mark .ring{animation:draw 1100ms cubic-bezier(.16,1,.3,1) 150ms forwards}
body.go .mark .b1{animation:draw 900ms cubic-bezier(.16,1,.3,1) 700ms forwards,drift 4.8s ease-in-out 1.6s infinite}
body.go .mark .b2{animation:draw 900ms cubic-bezier(.16,1,.3,1) 950ms forwards,drift 4.8s ease-in-out 2.4s infinite}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes drift{0%,100%{transform:translateX(0)}50%{transform:translateX(.9px)}}
.serif{font-family:'Literata',Georgia,serif;font-weight:400;letter-spacing:-.02em}
.k{font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:#8c989e}
.n{font-variant-numeric:tabular-nums}`;
const page = (css, body, script = '') => `data:text/html;base64,${Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="${FONTS}"><style>${BASE}${css}</style></head><body>${body}
<script>document.fonts.ready.then(()=>setTimeout(()=>{document.body.classList.add('go');${script}},120))</script></body></html>`).toString('base64')}`;

export function intro() {
  const cells = ['Low', 'Moderate', 'Elevated', 'High']
    .map((k, i) => `<span class="in" style="--t:${1700 + i * 260}ms"><i style="background:${C[i]}"></i>${k}</span>`).join('');
  const q = [['How clean is the air?', 'Hidden Markov model'], ['When should I go out?', 'Markov decision process'], ['Which way should I walk?', 'A* search']]
    .map(([a, b], i) => `<li class="in" style="--t:${6100 + i * 1500}ms"><span class="serif">${a}</span><span class="k">${b}</span></li>`).join('');
  return page(`main{width:1040px;text-align:center}
.mark{display:block;margin:0 auto 26px}
h1{font-size:128px;line-height:1;margin:0}
.sub{margin:30px 0 0;font-size:24px;color:#a9b5ba}
.strip{display:flex;justify-content:center;gap:26px;margin:34px auto 0;font-size:16px;color:#a9b5ba}
.strip span{display:flex;align-items:center;gap:8px}.strip i{width:22px;height:10px;border-radius:2px;display:block}
.course{margin:34px 0 0;font-size:17px}
ol{list-style:none;padding:0;margin:40px auto 0;width:760px;display:grid;gap:14px}
li{display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid #26302f;padding-top:14px}
li .serif{font-size:30px}
.team{position:fixed;left:0;right:0;bottom:54px;text-align:center;font-size:19px;color:#a9b5ba}`,
  `<main>${MARK(92)}<h1 class="serif in" style="--t:500ms">Tynys</h1><p class="sub in" style="--t:1100ms">тыныс · breath</p>
<div class="strip">${cells}</div>
<p class="course k in" style="--t:3300ms">AIF1303 AI Fundamentals · final project · QAIRU 2026</p><ol>${q}</ol></main>
<p class="team in" style="--t:4300ms">Tair Kaldybayev · Dameli Kalikhanova</p>`);
}

export function outro() {
  const facts = [['0', 'ML libraries'], ['50', 'Python tests'], ['3', 'algorithms, one pipeline']]
    .map(([v, k], i) => `<div class="in" style="--t:${500 + i * 700}ms"><b class="serif n" data-to="${v}">0</b><span>${k}</span></div>`).join('');
  return page(`main{width:1000px;text-align:center}
.mark{display:block;margin:0 auto 34px}
.facts{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid #26302f;border-bottom:1px solid #26302f}
.facts div{padding:26px 10px 24px;display:grid;gap:6px}.facts div+div{border-left:1px solid #26302f}
.facts b{font-size:64px;font-weight:400;line-height:1}.facts span{color:#a9b5ba;font-size:18px}
.url{margin:34px 0 0;font-size:30px;color:${C[0]}}
.team{display:flex;justify-content:center;gap:72px;margin:62px 0 0}
.team div{display:grid;gap:4px}.team .serif{font-size:40px}.team span:last-child{color:#8c989e;font-size:17px}
.repo{margin:44px 0 0;color:#8c989e;font-size:17px}`,
  `<main>${MARK(64)}<div class="facts">${facts}</div>
<p class="url in" style="--t:3300ms">tynys-blond.vercel.app</p>
<div class="team"><div class="in" style="--t:6200ms"><span class="serif">Tair Kaldybayev</span><span>@tairqaldy</span></div>
<div class="in" style="--t:7300ms"><span class="serif">Dameli Kalikhanova</span><span>@dameo111</span></div></div>
<p class="repo in" style="--t:8600ms">github.com/tairqaldy/tynys</p></main>`,
  `document.querySelectorAll('[data-to]').forEach((el,i)=>{const to=+el.dataset.to,t0=performance.now()+500+i*700;
   const f=(t)=>{const p=Math.max(0,Math.min(1,(t-t0)/1100));el.textContent=Math.round(to*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(f)};requestAnimationFrame(f)})`);
}
