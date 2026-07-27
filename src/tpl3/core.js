/* ============================================================
   core.js — shared state, filtering, formatting, tooltip, drawer
   ============================================================ */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

function esc(s){
  return (s == null ? '' : String(s)).replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

const CATEGORY_BUCKETS = ['In-house / Proprietary', 'TBD (researched)', 'Defunct'];
const TYPES = [['marine','Marine'], ['rail','Rail'], ['industrial','Industrial']];
const AUTOMATION_LEVELS = ['Automated', 'Semi-automated', 'Manual'];

/* ---------- formatting ---------- */
const fmt = {
  int:  n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-US'),
  d1:   n => (n == null || isNaN(n)) ? '—' : n.toFixed(1),
  d2:   n => (n == null || isNaN(n)) ? '—' : n.toFixed(2),
  pct:  n => (n == null || isNaN(n)) ? '—' : n.toFixed(1) + '%',
  pct0: n => (n == null || isNaN(n)) ? '—' : Math.round(n) + '%',
  // Compact numbers for axes and tiles.
  compact(n){
    if (n == null || isNaN(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e6) return (n/1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e3) return (n/1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
    if (a >= 100) return Math.round(n).toString();
    return (Math.round(n*10)/10).toString();
  },
  // ACV / TAM are carried in $k.
  usd(k){
    if (k == null || isNaN(k)) return '—';
    if (Math.abs(k) >= 1000) return '$' + (k/1000).toFixed(k >= 10000 ? 0 : 1) + 'M';
    return '$' + Math.round(k) + 'k';
  },
  signed: n => (n == null || isNaN(n)) ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%',
  date: s => s || '—',
};

const sum  = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
const mean = (arr, f) => { const v = arr.map(f).filter(x => x != null && !isNaN(x));
                           return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null; };
const median = (arr, f) => { const v = arr.map(f).filter(x => x != null && !isNaN(x)).sort((a,b)=>a-b);
                             if (!v.length) return null;
                             const m = v.length >> 1;
                             return v.length % 2 ? v[m] : (v[m-1]+v[m])/2; };
function groupBy(arr, f){
  const m = new Map();
  arr.forEach(x => { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
  return m;
}
const vendorColor = v => VENDOR_COLORS[v] || '#9aa5b1';
const regionColor = r => REGION_COLORS[r] || '#9aa5b1';
const isNamed = v => VENDOR_NAMED.includes(v);
const isWhitespace = t => t.vendor === 'TBD (researched)';

/* ---------- global filter state ---------- */
const STATE = {
  regions:    new Set(REGION_ORDER),
  types:      new Set(TYPES.map(t => t[0])),
  statuses:   new Set(['Confirmed', 'Inferred', 'Conflict', 'TBD (researched)']),
  automation: new Set(AUTOMATION_LEVELS),
  vendor:     'all',
  size:       'all',
  metric:     'sites',
  search:     '',
};
const SIZE_CLASSES = Array.from(new Set(TERMINALS.map(t => t.size_class))).sort();

const _subs = [];
function onFilterChange(fn){ _subs.push(fn); }
function emitFilterChange(){
  renderFilterSummary();
  _subs.forEach(fn => { try { fn(); } catch(e){ console.error(e); } });
}

function matches(t){
  if (!STATE.regions.has(t.region)) return false;
  if (!STATE.types.has(t.type)) return false;
  if (!STATE.statuses.has(t.status)) return false;
  if (!STATE.automation.has(t.automation)) return false;
  if (STATE.vendor !== 'all' && t.vendor !== STATE.vendor) return false;
  if (STATE.size !== 'all' && t.size_class !== STATE.size) return false;
  if (STATE.search){
    const q = STATE.search.toLowerCase();
    const hay = (t.id+' '+t.name+' '+t.operator+' '+t.vendor+' '+t.segment+' '+t.tos+' '+
                 (t.size_class||'')+' '+(t.automation||'')+' '+(t.sales_channel||'')).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
let _cache = null;
function filtered(){
  if (_cache) return _cache;
  _cache = TERMINALS.filter(matches);
  return _cache;
}
function invalidate(){ _cache = null; }

/* ---------- metric abstraction ---------- */
const METRICS = {
  sites:  {label:'Sites',      short:'sites', get: () => 1,            fmt: fmt.int,     axis: fmt.compact},
  volume: {label:'Throughput', short:'k moves/yr', get: t => t.volume, fmt: n => fmt.compact(n) + 'k', axis: fmt.compact},
  acv:    {label:'Licence value', short:'ACV', get: t => t.acv_kusd,   fmt: fmt.usd,     axis: n => fmt.usd(n)},
};
const metric   = () => METRICS[STATE.metric];
const mval     = t => metric().get(t) || 0;
const msum     = arr => sum(arr, mval);
const mfmt     = n => metric().fmt(n);

/* ---------- filter bar rendering ---------- */
function chip(label, on, count, color){
  const style = color && on ? ` style="background:${color};border-color:${color};"` : '';
  return `<span class="chip${on ? ' on c-region' : ''}"${style} data-v="${esc(label)}">${esc(label)}` +
         (count != null ? `<span class="cn">${count}</span>` : '') + `</span>`;
}

function renderFilterBar(){
  const counts = (f) => {
    const m = new Map();
    TERMINALS.forEach(t => { const k = f(t); m.set(k, (m.get(k)||0)+1); });
    return m;
  };
  const cReg = counts(t => t.region), cTyp = counts(t => t.type),
        cSta = counts(t => t.status), cAut = counts(t => t.automation);

  $('#f-region').innerHTML = REGION_ORDER.filter(r => cReg.get(r))
    .map(r => chip(r, STATE.regions.has(r), cReg.get(r), regionColor(r))).join('');
  $('#f-type').innerHTML = TYPES.filter(([k]) => cTyp.get(k))
    .map(([k, lab]) => `<span class="chip${STATE.types.has(k)?' on':''}" data-v="${k}">${lab}<span class="cn">${cTyp.get(k)}</span></span>`).join('');
  $('#f-status').innerHTML = STATUS_ORDER.filter(s => cSta.get(s))
    .map(s => chip(s.replace(' (researched)',''), STATE.statuses.has(s), cSta.get(s))).join('')
    .replace(/data-v="TBD"/, 'data-v="TBD (researched)"');
  $('#f-automation').innerHTML = AUTOMATION_LEVELS.filter(a => cAut.get(a))
    .map(a => chip(a, STATE.automation.has(a), cAut.get(a))).join('');

  const vendorOpts = ['<option value="all">All vendors</option>']
    .concat(VENDOR_ORDER.filter(v => TERMINALS.some(t => t.vendor === v))
      .map(v => `<option value="${esc(v)}"${STATE.vendor===v?' selected':''}>${esc(v)} (${TERMINALS.filter(t=>t.vendor===v).length})</option>`));
  $('#f-vendor').innerHTML = vendorOpts.join('');

  $('#f-size').innerHTML = ['<option value="all">All sizes</option>']
    .concat(SIZE_CLASSES.map(s => `<option value="${esc(s)}"${STATE.size===s?' selected':''}>${esc(s)}</option>`)).join('');

  bindChips('#f-region', STATE.regions);
  bindChips('#f-type', STATE.types);
  bindChips('#f-status', STATE.statuses);
  bindChips('#f-automation', STATE.automation);
}

function bindChips(sel, set){
  $$(sel + ' .chip').forEach(el => {
    el.addEventListener('click', (ev) => {
      const v = el.dataset.v;
      // alt/meta-click isolates a single value; plain click toggles.
      if (ev.altKey || ev.metaKey){ set.clear(); set.add(v); }
      else if (set.has(v)) { if (set.size > 1) set.delete(v); }
      else set.add(v);
      invalidate(); renderFilterBar(); emitFilterChange();
    });
  });
}

function renderFilterSummary(){
  const f = filtered();
  const pct = TERMINALS.length ? (100 * f.length / TERMINALS.length) : 0;
  const vol = sum(f, t => t.volume), acv = sum(f.filter(t => isNamed(t.vendor)), t => t.acv_kusd);
  $('#filter-summary').innerHTML =
    `<b>${fmt.int(f.length)}</b> of ${fmt.int(TERMINALS.length)} terminals (${fmt.pct0(pct)}) · ` +
    `<b>${fmt.compact(vol*1000)}</b> moves/yr · <b>${fmt.usd(acv)}</b> contracted licence value`;
}

function resetFilters(){
  STATE.regions = new Set(REGION_ORDER);
  STATE.types = new Set(TYPES.map(t => t[0]));
  STATE.statuses = new Set(['Confirmed','Inferred','Conflict','TBD (researched)']);
  STATE.automation = new Set(AUTOMATION_LEVELS);
  STATE.vendor = 'all'; STATE.size = 'all'; STATE.search = '';
  $('#f-search').value = '';
  invalidate(); renderFilterBar(); emitFilterChange();
}

/* ---------- shared tooltip ---------- */
const TT = {
  el: null,
  show(html, ev){
    if (!this.el) this.el = $('#tooltip');
    this.el.innerHTML = html;
    this.el.classList.add('on');
    this.move(ev);
  },
  move(ev){
    if (!this.el || !ev) return;
    const pad = 14, w = this.el.offsetWidth, h = this.el.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - pad;
    this.el.style.left = x + 'px'; this.el.style.top = y + 'px';
  },
  hide(){ if (this.el) this.el.classList.remove('on'); }
};
function tipBind(el, htmlFn){
  el.addEventListener('mousemove', e => TT.show(htmlFn(), e));
  el.addEventListener('mouseleave', () => TT.hide());
}

/* ---------- terminal detail drawer ---------- */
function openDrawer(t){
  const stack = t.ocr_stack || {};
  const chRows = OCR_CHANNELS.map(c => {
    const s = stack[c];
    return `<div class="p"><span class="pk">${c}</span><span class="pv">` +
      (s ? `<span class="sw" style="background:${vendorColor(s.vendor)}"></span>${esc(s.vendor)} <span class="muted">'${String(s.year).slice(2)}</span>`
         : '<span class="muted">not deployed</span>') + `</span></div>`;
  }).join('');

  const p = (k, v, wide) => `<div class="p${wide?' wide':''}"><span class="pk">${k}</span><span class="pv">${v}</span></div>`;
  const yn = b => b ? '<span class="pill ok">yes</span>' : '<span class="pill mute">no</span>';
  const marine = t.type === 'marine';

  $('#drawer-head').innerHTML = `
    <div>
      <div style="font-size:15px;font-weight:650;">${esc(t.name)}</div>
      <div class="muted" style="font-size:11.5px;margin-top:2px;">
        ${esc(t.segment)} · ${esc(t.region)} · ${esc(t.size_class)}
      </div>
      <div style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap;">
        <span class="pill" style="background:${vendorColor(t.vendor)}22;color:${vendorColor(t.vendor)};border-color:${vendorColor(t.vendor)}55;">${esc(t.vendor)}</span>
        <span class="pill ${t.status==='Confirmed'?'ok':t.status==='Conflict'?'bad':t.status==='Inferred'?'warn':'mute'}">${esc(t.status)}</span>
        ${t.internet_inferred ? `<span class="pill info">web-inferred · ${esc(t.confidence)}</span>` : ''}
        ${t.multi_vendor ? '<span class="pill dark">multi-vendor</span>' : ''}
      </div>
    </div>`;

  // Where two sources disagreed, both claims are preserved rather than silently
  // collapsing to the winner.
  const conflictBlock = (t.status === 'Conflict' && t.df_claim) ? `
    <div class="callout" style="margin-bottom:12px;padding:9px 11px;">
      <b>Source conflict.</b> Source A attributes this site to
      <b>${esc(t.mm_claim || t.vendor)}</b>; source B attributes it to <b>${esc(t.df_claim)}</b>.
      Source A wins the tie-break and drives the maps and totals; source B's claim is kept here.
    </div>` : '';

  $('#drawer-body').innerHTML = `
    ${conflictBlock}
    <h4>Throughput</h4>
    <div style="display:flex;align-items:flex-end;gap:14px;margin-bottom:8px;">
      <div>
        <div style="font-size:26px;font-weight:650;line-height:1;font-variant-numeric:tabular-nums;">${fmt.compact(t.volume*1000)}</div>
        <div class="muted" style="font-size:11px;">${esc(t.volume_unit)}</div>
      </div>
      <div style="flex:1;">${sparkline(t.vol_history, 150, 40)}</div>
      <div style="text-align:right;">
        <div class="delta ${t.cagr_3y>0.5?'up':t.cagr_3y<-0.5?'down':'flat'}">${fmt.signed(t.cagr_3y)}</div>
        <div class="muted" style="font-size:10.5px;">CAGR</div>
      </div>
    </div>

    <h4>OCR channel stack</h4>
    <div class="props">${chRows}</div>

    <h4>Systems</h4>
    <div class="props">
      ${p('TOS', esc(t.tos))}
      ${p('Integration', esc(t.integration || '—'))}
      ${p('Hosting', esc(t.hosting || '—'))}
      ${p('Sales channel', esc(t.sales_channel || '—'))}
      ${p('Damage AI', yn(t.damage_ai))}
      ${p('ANPR', yn(t.anpr))}
      ${p('Weighbridge link', yn(t.weighbridge_link))}
      ${p('Support', esc(t.support_tier || '—'))}
    </div>

    <h4>Operating KPIs</h4>
    <div class="props">
      ${p('OCR read accuracy', t.ocr_accuracy != null ? fmt.pct(t.ocr_accuracy) : '—')}
      ${p('System uptime', t.uptime_pct != null ? fmt.d2(t.uptime_pct)+'%' : '—')}
      ${p('Gate automation', fmt.pct0(t.gate_automation_pct))}
      ${p('Truck turn time', t.truck_turn_min + ' min')}
      ${p('Gate moves / hr', fmt.int(t.gate_moves_hr))}
      ${p('Annual truck visits', fmt.compact(t.annual_trucks_k*1000))}
    </div>

    <h4>Infrastructure</h4>
    <div class="props">
      ${marine ? p('Berths', fmt.int(t.berths)) : p('Rail tracks', fmt.int(t.rail_tracks))}
      ${marine ? p('Quay length', fmt.int(t.quay_m)+' m') : p('On-dock rail', yn(t.on_dock_rail))}
      ${marine ? p('Max draft', t.depth_m ? fmt.d1(t.depth_m)+' m' : '—') : p('Reach stackers', fmt.int(t.reach_stackers))}
      ${p('Yard area', fmt.int(t.yard_ha)+' ha')}
      ${marine ? p('STS cranes', fmt.int(t.sts_cranes)) : ''}
      ${p('Yard cranes', fmt.int(t.yard_cranes))}
      ${p('Gate lanes', fmt.int(t.gate_lanes))}
      ${p('Reefer plugs', fmt.int(t.reefer_plugs))}
      ${p('Automation', esc(t.automation))}
      ${p('Operator', esc(t.operator || '—') + (t.multi_op ? ' <span class="pill mute">multi-site</span>' : ''))}
    </div>

    <h4>Commercial position</h4>
    <div class="props">
      ${p('Annual licence value', fmt.usd(t.acv_kusd))}
      ${p('Opportunity size', fmt.usd(t.tam_kusd))}
      ${p('First install', t.install_year || '—')}
      ${p('Last upgrade', t.last_upgrade_year || '—')}
      ${p('Contract term', t.contract_years ? t.contract_years + ' yr' : '—')}
      ${p('Contract end', t.contract_end || '—')}
      ${p('Incumbency', t.incumbency_yrs ? t.incumbency_yrs + ' yr' : '—')}
      ${p('Deal stage', t.deal_stage ? `<span class="pill info">${esc(t.deal_stage)}</span>` : '—')}
      ${p('Displacement risk', t.displacement_risk != null ? riskBar(t.displacement_risk) : '—', true)}
    </div>

    <h4>Record</h4>
    <div class="props">
      ${p('Site id', `<span class="mono">${esc(t.id)}</span>`)}
      ${p('Coordinates', `<span class="mono">${t.lat.toFixed(3)}, ${t.lon.toFixed(3)}</span>`)}
      ${p('Confidence', scoreBar(t.confidence_score))}
      ${p('Completeness', scoreBar(t.data_completeness))}
      ${p('Last verified', fmt.date(t.last_verified))}
      ${p('Freshness', `<span class="pill ${t.freshness==='Fresh'?'ok':t.freshness==='Ageing'?'warn':'bad'}">${esc(t.freshness)}</span>`)}
    </div>
    <p class="muted" style="font-size:11px;margin-top:14px;">
      Attribute values on this record are modelled, not observed — see Methodology.
    </p>`;

  $('#drawer').classList.add('on');
  $('#scrim').classList.add('on');
}
function closeDrawer(){ $('#drawer').classList.remove('on'); $('#scrim').classList.remove('on'); }

function riskBar(v){
  const c = v >= 66 ? '#c62828' : v >= 40 ? '#b26a00' : '#0a7d55';
  return `<span class="bar-track"><i style="width:${v}%;background:${c};"></i></span> <b style="color:${c};">${v}</b>`;
}
function scoreBar(v){
  const c = v >= 75 ? '#0a7d55' : v >= 50 ? '#b26a00' : '#c62828';
  return `<span class="bar-track"><i style="width:${v}%;background:${c};"></i></span> ${v}`;
}

/* ---------- CSV export ---------- */
function downloadCSV(rows, cols, filename){
  const head = cols.map(c => `"${c.key}"`).join(',');
  const body = rows.map(r => cols.map(c => {
    let v = c.raw ? c.raw(r) : r[c.key];
    if (v == null) v = '';
    if (typeof v === 'object') v = JSON.stringify(v);
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(',')).join('\n');
  const blob = new Blob([head + '\n' + body], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
