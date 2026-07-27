/* ============================================================
   boot.js — routing, event delegation, initial paint
   ============================================================ */
const VIEWS = {
  overview:    renderOverview,
  vendors:     renderVendors,
  technology:  renderTechnology,
  pipeline:    renderPipeline,
  database:    renderDatabase,
  methodology: renderMethodology,
};
const FILTERED_VIEWS = ['overview','vendors','technology','pipeline','database'];
const dirty = new Set(Object.keys(VIEWS));
let currentTab = 'overview';

function showTab(name){
  currentTab = name;
  $$('#topbar .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-' + name).classList.add('active');
  $('#filterbar').style.display = (name === 'methodology') ? 'none' : '';
  if (name === 'map'){
    initMap();
    setTimeout(() => map && map.invalidateSize(), 60);
    applyMapFilters();
    return;
  }
  if (dirty.has(name)){ VIEWS[name](); dirty.delete(name); }
}

function refreshViews(){
  FILTERED_VIEWS.forEach(v => dirty.add(v));
  if (VIEWS[currentTab] && dirty.has(currentTab)){ VIEWS[currentTab](); dirty.delete(currentTab); }
  if (mapInitialized && mapState.syncFilters) applyMapFilters();
}

/* ---------- action dispatch ---------- */
function dispatch(kind, val, ev){
  switch(kind){
    case 'site': {
      const t = TERMINALS.find(x => x.id === val);
      if (t) openDrawer(t);
      return;
    }
    case 'vendor':
      if (CATEGORY_BUCKETS.includes(val) || VENDOR_NAMED.includes(val)){
        STATE.vendor = (STATE.vendor === val) ? 'all' : val;
        invalidate(); renderFilterBar(); emitFilterChange();
      }
      return;
    case 'region':
      if (REGION_ORDER.includes(val)){
        const only = STATE.regions.size === 1 && STATE.regions.has(val);
        STATE.regions = only ? new Set(REGION_ORDER) : new Set([val]);
        invalidate(); renderFilterBar(); emitFilterChange();
      }
      return;
    case 'status': {
      const full = STATUS_ORDER.find(s => s === val || s.replace(' (researched)','') === val);
      if (full){
        const only = STATE.statuses.size === 1 && STATE.statuses.has(full);
        STATE.statuses = only ? new Set(['Confirmed','Inferred','Conflict','TBD (researched)']) : new Set([full]);
        invalidate(); renderFilterBar(); emitFilterChange();
      }
      return;
    }
    case 'ov-share':  OV.shareMode = !OV.shareMode; return renderOverview();
    case 'ov-white':  OV.withWhitespace = !OV.withWhitespace; return renderOverview();
    case 'ov-cum':    OV.adoptionCum = !OV.adoptionCum; return renderOverview();
    case 'ov-top':    OV.topSort = val; return renderOverview();

    case 'ven-sort':  if (VEN.sort === val) VEN.dir *= -1; else { VEN.sort = val; VEN.dir = val === 'key' ? 1 : -1; }
                      return renderVendors();
    case 'ven-pick':  VEN.selected = val; VEN.rival = null; return renderVendors();

    case 'tech-matrix': TECH.matrix = val; return renderTechnology();

    case 'pipe-mode': PIPE.mode = val; return renderPipeline();
    case 'pipe-sort': if (PIPE.sort === val) PIPE.dir *= -1; else { PIPE.sort = val; PIPE.dir = -1; }
                      return renderPipeline();
    case 'pipe-limit': PIPE.limit = PIPE.limit === 40 ? 150 : 40; return renderPipeline();

    case 'db-sort':   if (DB.sort === val) DB.dir *= -1; else { DB.sort = val; DB.dir = -1; }
                      DB.menuOpen = false; return renderDatabase();
    case 'db-page': {
      const pages = Math.max(1, Math.ceil(filtered().length / DB.pageSize));
      DB.page = val === 'first' ? 0 : val === 'last' ? pages-1
              : val === 'prev' ? Math.max(0, DB.page-1) : Math.min(pages-1, DB.page+1);
      DB.menuOpen = false; return renderDatabase();
    }
    case 'db-cols':
      DB.cols = val === 'all' ? DB_COLS.map(c => c[0])
              : val === 'min' ? ['id','region','vendor','volume','acv_kusd']
              : DEFAULT_COLS.slice();
      DB.menuOpen = true; return renderDatabase();
    case 'db-export': return dbExport(val);
  }
}

document.addEventListener('click', ev => {
  const goto = ev.target.closest('[data-goto]');
  if (goto){ ev.preventDefault(); showTab(goto.dataset.goto); return; }
  const el = ev.target.closest('[data-act]');
  if (!el) { if (DB.menuOpen){ DB.menuOpen = false; if (currentTab === 'database') renderDatabase(); } return; }
  const [kind, val] = el.dataset.act.split('::');
  dispatch(kind, val, ev);
});

document.addEventListener('mousemove', ev => {
  const el = ev.target.closest('[data-tip]');
  if (el) TT.show(el.dataset.tip, ev); else TT.hide();
});

/* ---------- filter bar wiring ---------- */
$('#f-vendor').addEventListener('change', e => { STATE.vendor = e.target.value; invalidate(); emitFilterChange(); });
$('#f-size').addEventListener('change',   e => { STATE.size = e.target.value; invalidate(); emitFilterChange(); });
$('#f-metric').addEventListener('change', e => { STATE.metric = e.target.value; emitFilterChange(); });
$('#f-reset').addEventListener('click', resetFilters);
let _searchTimer = null;
$('#f-search').addEventListener('input', e => {
  clearTimeout(_searchTimer);
  const v = e.target.value;
  _searchTimer = setTimeout(() => { STATE.search = v; invalidate(); emitFilterChange(); }, 180);
});

$$('#topbar .tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
$('#drawer-x').addEventListener('click', closeDrawer);
$('#scrim').addEventListener('click', closeDrawer);
$('#disclosure-x').addEventListener('click', () => { $('#disclosure').style.display = 'none'; });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape'){ closeDrawer(); if (DB.menuOpen){ DB.menuOpen = false; if (currentTab==='database') renderDatabase(); } }
});

/* ---------- go ---------- */
$('#meta-snapshot').textContent = META.snapshot;
$('#meta-records').textContent  = fmt.int(META.records);
$('#meta-fields').textContent   = Object.keys(TERMINALS[0]).length;

onFilterChange(refreshViews);
renderFilterBar();
renderFilterSummary();
showTab('overview');
