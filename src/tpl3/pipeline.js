/* ============================================================
   pipeline.js — Pipeline tab: whitespace, renewals, displacement targets
   ============================================================ */
const PIPE = { mode:'all', sort:'score', dir:-1, limit:40, horizon:3 };

const STAGE_WEIGHT = {'Unqualified':0.10, 'Prospect':0.22, 'Qualified':0.42, 'RFP live':0.68, 'Shortlisted':0.85};

/* A single comparable number across two different kinds of opportunity:
   an unattributed site (win the whole thing) and an incumbent-held site
   (displace at renewal). Both are expressed as risk-weighted $k. */
function oppScore(t){
  if (isWhitespace(t)) return t.tam_kusd * (STAGE_WEIGHT[t.deal_stage] || 0.1);
  if (!isNamed(t.vendor) || t.displacement_risk == null) return 0;
  const yrs = Math.max(t.refresh_due_yrs || 0, 0);
  const timing = 1 / (1 + yrs * 0.55);            // near-term renewals score higher
  return t.acv_kusd * (t.displacement_risk / 100) * timing;
}
function oppKind(t){
  return isWhitespace(t) ? 'Whitespace' : isNamed(t.vendor) ? 'Displacement' : 'Out of scope';
}

function renderPipeline(){
  const f = filtered();
  const white = f.filter(isWhitespace);
  const held = f.filter(t => isNamed(t.vendor));
  const pool = PIPE.mode === 'white' ? white : PIPE.mode === 'disp' ? held : white.concat(held);

  const win = (n) => held.filter(t => t.refresh_due_yrs != null && t.refresh_due_yrs <= n);
  const w12 = win(1), w24 = win(2), w36 = win(3);

  const years = []; for (let y = META.base_year; y <= META.base_year + 10; y++) years.push(y);
  const topV = VENDOR_NAMED.filter(v => held.some(t => t.vendor === v))
    .map(v => ({v, n: held.filter(t => t.vendor === v).length}))
    .sort((a,b) => b.n - a.n).slice(0, 7).map(x => x.v);
  const expirySeries = topV.concat(['Other']).map(v => ({
    key:v, color: v === 'Other' ? '#b9c2cb' : vendorColor(v),
    values: years.map(y => held.filter(t => t.contract_end === y &&
      (v === 'Other' ? !topV.includes(t.vendor) : t.vendor === v)).length)
  }));

  const whiteByRegion = REGION_ORDER.filter(r => white.some(t => t.region === r)).map(r => {
    const rows = white.filter(t => t.region === r);
    return {key:r, label:r, color:regionColor(r), value:sum(rows, t => t.tam_kusd),
      tip:`<b>${esc(r)}</b><br>${fmt.usd(sum(rows, t=>t.tam_kusd))} unattributed<br><span class="tk">${fmt.int(rows.length)} sites · ${fmt.compact(sum(rows,t=>t.volume)*1000)} moves/yr</span>`};
  }).sort((a,b) => b.value - a.value);

  const stageItems = DEAL_STAGES.slice().reverse().map(s => {
    const rows = white.filter(t => t.deal_stage === s);
    return {label:s, value:rows.length, color:'#0b5fff',
      sub:`${fmt.usd(sum(rows, t => t.tam_kusd))} · weighted ${fmt.usd(sum(rows, t => t.tam_kusd) * STAGE_WEIGHT[s])}`};
  });

  // Renewal pressure: region x year-to-renewal
  const bands = ['now','1 yr','2 yr','3 yr','4 yr','5+ yr'];
  const regs = REGION_ORDER.filter(r => held.some(t => t.region === r));
  const renewGet = (r, b) => {
    const i = bands.indexOf(b);
    const rows = held.filter(t => t.region === r &&
      (i === 5 ? t.refresh_due_yrs >= 5 : t.refresh_due_yrs === i));
    return {value: rows.length,
      tip:`<b>${esc(r)}</b> · renewal in ${esc(b)}<br>${fmt.int(rows.length)} sites<br><span class="tk">${fmt.usd(sum(rows, t => t.acv_kusd))} contracted value</span>`};
  };

  // Target list
  const rows = pool.map(t => ({t, score: oppScore(t)}))
    .sort((a,b) => {
      const k = PIPE.sort;
      const get = x => k === 'score' ? x.score
                     : k === 'value' ? (isWhitespace(x.t) ? x.t.tam_kusd : x.t.acv_kusd)
                     : k === 'risk' ? (x.t.displacement_risk || 0)
                     : k === 'timing' ? -(x.t.refresh_due_yrs == null ? 99 : x.t.refresh_due_yrs)
                     : x.t.volume;
      return PIPE.dir * (get(a) - get(b));
    }).slice(0, PIPE.limit);

  const weightedPipeline = sum(pool, oppScore);

  $('#pipeline-root').innerHTML = `
    <div class="kpis">
      <div class="kpi k-gold"><div class="k">Weighted pipeline</div><div class="v">${fmt.usd(weightedPipeline)}</div>
        <div class="s">whitespace + displacement, risk-adjusted</div></div>
      <div class="kpi k-blue"><div class="k">Whitespace sites</div><div class="v">${fmt.int(white.length)}</div>
        <div class="s">${fmt.usd(sum(white, t => t.tam_kusd))} unattributed value</div></div>
      <div class="kpi k-red"><div class="k">Renewals ≤ 12 mo</div><div class="v">${fmt.int(w12.length)}</div>
        <div class="s">${fmt.usd(sum(w12, t => t.acv_kusd))} in play</div></div>
      <div class="kpi k-orange"><div class="k">Renewals ≤ 24 mo</div><div class="v">${fmt.int(w24.length)}</div>
        <div class="s">${fmt.usd(sum(w24, t => t.acv_kusd))} in play</div></div>
      <div class="kpi k-purple"><div class="k">Renewals ≤ 36 mo</div><div class="v">${fmt.int(w36.length)}</div>
        <div class="s">${fmt.usd(sum(w36, t => t.acv_kusd))} in play</div></div>
      <div class="kpi k-teal"><div class="k">RFP live / shortlisted</div><div class="v">${fmt.int(white.filter(t => t.deal_stage==='RFP live' || t.deal_stage==='Shortlisted').length)}</div>
        <div class="s">active whitespace processes</div></div>
      <div class="kpi k-grey"><div class="k">High displacement risk</div><div class="v">${fmt.int(held.filter(t => (t.displacement_risk||0) >= 66).length)}</div>
        <div class="s">score ≥ 66 on incumbent-held sites</div></div>
    </div>

    <div class="sec"><h2>Renewal runway</h2>
      <span class="note">every incumbent contract eventually re-opens — this is when, and whose it is</span></div>
    <div class="grid g32">
      <div class="card">
        <div class="card-h"><h3>Contracts reaching term end</h3><span class="hint">by incumbent vendor</span></div>
        <div class="card-b">
          ${columns(years.map(y => String(y)), expirySeries, {w:600, h:240, act:'vendor', rotate:true})}
          ${chartLegend(expirySeries.map(s => ({key:s.key, label:s.key, color:s.color})), 'vendor')}
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h3>Renewal pressure by region</h3><span class="hint">sites, by years to contract end</span></div>
        <div class="card-b flush">${heatmap(regs, bands, renewGet, {hue:'#c62828'})}</div>
      </div>
    </div>

    <div class="sec"><h2>Whitespace</h2>
      <span class="note">addressable sites with no attributed incumbent</span></div>
    <div class="grid g2">
      <div class="card">
        <div class="card-h"><h3>Unattributed value by region</h3></div>
        <div class="card-b">${hbars(whiteByRegion, {w:520, labelW:118, fmt:fmt.usd, act:'region'})}</div>
      </div>
      <div class="card">
        <div class="card-h"><h3>Qualification funnel</h3><span class="hint">whitespace only</span></div>
        <div class="card-b">${funnel(stageItems, {w:520})}</div>
      </div>
    </div>

    <div class="sec"><h2>Ranked targets</h2>
      <span class="note">opportunity score = deal value × probability × timing; click a row for the record</span></div>
    <div class="card">
      <div class="card-h">
        <h3>Top ${Math.min(PIPE.limit, rows.length)} targets</h3>
        <div class="right">
          <button class="btn sm${PIPE.mode==='all'?' primary':''}" data-act="pipe-mode::all">All</button>
          <button class="btn sm${PIPE.mode==='white'?' primary':''}" data-act="pipe-mode::white">Whitespace</button>
          <button class="btn sm${PIPE.mode==='disp'?' primary':''}" data-act="pipe-mode::disp">Displacement</button>
          <button class="btn sm" data-act="pipe-limit::x">${PIPE.limit === 40 ? 'Show 150' : 'Show 40'}</button>
        </div>
      </div>
      <div class="card-b flush"><div class="tbl-scroll">
        <table class="tbl"><thead><tr>
          <th class="nosort">Site</th><th class="nosort">Region</th><th class="nosort">Play</th>
          <th class="nosort">Incumbent</th>
          <th class="n${PIPE.sort==='volume'?' sorted':''}" data-act="pipe-sort::volume">Throughput<span class="arrow">▼</span></th>
          <th class="n${PIPE.sort==='value'?' sorted':''}" data-act="pipe-sort::value">Deal value<span class="arrow">▼</span></th>
          <th class="n${PIPE.sort==='timing'?' sorted':''}" data-act="pipe-sort::timing">Renewal<span class="arrow">▼</span></th>
          <th class="n${PIPE.sort==='risk'?' sorted':''}" data-act="pipe-sort::risk">Risk / stage<span class="arrow">▼</span></th>
          <th class="n${PIPE.sort==='score'?' sorted':''}" data-act="pipe-sort::score">Score<span class="arrow">▼</span></th>
        </tr></thead>
        <tbody>${rows.map(({t, score}) => `<tr class="clickable" data-act="site::${esc(t.id)}">
          <td class="mono">${esc(t.id)}</td>
          <td><span class="sw" style="background:${regionColor(t.region)}"></span>${esc(t.region)}</td>
          <td><span class="pill ${isWhitespace(t)?'info':'warn'}">${oppKind(t)}</span></td>
          <td>${isWhitespace(t) ? '<span class="muted">none</span>'
                : `<span class="sw" style="background:${vendorColor(t.vendor)}"></span>${esc(t.vendor)}`}</td>
          <td class="n">${fmt.compact(t.volume*1000)}</td>
          <td class="n">${fmt.usd(isWhitespace(t) ? t.tam_kusd : t.acv_kusd)}</td>
          <td class="n">${t.contract_end ? t.contract_end + ' <span class="muted">(' + t.refresh_due_yrs + 'y)</span>' : '—'}</td>
          <td class="n">${isWhitespace(t) ? `<span class="pill info">${esc(t.deal_stage)}</span>` : riskBar(t.displacement_risk)}</td>
          <td class="n"><b>${fmt.usd(score)}</b></td>
        </tr>`).join('')}</tbody></table>
      </div></div>
    </div>`;
}
