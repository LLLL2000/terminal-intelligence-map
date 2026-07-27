/* ============================================================
   vendors.js — Vendors tab: leaderboard, profile, head-to-head
   ============================================================ */
const VEN = { selected:null, rival:null, sort:'value', dir:-1 };

function vendorStats(v, rows){
  const s = rows.filter(t => t.vendor === v);
  const withStack = s.filter(t => t.channel_count > 0);
  return {
    key: v, color: vendorColor(v), n: s.length, rows: s,
    value: msum(s),
    volume: sum(s, t => t.volume),
    acv: sum(s, t => t.acv_kusd),
    regions: new Set(s.map(t => t.region)).size,
    accuracy: mean(s, t => t.ocr_accuracy),
    uptime: mean(s, t => t.uptime_pct),
    age: mean(s, t => t.incumbency_yrs),
    risk: mean(s, t => t.displacement_risk),
    turn: mean(s, t => t.truck_turn_min),
    channels: mean(withStack, t => t.channel_count),
    integrated: s.length ? 100 * s.filter(t => t.integration === 'TOS-integrated').length / s.length : 0,
    direct: s.length ? 100 * s.filter(t => t.sales_channel === 'Direct').length / s.length : 0,
    expiring: s.filter(t => t.refresh_due_yrs != null && t.refresh_due_yrs <= 2).length,
  };
}

const VCOLS = [
  ['key','Vendor','',            r => `<span class="sw" style="background:${r.color}"></span>${esc(r.key)}` +
                                       (VENDOR_PROFILES[r.key] ? ` <span class="pill mute">${esc(VENDOR_PROFILES[r.key].archetype.split(' ')[0])}</span>` : '')],
  ['n','Sites','n',              r => fmt.int(r.n)],
  ['share','Share','n',          (r,tot) => fmt.pct(tot ? 100*r.value/tot : 0)],
  ['volume','Throughput','n',    r => fmt.compact(r.volume*1000)],
  ['acv','Licence base','n',     r => fmt.usd(r.acv)],
  ['regions','Regions','n',      r => fmt.int(r.regions)],
  ['channels','Channels/site','n', r => r.channels != null ? fmt.d1(r.channels) : '—'],
  ['accuracy','Accuracy','n',    r => r.accuracy != null ? fmt.pct(r.accuracy) : '—'],
  ['age','Incumbency','n',       r => r.age != null ? fmt.d1(r.age)+' yr' : '—'],
  ['integrated','TOS-integrated','n', r => fmt.pct0(r.integrated)],
  ['expiring','Exp. ≤24mo','n',  r => fmt.int(r.expiring)],
  ['risk','Avg risk','n',        r => r.risk != null ? riskBar(Math.round(r.risk)) : '—'],
];

function renderVendors(){
  const f = filtered();
  const present = VENDOR_NAMED.filter(v => f.some(t => t.vendor === v));
  let stats = present.map(v => vendorStats(v, f));
  const totNamed = stats.reduce((a, r) => a + r.value, 0);
  stats.sort((a,b) => {
    const k = VEN.sort;
    const av = k === 'key' ? a.key : k === 'share' ? a.value : (a[k] == null ? -Infinity : a[k]);
    const bv = k === 'key' ? b.key : k === 'share' ? b.value : (b[k] == null ? -Infinity : b[k]);
    if (k === 'key') return VEN.dir * String(av).localeCompare(String(bv), undefined, {numeric:true});
    return VEN.dir * (av - bv);
  });
  if (!VEN.selected || !present.includes(VEN.selected)) VEN.selected = stats.length ? stats[0].key : null;

  const head = VCOLS.map(([k, lab, cls]) =>
    `<th class="${cls}${VEN.sort===k?' sorted':''}" data-act="ven-sort::${k}">${esc(lab)}<span class="arrow">${VEN.sort===k?(VEN.dir<0?'▼':'▲'):'▲'}</span></th>`).join('');
  const body = stats.map(r => `<tr class="clickable${VEN.selected===r.key?' ':' '}" data-act="ven-pick::${esc(r.key)}"
      style="${VEN.selected===r.key?'background:#eef4ff;':''}">
    ${VCOLS.map(([k, lab, cls, fn]) => `<td class="${cls}">${fn(r, totNamed)}</td>`).join('')}
  </tr>`).join('');

  $('#vendors-root').innerHTML = `
    <div class="sec"><h2>Vendor leaderboard</h2>
      <span class="note">${fmt.int(stats.length)} attributed vendors in the current filter · click a column to sort, a row to profile</span></div>
    <div class="card"><div class="card-b flush"><div class="tbl-scroll">
      <table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </div></div></div>
    <div id="vendor-profile"></div>`;

  renderVendorProfile();
}

function renderVendorProfile(){
  const host = $('#vendor-profile');
  if (!VEN.selected){ host.innerHTML = ''; return; }
  const f = filtered();
  const v = VEN.selected, s = vendorStats(v, f), p = VENDOR_PROFILES[v] || {};
  const rivalOptions = VENDOR_NAMED.filter(x => x !== v && f.some(t => t.vendor === x));
  if (VEN.rival && !rivalOptions.includes(VEN.rival)) VEN.rival = null;
  const rival = VEN.rival ? vendorStats(VEN.rival, f) : null;

  const regionBars = REGION_ORDER.filter(r => s.rows.some(t => t.region === r)).map(r => {
    const rr = s.rows.filter(t => t.region === r);
    const all = f.filter(t => t.region === r && isNamed(t.vendor));
    return {key:r, label:r, color:regionColor(r), value:msum(rr),
      tip:`<b>${esc(r)}</b><br>${metric().fmt(msum(rr))}<br><span class="tk">${fmt.int(rr.length)} sites · ${fmt.pct(msum(all)?100*msum(rr)/msum(all):0)} of attributed ${esc(r)}</span>`};
  }).sort((a,b) => b.value - a.value);

  // Channel penetration: how many of this vendor's sites carry each OCR channel,
  // and how often the channel is actually won by somebody else at the same site.
  const chanRows = OCR_CHANNELS.map(c => {
    const own = f.filter(t => t.ocr_stack && t.ocr_stack[c] && t.ocr_stack[c].vendor === v).length;
    const atOwnSites = s.rows.filter(t => t.ocr_stack && t.ocr_stack[c]).length;
    const lost = s.rows.filter(t => t.ocr_stack && t.ocr_stack[c] && t.ocr_stack[c].vendor !== v).length;
    return {key:c, label:c, color:s.color, value:own,
      tip:`<b>${esc(c)} OCR</b><br>${fmt.int(own)} channels held by ${esc(v)}<br>` +
          `<span class="tk">${fmt.int(atOwnSites)} present at its gate sites · ${fmt.int(lost)} held by a rival there</span>`};
  });

  const years = []; for (let y = 2004; y <= META.base_year; y++) years.push(y);
  const installSeries = [{key:v, color:s.color, values: years.map(y => s.rows.filter(t => t.install_year === y).length)}];

  const expYears = []; for (let y = META.base_year; y <= META.base_year + 10; y++) expYears.push(y);
  const expSeries = [{key:'contract end', color:'#b26a00',
    values: expYears.map(y => s.rows.filter(t => t.contract_end === y).length)}];

  const topSites = s.rows.slice().sort((a,b) => b.volume - a.volume).slice(0, 8);

  const cmpRows = [
    ['Sites', r => fmt.int(r.n)],
    ['Throughput', r => fmt.compact(r.volume*1000)],
    ['Licence base', r => fmt.usd(r.acv)],
    ['Regions covered', r => fmt.int(r.regions)],
    ['Channels per site', r => r.channels != null ? fmt.d1(r.channels) : '—'],
    ['OCR accuracy', r => r.accuracy != null ? fmt.pct(r.accuracy) : '—'],
    ['Uptime', r => r.uptime != null ? fmt.d2(r.uptime)+'%' : '—'],
    ['Truck turn', r => r.turn != null ? fmt.int(r.turn)+' min' : '—'],
    ['Mean incumbency', r => r.age != null ? fmt.d1(r.age)+' yr' : '—'],
    ['TOS-integrated', r => fmt.pct0(r.integrated)],
    ['Direct-sold', r => fmt.pct0(r.direct)],
    ['Mean displacement risk', r => r.risk != null ? fmt.int(r.risk) : '—'],
  ];

  host.innerHTML = `
    <div class="sec"><h2>Vendor profile</h2><span class="note">modelled positioning &amp; footprint</span></div>
    <div class="grid g23">
      <div class="card">
        <div class="card-h"><h3>Identity</h3></div>
        <div class="card-b">
          <div class="vhead"><span class="vsw" style="background:${s.color}"></span><span class="vn">${esc(v)}</span></div>
          <p class="muted" style="font-size:11.5px;margin:2px 0 12px 0;">${esc(p.archetype||'')} · ${esc(p.positioning||'')}</p>
          <dl class="deflist">
            <dt>Founded</dt><dd>${p.founded||'—'}</dd>
            <dt>Home region</dt><dd>${esc(p.hq_region||'—')}</dd>
            <dt>Est. headcount</dt><dd>${fmt.int(p.headcount)}</dd>
            <dt>Regions active</dt><dd>${fmt.int(s.regions)} of ${REGION_ORDER.length}</dd>
            <dt>Sites in view</dt><dd>${fmt.int(s.n)}</dd>
            <dt>Licence base</dt><dd>${fmt.usd(s.acv)}</dd>
            <dt>Contracts ≤24mo</dt><dd>${fmt.int(s.expiring)}</dd>
          </dl>
          <div style="margin-top:12px;">
            <div class="flabel" style="margin-bottom:5px;">Compare against</div>
            <select class="fsel" id="rival-sel" style="width:100%;">
              <option value="">— pick a rival —</option>
              ${rivalOptions.map(x => `<option value="${esc(x)}"${VEN.rival===x?' selected':''}>${esc(x)}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h3>Regional footprint</h3><span class="hint">by ${esc(metric().label.toLowerCase())}</span></div>
        <div class="card-b">${hbars(regionBars, {w:520, labelW:120, fmt:metric().fmt, act:'region'})}</div>
      </div>
    </div>

    <div class="grid g3" style="margin-top:14px;">
      <div class="card">
        <div class="card-h"><h3>OCR channels held</h3><span class="hint">gate / crane / rail / yard</span></div>
        <div class="card-b">${hbars(chanRows, {w:420, labelW:88, fmt:fmt.int})}</div>
      </div>
      <div class="card">
        <div class="card-h"><h3>Install cohort</h3><span class="hint">first-install year</span></div>
        <div class="card-b">${columns(years.map(y => y%3===0?String(y).slice(2):''), installSeries, {w:420, h:180})}</div>
      </div>
      <div class="card">
        <div class="card-h"><h3>Contract runway</h3><span class="hint">sites reaching contract end</span></div>
        <div class="card-b">${columns(expYears.map(y => String(y).slice(2)), expSeries, {w:420, h:180})}</div>
      </div>
    </div>

    ${rival ? `
    <div class="sec"><h2>Head to head</h2><span class="note">${esc(v)} vs ${esc(rival.key)} — current filter only</span></div>
    <div class="card"><div class="card-b flush"><table class="tbl">
      <thead><tr><th class="nosort">Metric</th>
        <th class="n nosort"><span class="sw" style="background:${s.color}"></span>${esc(v)}</th>
        <th class="n nosort"><span class="sw" style="background:${rival.color}"></span>${esc(rival.key)}</th>
        <th class="nosort" style="width:34%;">Relative</th></tr></thead>
      <tbody>${cmpRows.map(([lab, fn]) => {
        const a = fn(s), b = fn(rival);
        const na = numOf(s, lab), nb = numOf(rival, lab);
        const tot = (na||0)+(nb||0);
        const pa = tot ? 100*na/tot : 50;
        return `<tr><td>${lab}</td><td class="n">${a}</td><td class="n">${b}</td>
          <td><span class="bar-track" style="width:100%;"><i style="width:${pa.toFixed(1)}%;background:${s.color};"></i></span></td></tr>`;
      }).join('')}</tbody></table></div></div>` : ''}

    <div class="sec"><h2>Largest ${esc(v)} sites</h2></div>
    <div class="card"><div class="card-b flush"><table class="tbl">
      <thead><tr><th class="nosort">Site</th><th class="nosort">Region</th><th class="nosort">Size class</th>
        <th class="nosort">Channels</th><th class="n nosort">Throughput</th><th class="n nosort">ACV</th>
        <th class="n nosort">Contract end</th><th class="n nosort">Risk</th></tr></thead>
      <tbody>${topSites.map(t => `<tr class="clickable" data-act="site::${esc(t.id)}">
        <td class="mono">${esc(t.id)}</td>
        <td><span class="sw" style="background:${regionColor(t.region)}"></span>${esc(t.region)}</td>
        <td>${esc(t.size_class)}</td>
        <td>${(t.ocr_channels||[]).map(c=>`<span class="tag on">${esc(c)}</span>`).join('')}</td>
        <td class="n">${fmt.compact(t.volume*1000)}</td>
        <td class="n">${fmt.usd(t.acv_kusd)}</td>
        <td class="n">${t.contract_end||'—'}</td>
        <td class="n">${t.displacement_risk!=null?riskBar(t.displacement_risk):'—'}</td></tr>`).join('')}
      </tbody></table></div></div>`;

  const sel = $('#rival-sel');
  if (sel) sel.addEventListener('change', e => { VEN.rival = e.target.value || null; renderVendorProfile(); });
}

/* Numeric backing value for the head-to-head relative bars. */
function numOf(r, label){
  switch(label){
    case 'Sites': return r.n;
    case 'Throughput': return r.volume;
    case 'Licence base': return r.acv;
    case 'Regions covered': return r.regions;
    case 'Channels per site': return r.channels || 0;
    case 'OCR accuracy': return r.accuracy || 0;
    case 'Uptime': return r.uptime || 0;
    case 'Truck turn': return r.turn ? 1000/r.turn : 0;   // lower is better -> invert
    case 'Mean incumbency': return r.age || 0;
    case 'TOS-integrated': return r.integrated;
    case 'Direct-sold': return r.direct;
    case 'Mean displacement risk': return r.risk ? 100 - r.risk : 0;  // lower is better -> invert
    default: return 0;
  }
}
