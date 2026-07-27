/* ============================================================
   technology.js — Technology tab: channel stack, automation, KPIs
   ============================================================ */
const TECH = { y:'truck_turn_min', color:'automation', matrix:'sites' };

const Y_OPTIONS = [
  ['truck_turn_min', 'Truck turn time (min)', v => fmt.int(v)+' min'],
  ['ocr_accuracy',   'OCR read accuracy (%)', v => fmt.pct(v)],
  ['gate_automation_pct', 'Gate automation (%)', v => fmt.pct0(v)],
  ['gate_moves_hr',  'Gate moves / hour', v => fmt.int(v)],
  ['displacement_risk', 'Displacement risk', v => fmt.int(v)],
];
const COLOR_OPTIONS = [
  ['automation', 'Automation level'],
  ['region', 'Region'],
  ['vendor', 'Vendor'],
  ['size_class', 'Size class'],
];
const AUTO_COLORS = {'Automated':'#0a7d55', 'Semi-automated':'#c9a227', 'Manual':'#8e99a5'};

function techColor(t){
  if (TECH.color === 'region') return regionColor(t.region);
  if (TECH.color === 'vendor') return vendorColor(t.vendor);
  if (TECH.color === 'automation') return AUTO_COLORS[t.automation] || '#9aa5b1';
  const idx = ['Feeder','Small','Mid','Large','Mega','Local ramp','Regional hub','Class I hub','Industrial site'].indexOf(t.size_class);
  return ['#c9d3dc','#9fb4c6','#6d93b3','#3f6f9e','#12497e','#c9d3dc','#8aa6a0','#3f7d6f','#8e99a5'][idx] || '#9aa5b1';
}

function renderTechnology(){
  const f = filtered();
  const attributed = f.filter(t => isNamed(t.vendor));
  const yDef = Y_OPTIONS.find(o => o[0] === TECH.y);

  // ---- Channel penetration matrix: vendor x OCR channel -------------------
  const vendorsIn = VENDOR_NAMED.filter(v => attributed.some(t => t.vendor === v));
  const matrixGet = (v, c) => {
    const held = f.filter(t => t.ocr_stack && t.ocr_stack[c] && t.ocr_stack[c].vendor === v);
    if (TECH.matrix === 'sites') {
      return {value: held.length,
        tip:`<b>${esc(v)}</b> · ${esc(c)} OCR<br>${fmt.int(held.length)} channels held<br>` +
            `<span class="tk">${fmt.usd(sum(held, t => t.acv_kusd))} associated licence value</span>`};
    }
    return {value: Math.round(sum(held, t => t.volume)),
      tip:`<b>${esc(v)}</b> · ${esc(c)} OCR<br>${fmt.compact(sum(held, t=>t.volume)*1000)} moves/yr covered`};
  };

  // ---- Automation posture by region --------------------------------------
  const regs = REGION_ORDER.filter(r => f.some(t => t.region === r));
  const autoRows = regs.map(r => {
    const rows = f.filter(t => t.region === r);
    return {label:r, total:rows.length,
      parts: AUTOMATION_LEVELS.map(a => ({key:a, color:AUTO_COLORS[a],
        value: rows.filter(t => t.automation === a).length}))};
  });

  // ---- Feature adoption ---------------------------------------------------
  const feats = [
    ['ANPR / truck plate', t => t.anpr],
    ['AI damage inspection', t => t.damage_ai],
    ['Weighbridge integration', t => t.weighbridge_link],
    ['TOS-integrated', t => t.integration === 'TOS-integrated'],
    ['Edge-hosted inference', t => t.hosting === 'Edge appliance'],
    ['Vendor-cloud hosted', t => t.hosting === 'Vendor cloud'],
    ['Crane OCR present', t => !!(t.ocr_stack && t.ocr_stack['Crane'])],
    ['Rail OCR present', t => !!(t.ocr_stack && t.ocr_stack['Rail'])],
    ['Multi-vendor site', t => t.multi_vendor],
  ].map(([lab, fn]) => {
    const n = attributed.filter(fn).length;
    return {key:lab, label:lab, color:'#0b5fff', value:n,
      tip:`<b>${esc(lab)}</b><br>${fmt.int(n)} of ${fmt.int(attributed.length)} attributed sites · ${fmt.pct(attributed.length?100*n/attributed.length:0)}`};
  }).sort((a,b) => b.value - a.value);

  // ---- Scatter ------------------------------------------------------------
  const pts = f.filter(t => t[TECH.y] != null).map(t => ({
    id: t.id, x: t.volume, y: t[TECH.y], r: t.acv_kusd, color: techColor(t),
    tip: `<b>${esc(t.id)}</b> <span class="tk">${esc(t.region)}</span><br>` +
         `${esc(t.vendor)} · ${esc(t.automation)}<br>` +
         `${fmt.compact(t.volume*1000)} moves/yr · ${yDef[2](t[TECH.y])}<br>` +
         `<span class="tk">${fmt.usd(t.acv_kusd)} ACV · ${esc(t.size_class)}</span>`
  }));
  const colorLegend = TECH.color === 'automation'
      ? AUTOMATION_LEVELS.map(a => ({label:a, color:AUTO_COLORS[a], count:f.filter(t=>t.automation===a).length}))
    : TECH.color === 'region'
      ? regs.map(r => ({label:r, color:regionColor(r), count:f.filter(t=>t.region===r).length}))
    : TECH.color === 'vendor'
      ? vendorsIn.slice(0,10).map(v => ({label:v, color:vendorColor(v), count:f.filter(t=>t.vendor===v).length}))
      : Array.from(new Set(f.map(t=>t.size_class))).map(s => ({label:s, color:techColor({size_class:s})}));

  // ---- TOS x vendor -------------------------------------------------------
  const tosRows = TOS_VENDORS.filter(x => f.some(t => t.tos === x)).map(x => {
    const rows = attributed.filter(t => t.tos === x);
    const m = groupBy(rows, t => t.vendor);
    return {label:x, total:rows.length,
      parts: vendorsIn.filter(v => m.has(v)).map(v => ({key:v, color:vendorColor(v), value:m.get(v).length}))};
  });

  // ---- Accuracy vs. incumbency -------------------------------------------
  const ageBands = [['0–3 yr',0,3],['4–6 yr',4,6],['7–10 yr',7,10],['11–15 yr',11,15],['16+ yr',16,99]];
  const accByAge = ageBands.map(([lab, lo, hi]) => {
    const rows = attributed.filter(t => t.incumbency_yrs >= lo && t.incumbency_yrs <= hi);
    return {label:lab, value: rows.length ? mean(rows, t => t.ocr_accuracy) : 0, n:rows.length};
  });

  $('#technology-root').innerHTML = `
    <div class="kpis">
      <div class="kpi k-blue"><div class="k">Attributed sites</div><div class="v">${fmt.int(attributed.length)}</div>
        <div class="s">${fmt.int(sum(attributed, t => t.channel_count))} OCR channels deployed</div></div>
      <div class="kpi k-green"><div class="k">Mean channels / site</div><div class="v">${fmt.d1(mean(attributed, t => t.channel_count))}</div>
        <div class="s">gate · crane · rail · yard</div></div>
      <div class="kpi k-teal"><div class="k">Mean read accuracy</div><div class="v">${fmt.pct(mean(attributed, t => t.ocr_accuracy))}</div>
        <div class="s">median ${fmt.pct(median(attributed, t => t.ocr_accuracy))}</div></div>
      <div class="kpi k-orange"><div class="k">Median truck turn</div><div class="v">${fmt.int(median(f, t => t.truck_turn_min))}<small>min</small></div>
        <div class="s">across ${fmt.int(f.length)} sites in view</div></div>
      <div class="kpi k-purple"><div class="k">Automated terminals</div><div class="v">${fmt.pct0(f.length?100*f.filter(t=>t.automation==='Automated').length/f.length:0)}</div>
        <div class="s">${fmt.int(f.filter(t=>t.automation==='Automated').length)} sites</div></div>
      <div class="kpi k-gold"><div class="k">Multi-vendor sites</div><div class="v">${fmt.int(f.filter(t=>t.multi_vendor).length)}</div>
        <div class="s">gate and crane held by different suppliers</div></div>
      <div class="kpi k-grey"><div class="k">Mean uptime</div><div class="v">${fmt.d2(mean(attributed, t=>t.uptime_pct))}<small>%</small></div>
        <div class="s">contracted system availability</div></div>
    </div>

    <div class="sec"><h2>OCR channel ownership</h2>
      <span class="note">each site can carry up to four independently-bought OCR channels; a rival winning the crane channel at your gate site is a wedge</span></div>
    <div class="card">
      <div class="card-h"><h3>Vendor × channel</h3>
        <div class="right">
          <button class="btn sm${TECH.matrix==='sites'?' primary':''}" data-act="tech-matrix::sites">Channels held</button>
          <button class="btn sm${TECH.matrix==='volume'?' primary':''}" data-act="tech-matrix::volume">Throughput covered</button>
        </div></div>
      <div class="card-b flush">${heatmap(vendorsIn, OCR_CHANNELS, matrixGet,
        {fmt: TECH.matrix==='sites' ? fmt.int : (n => fmt.compact(n*1000)), act:'vendor'})}</div>
    </div>

    <div class="sec"><h2>Operating performance</h2>
      <span class="note">bubble size = annual licence value · click a point to open the record</span></div>
    <div class="grid g32">
      <div class="card">
        <div class="card-h"><h3>Throughput vs ${esc(yDef[1].toLowerCase())}</h3>
          <div class="right">
            <select class="fsel" id="tech-y">${Y_OPTIONS.map(([k,l]) => `<option value="${k}"${TECH.y===k?' selected':''}>${esc(l)}</option>`).join('')}</select>
            <select class="fsel" id="tech-color">${COLOR_OPTIONS.map(([k,l]) => `<option value="${k}"${TECH.color===k?' selected':''}>colour: ${esc(l)}</option>`).join('')}</select>
          </div></div>
        <div class="card-b">
          ${scatter(pts, {w:600, h:320, xLog:true, xLabel:'annual moves (log scale, thousands)',
            yLabel:yDef[1], xFmt:n => fmt.compact(n)+'k', yFmt:n => fmt.compact(n), act:'site'})}
          ${chartLegend(colorLegend)}
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h3>Automation posture by region</h3><span class="hint">share of sites</span></div>
        <div class="card-b">
          ${stackedRows(autoRows, {w:520, labelW:118, shareMode:true, fmt:fmt.int})}
          ${chartLegend(AUTOMATION_LEVELS.map(a => ({label:a, color:AUTO_COLORS[a], count:f.filter(t=>t.automation===a).length})))}
          <div style="margin-top:14px;">
            <div class="flabel" style="margin-bottom:6px;">Mean read accuracy by incumbency</div>
            ${hbars(accByAge.map(a => Object.assign({}, a, {color:'#0f7b8a',
              tip:`<b>${esc(a.label)}</b><br>${fmt.pct(a.value)} mean accuracy<br><span class="tk">${fmt.int(a.n)} sites</span>`})),
              {w:520, labelW:80, rowH:20, fmt:fmt.pct, max:100})}
          </div>
        </div>
      </div>
    </div>

    <div class="sec"><h2>Capability &amp; stack</h2></div>
    <div class="grid g2">
      <div class="card">
        <div class="card-h"><h3>Feature adoption</h3><span class="hint">attributed sites only</span></div>
        <div class="card-b">${hbars(feats, {w:520, labelW:168, fmt:fmt.int, max:attributed.length||1})}</div>
      </div>
      <div class="card">
        <div class="card-h"><h3>OCR vendor by terminal operating system</h3>
          <span class="hint">where the integration battle is fought</span></div>
        <div class="card-b">
          ${stackedRows(tosRows, {w:520, labelW:118, shareMode:true, fmt:fmt.int, act:'vendor'})}
          ${chartLegend(vendorsIn.slice(0,10).map(v => ({key:v, label:v, color:vendorColor(v)})), 'vendor')}
        </div>
      </div>
    </div>`;

  const ys = $('#tech-y'); if (ys) ys.addEventListener('change', e => { TECH.y = e.target.value; renderTechnology(); });
  const cs = $('#tech-color'); if (cs) cs.addEventListener('change', e => { TECH.color = e.target.value; renderTechnology(); });
}
