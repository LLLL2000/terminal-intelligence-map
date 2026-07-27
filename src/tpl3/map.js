/* ============================================================
   map.js — Leaflet map view (lazy-initialised on first visit)
   ============================================================ */
let mapInitialized = false;
let map, markers;

const mapState = {
  vendorFilter: null,
  typeFilter: 'all',
  sourceFilter: 'all',
  search: '',
  showDefunct: false,
  syncFilters: true,
};

function initMap(){
  if (mapInitialized) return;
  mapInitialized = true;
  map = L.map('map', {preferCanvas:true, worldCopyJump:true}).setView([28, 10], 3);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, subdomains:'abcd',
    attribution:'&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(map);

  markers = TERMINALS.map(makeMarker);
  applyMapFilters();

  $$('button.toggle').forEach(b => b.addEventListener('click', () => {
    const isType = b.dataset.type !== undefined;
    $$(isType ? 'button.toggle[data-type]' : 'button.toggle[data-source]')
      .forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    if (isType) mapState.typeFilter = b.dataset.type; else mapState.sourceFilter = b.dataset.source;
    applyMapFilters();
  }));
  $('#map-search').addEventListener('input', e => { mapState.search = e.target.value; applyMapFilters(); });
  $('#show-defunct').addEventListener('change', e => { mapState.showDefunct = e.target.checked; applyMapFilters(); });
  $('#sync-filters').addEventListener('change', e => { mapState.syncFilters = e.target.checked; applyMapFilters(); });

  renderMapSymbolLegend();
}

function markerStyle(t){
  const color = vendorColor(t.vendor);
  const ii = !!t.internet_inferred;
  const conflict = t.status === 'Conflict';
  const indirect = !!t.indirect_via;
  const opacity = ii ? ({high:0.9, medium:0.65, low:0.4}[t.confidence] || 0.6)
                : t.status === 'Inferred' ? 0.55
                : t.status === 'TBD (researched)' ? 0.8 : 0.95;
  const stroke = ii ? '#0892d0' : conflict ? '#c62828' : '#243244';
  const weight = ii ? ({high:2.8, medium:2.2, low:1.8}[t.confidence] || 2)
                : conflict ? 2.6 : indirect ? 1.5 : 1;
  const dash = ii ? (t.confidence === 'low' ? '1,2' : '3,2') : indirect ? '2,2' : null;
  // Radius carries throughput so the map reads as a volume map, not just a dot map.
  const r = 3.4 + Math.min(Math.sqrt(t.volume) / 11, 7.5);
  return {color, opacity, stroke, weight, dash, r};
}

function makeMarker(t){
  const s = markerStyle(t);
  let marker;
  if (t.status === 'Defunct'){
    marker = L.marker([t.lat, t.lon], {icon:L.divIcon({
      html:'<div style="width:13px;height:13px;color:#111;font-weight:700;font-size:13px;line-height:13px;text-align:center;">×</div>',
      className:'', iconSize:[13,13], iconAnchor:[6,6]})});
  } else if (t.type === 'industrial'){
    marker = L.marker([t.lat, t.lon], {icon:L.divIcon({
      html:`<svg width="14" height="14" viewBox="0 0 14 14" style="opacity:${s.opacity};">
        <polygon points="7,1 13,12 1,12" fill="${s.color}" stroke="${s.stroke}" stroke-width="${s.weight}"
          stroke-linejoin="round" ${s.dash?`stroke-dasharray="${s.dash}"`:''}/></svg>`,
      className:'', iconSize:[14,14], iconAnchor:[7,8]})});
  } else if (t.type === 'rail'){
    marker = L.marker([t.lat, t.lon], {icon:L.divIcon({
      html:`<div style="width:11px;height:11px;background:${s.color};opacity:${s.opacity};
        border:${s.weight}px ${s.dash?'dashed':'solid'} ${s.stroke};"></div>`,
      className:'', iconSize:[11,11], iconAnchor:[6,6]})});
  } else {
    marker = L.circleMarker([t.lat, t.lon], {
      radius:s.r, fillColor:s.color, color:s.stroke, weight:s.weight,
      dashArray:s.dash, opacity:0.95, fillOpacity:s.opacity});
  }
  marker.bindPopup(() => popupHtml(t), {maxWidth:340});
  marker.bindTooltip(`${t.id} · ${t.vendor} · ${fmt.compact(t.volume*1000)} moves/yr`,
    {direction:'top', offset:[0,-6]});
  marker._t = t;
  return marker;
}

function popupHtml(t){
  const row = (k, v) => `<span class="k">${k}</span><span class="v">${v}</span>`;
  const chans = (t.ocr_channels||[]).map(c => {
    const v = t.ocr_stack[c].vendor;
    return `<span class="tag${v === t.vendor ? ' on' : ''}">${esc(c)}: ${esc(v)}</span>`;
  }).join('') || '<span class="muted">no attributed channels</span>';
  return `
    <div>
      <div class="pop-h">${esc(t.name)} <span class="muted" style="font-weight:400;">${esc(t.size_class)}</span></div>
      <div class="muted" style="font-size:11px;">${esc(t.segment)} · ${esc(t.region)}</div>
      <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;">
        <span class="pill" style="background:${vendorColor(t.vendor)}22;color:${vendorColor(t.vendor)};border-color:${vendorColor(t.vendor)}55;">${esc(t.vendor)}</span>
        <span class="pill ${t.status==='Confirmed'?'ok':t.status==='Conflict'?'bad':t.status==='Inferred'?'warn':'mute'}">${esc(t.status)}</span>
        ${t.internet_inferred?`<span class="pill info">web-inferred · ${esc(t.confidence)}</span>`:''}
        ${t.multi_vendor?'<span class="pill dark">multi-vendor</span>':''}
      </div>
      <hr>
      <div class="pop-grid">
        ${row('Throughput', fmt.compact(t.volume*1000) + ' <span class="muted">moves/yr</span>')}
        ${row('Operator', esc(t.operator||'—'))}
        ${row('TOS', esc(t.tos))}
        ${row('Automation', esc(t.automation))}
        ${row('OCR accuracy', t.ocr_accuracy!=null?fmt.pct(t.ocr_accuracy):'—')}
        ${row('Truck turn', t.truck_turn_min + ' min')}
        ${row('Licence value', fmt.usd(t.acv_kusd))}
        ${row('Contract end', t.contract_end||'—')}
      </div>
      <div style="margin-top:7px;">${chans}</div>
      <div style="margin-top:8px;"><button class="btn sm" data-act="site::${esc(t.id)}">Open full record</button></div>
    </div>`;
}

function applyMapFilters(){
  const q = mapState.search.toLowerCase();
  const dash = mapState.syncFilters ? new Set(filtered().map(t => t.id)) : null;
  let shown = 0;
  markers.forEach(m => {
    const t = m._t;
    let show = true;
    if (t.status === 'Defunct' && !mapState.showDefunct) show = false;
    else if (dash && !dash.has(t.id)) show = false;
    if (show && mapState.typeFilter !== 'all' && t.type !== mapState.typeFilter) show = false;
    if (show && mapState.sourceFilter === 'inferred' && !t.internet_inferred) show = false;
    if (show && mapState.sourceFilter === 'base' && t.internet_inferred) show = false;
    if (show && mapState.vendorFilter && t.vendor !== mapState.vendorFilter) show = false;
    if (show && q){
      const hay = (t.id+' '+t.operator+' '+t.vendor+' '+t.segment+' '+t.tos).toLowerCase();
      if (!hay.includes(q)) show = false;
    }
    if (show){ shown++; if (!map.hasLayer(m)) m.addTo(map); }
    else if (map.hasLayer(m)) map.removeLayer(m);
  });
  renderMapStats(shown);
  renderMapLegend();
}

function renderMapStats(shown){
  const visible = markers.filter(m => map.hasLayer(m)).map(m => m._t);
  const c = {};
  visible.forEach(t => { c[t.status] = (c[t.status]||0)+1; });
  $('#stats').innerHTML = `
    <div class="stat"><span><b>Visible</b></span><span class="v">${fmt.int(shown)}</span></div>
    ${STATUS_ORDER.filter(s => c[s]).map(s =>
      `<div class="stat indent"><span>${esc(s.replace(' (researched)',''))}</span><span class="v">${c[s]}</span></div>`).join('')}
    <div class="stat"><span>Throughput</span><span class="v">${fmt.compact(sum(visible, t=>t.volume)*1000)}</span></div>
    <div class="stat"><span>Licence value</span><span class="v">${fmt.usd(sum(visible.filter(t=>isNamed(t.vendor)), t=>t.acv_kusd))}</span></div>`;
}

function renderMapLegend(){
  const counts = {};
  markers.forEach(m => { if (map.hasLayer(m)) counts[m._t.vendor] = (counts[m._t.vendor]||0)+1; });
  $('#legend').innerHTML = VENDOR_ORDER
    .filter(v => (counts[v]||0) > 0 || mapState.vendorFilter === v)
    .map(v => `<div class="legend-row ${mapState.vendorFilter && mapState.vendorFilter!==v?'dim':''}" data-vendor="${esc(v)}">
      <span class="swatch" style="background:${vendorColor(v)};"></span>
      <span class="name">${esc(v)}</span><span class="count">${counts[v]||0}</span></div>`).join('');
  $$('#legend .legend-row').forEach(el => el.addEventListener('click', () => {
    const v = el.dataset.vendor;
    mapState.vendorFilter = (mapState.vendorFilter === v) ? null : v;
    applyMapFilters();
  }));
}

function renderMapSymbolLegend(){
  const circle = (fill, op, stroke, dash, r) => `<svg width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="${r||5}" fill="${fill}" fill-opacity="${op}" stroke="${stroke}" stroke-width="1.3"
      ${dash?'stroke-dasharray="2,2"':''}/></svg>`;
  const square = `<svg width="16" height="16" viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10"
    fill="#0b5fff" fill-opacity="0.9" stroke="#243244" stroke-width="1.3"/></svg>`;
  const tri = `<svg width="16" height="16" viewBox="0 0 16 16"><polygon points="8,2 14,13 2,13"
    fill="#0b5fff" fill-opacity="0.9" stroke="#243244" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  const ex = '#0b5fff';
  $('#map-legend-body').innerHTML = `
    <div class="ml-group"><h5>Shape — facility</h5>
      <div class="ml-row">${circle(ex,0.9,'#243244',false)} Marine terminal</div>
      <div class="ml-row">${square} Rail intermodal</div>
      <div class="ml-row">${tri} Industrial site</div>
    </div>
    <div class="ml-group"><h5>Size — throughput</h5>
      <div class="ml-row">${circle(ex,0.9,'#243244',false,3)} under 250k moves/yr</div>
      <div class="ml-row">${circle(ex,0.9,'#243244',false,6)} 1–3M moves/yr</div>
      <div class="ml-row">${circle(ex,0.9,'#243244',false,8)} 6M+ moves/yr</div>
    </div>
    <div class="ml-group"><h5>Fill — attribution status</h5>
      <div class="ml-row">${circle(ex,0.95,'#243244',false)} Confirmed</div>
      <div class="ml-row">${circle(ex,0.55,'#243244',false)} Inferred</div>
      <div class="ml-row">${circle('#c3cad2',0.8,'#243244',false)} Whitespace (TBD)</div>
    </div>
    <div class="ml-group"><h5>Outline</h5>
      <div class="ml-row">${circle(ex,0.9,'#243244',false)} Direct engagement</div>
      <div class="ml-row">${circle(ex,0.9,'#243244',true)} Indirect / reseller channel</div>
      <div class="ml-row">${circle(ex,0.9,'#c62828',false)} Source conflict</div>
      <div class="ml-row">${circle(ex,0.9,'#0892d0',true)} Web-inferred attribution</div>
    </div>`;
}
