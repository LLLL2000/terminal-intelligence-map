/* ============================================================
   dashboard.js — Overview tab
   ============================================================ */
const OV = { shareMode:false, adoptionCum:false, topN:12, topSort:'volume', withWhitespace:false };

function vendorBreakdown(rows, opts){
  opts = opts || {};
  const m = groupBy(rows, t => t.vendor);
  return VENDOR_ORDER
    .filter(v => m.has(v) && (!opts.namedOnly || isNamed(v)))
    .map(v => ({key:v, label:v, color:vendorColor(v), value:msum(m.get(v)), n:m.get(v).length}))
    .sort((a,b) => b.value - a.value);
}

/* Herfindahl index over attributed vendors only — whitespace is excluded because
   an unattributed site tells you nothing about concentration. */
function hhi(rows){
  const named = rows.filter(t => isNamed(t.vendor));
  const tot = msum(named);
  if (!tot) return null;
  const m = groupBy(named, t => t.vendor);
  let s = 0;
  m.forEach(g => { const sh = msum(g)/tot; s += sh*sh; });
  return Math.round(s * 10000);
}

function renderOverview(){
  const f = filtered();
  const named = f.filter(t => isNamed(t.vendor));
  const white = f.filter(isWhitespace);
  const withStack = f.filter(t => t.channel_count > 0);
  const M = metric();

  const totalVol = sum(f, t => t.volume);
  const coveredVol = sum(named, t => t.volume);
  const acv = sum(named, t => t.acv_kusd);
  const openTam = sum(white, t => t.tam_kusd);
  const expiring = named.filter(t => t.refresh_due_yrs != null && t.refresh_due_yrs <= 2);
  const conc = hhi(f);

  const kpis = [
    ['k-blue',  'Terminals in view', fmt.int(f.length),
      `${fmt.int(named.length)} attributed · ${fmt.int(white.length)} whitespace`],
    ['k-teal',  'Annual throughput', fmt.compact(totalVol*1000),
      'container moves, TEU-equivalent'],
    ['k-green', 'Vendor-covered volume', fmt.pct0(totalVol ? 100*coveredVol/totalVol : 0),
      `${fmt.compact(coveredVol*1000)} of ${fmt.compact(totalVol*1000)}`],
    ['k-purple','Installed licence base', fmt.usd(acv),
      `${fmt.usd(named.length ? acv/named.length : 0)} median site`],
    ['k-gold',  'Open opportunity', fmt.usd(openTam),
      `${fmt.int(white.length)} unattributed sites`],
    ['k-red',   'Contracts ≤ 24 months', fmt.int(expiring.length),
      `${fmt.usd(sum(expiring, t => t.acv_kusd))} at risk`],
    ['k-orange','Market concentration', conc == null ? '—' : fmt.int(conc),
      'HHI, attributed sites only'],
    ['k-grey',  'Mean OCR accuracy', fmt.pct(mean(named, t => t.ocr_accuracy)),
      `median truck turn ${fmt.int(median(f, t => t.truck_turn_min))} min`],
  ];

  const vbNamed = vendorBreakdown(f, {namedOnly:true});
  // Whitespace outweighs every vendor by construction, so it is off by default —
  // otherwise it flattens the bars that are actually being compared.
  const vb = OV.withWhitespace ? vendorBreakdown(f) : vbNamed;
  const vbBase = msum(OV.withWhitespace ? f : f.filter(t => isNamed(t.vendor)));

  // Region x vendor
  const regRows = REGION_ORDER.filter(r => f.some(t => t.region === r)).map(r => {
    const rows = f.filter(t => t.region === r);
    const m = groupBy(rows, t => t.vendor);
    return {
      label: r,
      total: msum(rows),
      parts: VENDOR_ORDER.filter(v => m.has(v)).map(v => ({key:v, color:vendorColor(v), value:msum(m.get(v))})),
    };
  });

  // Adoption by install year, stacked by vendor (top 6 + other)
  const years = []; for (let y = 2004; y <= META.base_year; y++) years.push(y);
  const topV = vbNamed.slice(0, 6).map(x => x.key);
  const adoptSeries = topV.concat(['Other']).map(v => ({
    key: v, color: v === 'Other' ? '#b9c2cb' : vendorColor(v),
    values: years.map(y => {
      const rows = named.filter(t => t.install_year === y && (v === 'Other' ? !topV.includes(t.vendor) : t.vendor === v));
      return OV.adoptionCum
        ? named.filter(t => t.install_year <= y && (v === 'Other' ? !topV.includes(t.vendor) : t.vendor === v)).length
        : rows.length;
    })
  }));

  // Status + freshness donuts
  const statusItems = STATUS_ORDER.filter(s => f.some(t => t.status === s)).map(s => ({
    key:s, label:s.replace(' (researched)',''), value: f.filter(t => t.status===s).length,
    color: {'Confirmed':'#0a7d55','Inferred':'#c9a227','Conflict':'#c62828',
            'TBD (researched)':'#c3cad2','Defunct':'#2b3440'}[s]
  }));
  const freshItems = ['Fresh','Ageing','Stale'].map(k => ({
    key:k, label:k, value: f.filter(t => t.freshness===k).length,
    color: {Fresh:'#0a7d55', Ageing:'#c9a227', Stale:'#c62828'}[k]
  }));

  // Top terminals
  const sortKey = {volume:t=>t.volume, acv:t=>t.acv_kusd, risk:t=>t.displacement_risk||0}[OV.topSort];
  const top = f.slice().sort((a,b) => sortKey(b) - sortKey(a)).slice(0, OV.topN);

  $('#overview-root').innerHTML = `
    <div class="kpis">
      ${kpis.map(([c,k,v,s]) => `<div class="kpi ${c}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('')}
    </div>

    <div class="sec"><h2>Vendor footprint</h2>
      <span class="note">measured by ${esc(M.label.toLowerCase())} — switch the metric in the filter bar; click any bar to isolate that vendor</span></div>
    <div class="grid g32">
      <div class="card">
        <div class="card-h"><h3>Share of ${esc(M.label.toLowerCase())}</h3>
          <span class="hint">${OV.withWhitespace ? 'attributed + whitespace' : 'attributed vendors only'}</span>
          <div class="right">
            <button class="btn sm" data-act="ov-white::x">${OV.withWhitespace?'Hide whitespace':'Include whitespace'}</button>
          </div></div>
        <div class="card-b">
          ${hbars(vb.map(x => Object.assign({}, x, {
              label: x.label, value: x.value,
              tip: `<b>${esc(x.label)}</b><br>${M.fmt(x.value)}<br><span class="tk">${fmt.int(x.n)} sites · ${fmt.pct(vbBase?100*x.value/vbBase:0)} of ${OV.withWhitespace?'view':'attributed base'}</span>`
            })), {w:560, act:'vendor', fmt:M.fmt})}
          ${OV.withWhitespace ? '' : `<p class="muted" style="font-size:11px;margin:8px 0 0 0;">
            Excludes <b>${fmt.int(white.length)}</b> whitespace sites (${fmt.pct0(f.length?100*white.length/f.length:0)} of the view,
            ${fmt.usd(openTam)} opportunity) — they have no attributed vendor.</p>`}
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h3>Vendor mix by region</h3>
          <span class="hint">${OV.shareMode ? 'normalised to 100%' : 'absolute'}</span>
          <div class="right"><button class="btn sm" data-act="ov-share::x">${OV.shareMode?'Show absolute':'Show 100%'}</button></div></div>
        <div class="card-b">
          ${stackedRows(regRows, {w:560, act:'vendor', fmt:M.fmt, shareMode:OV.shareMode})}
          ${chartLegend(vbNamed.slice(0,8).map(x => ({key:x.key, label:x.label, color:x.color, count:x.n})), 'vendor')}
        </div>
      </div>
    </div>

    <div class="sec"><h2>Adoption timeline</h2>
      <span class="note">first-install year of the incumbent system at each attributed site</span></div>
    <div class="grid g32">
      <div class="card">
        <div class="card-h"><h3>${OV.adoptionCum ? 'Cumulative installed base' : 'New installs per year'}</h3>
          <div class="right"><button class="btn sm" data-act="ov-cum::x">${OV.adoptionCum?'Show annual':'Show cumulative'}</button></div></div>
        <div class="card-b">
          ${columns(years.map(y => (y % 2 === 0 ? String(y).slice(2) : '')), adoptSeries, {w:600, h:230, act:'vendor'})}
          ${chartLegend(adoptSeries.map(s => ({key:s.key, label:s.key, color:s.color})), 'vendor')}
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h3>Attribution quality</h3><span class="hint">status &amp; record freshness</span></div>
        <div class="card-b">
          <div class="grid g2" style="gap:8px;">
            <div>${donut(statusItems, {size:150, centerLabel:fmt.int(f.length), centerSub:'sites', act:'status'})}
              ${chartLegend(statusItems.map(s=>({key:s.key,label:s.label,color:s.color,count:s.value})), 'status')}</div>
            <div>${donut(freshItems, {size:150, centerLabel:fmt.pct0(f.length?100*freshItems[0].value/f.length:0), centerSub:'fresh'})}
              ${chartLegend(freshItems.map(s=>({label:s.label,color:s.color,count:s.value})))}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="sec"><h2>Largest terminals in view</h2>
      <span class="note">click a row for the full record</span></div>
    <div class="card">
      <div class="card-h"><h3>Top ${OV.topN}</h3>
        <div class="right">
          <button class="btn sm${OV.topSort==='volume'?' primary':''}" data-act="ov-top::volume">Throughput</button>
          <button class="btn sm${OV.topSort==='acv'?' primary':''}" data-act="ov-top::acv">Licence value</button>
          <button class="btn sm${OV.topSort==='risk'?' primary':''}" data-act="ov-top::risk">Displacement risk</button>
        </div></div>
      <div class="card-b flush"><div class="tbl-scroll tall">
        <table class="tbl"><thead><tr>
          <th class="nosort">Site</th><th class="nosort">Region</th><th class="nosort">Vendor</th>
          <th class="nosort">Channels</th><th class="n nosort">Throughput</th><th class="n nosort">ACV</th>
          <th class="n nosort">Accuracy</th><th class="n nosort">Turn</th><th class="n nosort">Risk</th>
          <th class="nosort">Trend</th></tr></thead>
        <tbody>${top.map(t => `<tr class="clickable" data-act="site::${esc(t.id)}">
          <td class="mono">${esc(t.id)}</td>
          <td><span class="sw" style="background:${regionColor(t.region)}"></span>${esc(t.region)}</td>
          <td><span class="sw" style="background:${vendorColor(t.vendor)}"></span>${esc(t.vendor)}</td>
          <td>${(t.ocr_channels||[]).map(c=>`<span class="tag on">${esc(c)}</span>`).join('') || '<span class="muted">—</span>'}</td>
          <td class="n">${fmt.compact(t.volume*1000)}</td>
          <td class="n">${fmt.usd(t.acv_kusd)}</td>
          <td class="n">${t.ocr_accuracy!=null?fmt.pct(t.ocr_accuracy):'—'}</td>
          <td class="n">${t.truck_turn_min} min</td>
          <td class="n">${t.displacement_risk!=null?riskBar(t.displacement_risk):'—'}</td>
          <td>${sparkline(t.vol_history, 74, 22, vendorColor(t.vendor))}</td>
        </tr>`).join('')}</tbody></table>
      </div></div>
    </div>`;
}
