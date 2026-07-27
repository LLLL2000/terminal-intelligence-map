/* ============================================================
   database.js — Database tab: the full per-terminal record set
   ============================================================ */
const DB = { sort:'volume', dir:-1, page:0, pageSize:50, cols:null, menuOpen:false };

const stackAt = (t, c) => (t.ocr_stack && t.ocr_stack[c]) ? t.ocr_stack[c].vendor : null;
const swatch  = (c, txt) => `<span class="sw" style="background:${c}"></span>${esc(txt)}`;

const DB_COLS = [
  // key,              label,              group,        cls, raw,                          render
  ['id',              'Site id',           'Identity',   'mono', t => t.id,                 t => t.id],
  ['region',          'Region',            'Identity',   '',   t => t.region,               t => swatch(regionColor(t.region), t.region)],
  ['segment',         'Segment',           'Identity',   '',   t => t.segment,              t => t.segment],
  ['type',            'Facility',          'Identity',   '',   t => t.type,                 t => t.type],
  ['size_class',      'Size class',        'Identity',   '',   t => t.size_class,           t => t.size_class],
  ['operator',        'Operator',          'Identity',   '',   t => t.operator,             t => esc(t.operator) + (t.multi_op ? ' <span class="pill mute">multi</span>' : '')],
  ['lat',             'Lat',               'Identity',   'n',  t => t.lat,                  t => t.lat.toFixed(3)],
  ['lon',             'Lon',               'Identity',   'n',  t => t.lon,                  t => t.lon.toFixed(3)],

  ['vendor',          'Vendor',            'Attribution','',   t => t.vendor,               t => swatch(vendorColor(t.vendor), t.vendor)],
  ['status',          'Status',            'Attribution','',   t => t.status,               t => `<span class="pill ${t.status==='Confirmed'?'ok':t.status==='Conflict'?'bad':t.status==='Inferred'?'warn':'mute'}">${esc(t.status.replace(' (researched)',''))}</span>`],
  ['confidence_score','Confidence',        'Attribution','n',  t => t.confidence_score,     t => scoreBar(t.confidence_score)],
  ['data_completeness','Completeness',     'Attribution','n',  t => t.data_completeness,    t => scoreBar(t.data_completeness)],
  ['internet_inferred','Web-inferred',     'Attribution','',   t => !!t.internet_inferred,  t => t.internet_inferred ? `<span class="pill info">${esc(t.confidence)}</span>` : '<span class="muted">—</span>'],
  ['last_verified',   'Last verified',     'Attribution','',   t => t.last_verified,        t => t.last_verified],
  ['freshness',       'Freshness',         'Attribution','',   t => t.freshness,            t => `<span class="pill ${t.freshness==='Fresh'?'ok':t.freshness==='Ageing'?'warn':'bad'}">${esc(t.freshness)}</span>`],

  ['volume',          'Throughput',        'Capacity',   'n',  t => t.volume,               t => fmt.compact(t.volume*1000)],
  ['cagr_3y',         'CAGR',              'Capacity',   'n',  t => t.cagr_3y,              t => `<span class="delta ${t.cagr_3y>0.5?'up':t.cagr_3y<-0.5?'down':'flat'}">${fmt.signed(t.cagr_3y)}</span>`],
  ['trend',           'Trend',             'Capacity',   '',   t => t.vol_history[4],       t => sparkline(t.vol_history, 66, 20, vendorColor(t.vendor))],
  ['berths',          'Berths',            'Capacity',   'n',  t => t.berths,               t => t.berths || '—'],
  ['quay_m',          'Quay (m)',          'Capacity',   'n',  t => t.quay_m,               t => t.quay_m ? fmt.int(t.quay_m) : '—'],
  ['depth_m',         'Draft (m)',         'Capacity',   'n',  t => t.depth_m,              t => t.depth_m ? fmt.d1(t.depth_m) : '—'],
  ['yard_ha',         'Yard (ha)',         'Capacity',   'n',  t => t.yard_ha,              t => fmt.int(t.yard_ha)],
  ['sts_cranes',      'STS cranes',        'Capacity',   'n',  t => t.sts_cranes,           t => t.sts_cranes || '—'],
  ['yard_cranes',     'Yard cranes',       'Capacity',   'n',  t => t.yard_cranes,          t => t.yard_cranes || '—'],
  ['reach_stackers',  'Reach stackers',    'Capacity',   'n',  t => t.reach_stackers,       t => t.reach_stackers],
  ['gate_lanes',      'Gate lanes',        'Capacity',   'n',  t => t.gate_lanes,           t => t.gate_lanes],
  ['reefer_plugs',    'Reefer plugs',      'Capacity',   'n',  t => t.reefer_plugs,         t => fmt.int(t.reefer_plugs)],
  ['on_dock_rail',    'On-dock rail',      'Capacity',   '',   t => t.on_dock_rail,         t => t.on_dock_rail ? '<span class="pill ok">yes</span>' : '<span class="pill mute">no</span>'],
  ['annual_trucks_k', 'Truck visits',      'Capacity',   'n',  t => t.annual_trucks_k,      t => fmt.compact(t.annual_trucks_k*1000)],

  ['ch_gate',         'Gate OCR',          'OCR stack',  '',   t => stackAt(t,'Gate') || '', t => stackAt(t,'Gate') ? swatch(vendorColor(stackAt(t,'Gate')), stackAt(t,'Gate')) : '<span class="muted">—</span>'],
  ['ch_crane',        'Crane OCR',         'OCR stack',  '',   t => stackAt(t,'Crane') || '', t => stackAt(t,'Crane') ? swatch(vendorColor(stackAt(t,'Crane')), stackAt(t,'Crane')) : '<span class="muted">—</span>'],
  ['ch_rail',         'Rail OCR',          'OCR stack',  '',   t => stackAt(t,'Rail') || '', t => stackAt(t,'Rail') ? swatch(vendorColor(stackAt(t,'Rail')), stackAt(t,'Rail')) : '<span class="muted">—</span>'],
  ['ch_yard',         'Yard OCR',          'OCR stack',  '',   t => stackAt(t,'Yard/UTR') || '', t => stackAt(t,'Yard/UTR') ? swatch(vendorColor(stackAt(t,'Yard/UTR')), stackAt(t,'Yard/UTR')) : '<span class="muted">—</span>'],
  ['channel_count',   'Channels',          'OCR stack',  'n',  t => t.channel_count,        t => t.channel_count],
  ['multi_vendor',    'Multi-vendor',      'OCR stack',  '',   t => t.multi_vendor,         t => t.multi_vendor ? '<span class="pill dark">yes</span>' : '<span class="muted">—</span>'],

  ['tos',             'TOS',               'Systems',    '',   t => t.tos,                  t => t.tos],
  ['integration',     'Integration',       'Systems',    '',   t => t.integration || '',    t => t.integration || '—'],
  ['hosting',         'Hosting',           'Systems',    '',   t => t.hosting || '',        t => t.hosting || '—'],
  ['automation',      'Automation',        'Systems',    '',   t => t.automation,           t => `<span class="pill ${t.automation==='Automated'?'ok':t.automation==='Semi-automated'?'warn':'mute'}">${esc(t.automation)}</span>`],
  ['anpr',            'ANPR',              'Systems',    '',   t => t.anpr,                 t => t.anpr ? '✓' : '—'],
  ['damage_ai',       'Damage AI',         'Systems',    '',   t => t.damage_ai,            t => t.damage_ai ? '✓' : '—'],
  ['weighbridge_link','Weighbridge',       'Systems',    '',   t => t.weighbridge_link,     t => t.weighbridge_link ? '✓' : '—'],

  ['ocr_accuracy',    'Accuracy',          'Performance','n',  t => t.ocr_accuracy,         t => t.ocr_accuracy != null ? fmt.pct(t.ocr_accuracy) : '—'],
  ['uptime_pct',      'Uptime',            'Performance','n',  t => t.uptime_pct,           t => t.uptime_pct != null ? fmt.d2(t.uptime_pct)+'%' : '—'],
  ['gate_automation_pct','Gate autom.',    'Performance','n',  t => t.gate_automation_pct,  t => fmt.pct0(t.gate_automation_pct)],
  ['truck_turn_min',  'Truck turn',        'Performance','n',  t => t.truck_turn_min,       t => t.truck_turn_min + ' min'],
  ['gate_moves_hr',   'Gate moves/hr',     'Performance','n',  t => t.gate_moves_hr,        t => fmt.int(t.gate_moves_hr)],

  ['acv_kusd',        'ACV',               'Commercial', 'n',  t => t.acv_kusd,             t => fmt.usd(t.acv_kusd)],
  ['tam_kusd',        'Opportunity',       'Commercial', 'n',  t => t.tam_kusd,             t => fmt.usd(t.tam_kusd)],
  ['sales_channel',   'Channel',           'Commercial', '',   t => t.sales_channel || '',  t => t.sales_channel || '—'],
  ['support_tier',    'Support',           'Commercial', '',   t => t.support_tier || '',   t => t.support_tier || '—'],
  ['install_year',    'Installed',         'Commercial', 'n',  t => t.install_year,         t => t.install_year || '—'],
  ['last_upgrade_year','Upgraded',         'Commercial', 'n',  t => t.last_upgrade_year,    t => t.last_upgrade_year || '—'],
  ['contract_end',    'Contract end',      'Commercial', 'n',  t => t.contract_end,         t => t.contract_end || '—'],
  ['refresh_due_yrs', 'Yrs to renewal',    'Commercial', 'n',  t => t.refresh_due_yrs,      t => t.refresh_due_yrs != null ? t.refresh_due_yrs : '—'],
  ['incumbency_yrs',  'Incumbency',        'Commercial', 'n',  t => t.incumbency_yrs,       t => t.incumbency_yrs || '—'],
  ['displacement_risk','Displacement risk','Commercial', 'n',  t => t.displacement_risk,    t => t.displacement_risk != null ? riskBar(t.displacement_risk) : '—'],
  ['deal_stage',      'Deal stage',        'Commercial', '',   t => t.deal_stage || '',     t => t.deal_stage ? `<span class="pill info">${esc(t.deal_stage)}</span>` : '—'],
];

const DEFAULT_COLS = ['id','region','vendor','status','size_class','volume','trend','ch_gate','ch_crane',
                      'channel_count','tos','automation','ocr_accuracy','truck_turn_min','acv_kusd',
                      'contract_end','displacement_risk'];

function colByKey(k){ return DB_COLS.find(c => c[0] === k); }

function renderDatabase(){
  if (!DB.cols) DB.cols = DEFAULT_COLS.slice();
  const f = filtered();
  const col = colByKey(DB.sort) || colByKey('volume');
  const rows = f.slice().sort((a, b) => {
    const av = col[4](a), bv = col[4](b);
    if (typeof av === 'string' || typeof bv === 'string')
      return DB.dir * String(av).localeCompare(String(bv), undefined, {numeric:true});
    return DB.dir * ((av == null ? -Infinity : av) - (bv == null ? -Infinity : bv));
  });
  const pages = Math.max(1, Math.ceil(rows.length / DB.pageSize));
  if (DB.page >= pages) DB.page = pages - 1;
  const slice = rows.slice(DB.page * DB.pageSize, (DB.page+1) * DB.pageSize);
  const cols = DB.cols.map(colByKey).filter(Boolean);

  const groups = [];
  DB_COLS.forEach(c => { if (!groups.includes(c[2])) groups.push(c[2]); });

  $('#database-root').innerHTML = `
    <div class="sec"><h2>Per-terminal database</h2>
      <span class="note">${fmt.int(rows.length)} records · ${DB_COLS.length} selectable columns · every row is one terminal</span></div>
    <div class="card">
      <div class="dbbar">
        <div class="colpick">
          <button class="btn" id="colbtn">Columns (${cols.length}) ▾</button>
          <div class="colmenu${DB.menuOpen?' on':''}" id="colmenu">
            ${groups.map(g => `<div class="flabel" style="margin:6px 0 3px 2px;">${esc(g)}</div>` +
              DB_COLS.filter(c => c[2] === g).map(c =>
                `<label><input type="checkbox" data-col="${c[0]}"${DB.cols.includes(c[0])?' checked':''}> ${esc(c[1])}</label>`).join('')).join('')}
            <div style="display:flex;gap:6px;margin-top:8px;">
              <button class="btn sm" data-act="db-cols::all">All</button>
              <button class="btn sm" data-act="db-cols::default">Default</button>
              <button class="btn sm" data-act="db-cols::min">Minimal</button>
            </div>
          </div>
        </div>
        <button class="btn" data-act="db-export::view">Export view (CSV)</button>
        <button class="btn" data-act="db-export::all">Export all fields (CSV)</button>
        <div class="pager" style="margin-left:auto;">
          <button class="btn sm" data-act="db-page::first">«</button>
          <button class="btn sm" data-act="db-page::prev">‹</button>
          <span>page <b>${DB.page+1}</b> / <b>${pages}</b> · rows <b>${DB.page*DB.pageSize+1}</b>–<b>${Math.min((DB.page+1)*DB.pageSize, rows.length)}</b></span>
          <button class="btn sm" data-act="db-page::next">›</button>
          <button class="btn sm" data-act="db-page::last">»</button>
          <select class="fsel" id="db-size">
            ${[25,50,100,250].map(n => `<option value="${n}"${DB.pageSize===n?' selected':''}>${n}/page</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="card-b flush"><div class="tbl-scroll tall">
        <table class="tbl"><thead><tr>${cols.map(c =>
          `<th class="${c[3]==='n'?'n':''}${DB.sort===c[0]?' sorted':''}" data-act="db-sort::${c[0]}">${esc(c[1])}<span class="arrow">${DB.sort===c[0]?(DB.dir<0?'▼':'▲'):'▲'}</span></th>`).join('')}</tr></thead>
        <tbody>${slice.map(t => `<tr class="clickable" data-act="site::${esc(t.id)}">${
          cols.map(c => `<td class="${c[3]}">${c[5](t)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      </div></div>
    </div>
    <p class="muted" style="font-size:11.5px;margin-top:10px;">
      Sort by any column, add or remove columns, then export exactly what you see. The full-field export
      writes every modelled attribute including the per-channel OCR stack.</p>`;

  $$('#colmenu input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {
    const k = cb.dataset.col;
    if (cb.checked){ if (!DB.cols.includes(k)) DB.cols.push(k); }
    else DB.cols = DB.cols.filter(x => x !== k);
    DB.menuOpen = true;
    renderDatabase();
  }));
  $('#colbtn').addEventListener('click', e => { e.stopPropagation(); DB.menuOpen = !DB.menuOpen; renderDatabase(); });
  $('#colmenu').addEventListener('click', e => e.stopPropagation());
  $('#db-size').addEventListener('change', e => { DB.pageSize = +e.target.value; DB.page = 0; renderDatabase(); });
}

function dbExport(which){
  const f = filtered();
  const cols = which === 'all'
    ? DB_COLS.map(c => ({key:c[1], raw:c[4]}))
    : DB.cols.map(colByKey).filter(Boolean).map(c => ({key:c[1], raw:c[4]}));
  downloadCSV(f, cols, `terminals_${which}_${META.snapshot}.csv`);
}
