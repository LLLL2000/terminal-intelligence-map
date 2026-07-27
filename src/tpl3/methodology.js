/* ============================================================
   methodology.js — what is real, what is modelled, and how it is built
   ============================================================ */
const FIELD_DOC = [
  ['Identity', [
    ['id / name', 'observed', 'Stable synthetic key. Real site and port names are removed entirely.'],
    ['lat / lon', 'observed', 'Real coordinates of public container terminals, rail intermodal yards and industrial sites.'],
    ['region / segment / type', 'observed', 'Geographic and facility classification derived from the coordinates.'],
    ['operator', 'anonymised', 'Real operators collapsed to "Company N"; the grouping is preserved so multi-site operators stay linked.'],
  ]],
  ['Attribution', [
    ['vendor', 'anonymised', 'Real vendor buckets collapsed to "Company N" in a stable order.'],
    ['status', 'observed', 'Confirmed / Inferred / Conflict / TBD, carried through from the source classification.'],
    ['confidence_score, data_completeness, last_verified, freshness', 'modelled', 'Record-quality scores generated from the site seed.'],
  ]],
  ['Capacity &amp; equipment', [
    ['volume, vol_history, cagr_3y', 'modelled', 'Log-normal draw with regional priors; history back-cast from the site growth rate.'],
    ['berths, quay_m, depth_m, yard_ha', 'modelled', 'Derived from volume so plant size stays consistent with throughput.'],
    ['sts_cranes, yard_cranes, reach_stackers, gate_lanes, reefer_plugs', 'modelled', 'Equipment counts scaled off throughput with bounded noise.'],
  ]],
  ['OCR stack', [
    ['ocr_stack (Gate / Crane / Rail / Yard)', 'modelled', 'Per-channel vendor and install year. Channels are drawn independently, which is what produces multi-vendor sites.'],
    ['channel_count, multi_vendor', 'modelled', 'Rolled up from the stack.'],
  ]],
  ['Systems &amp; performance', [
    ['tos, integration, hosting, automation', 'modelled', 'Categorical draws weighted by site size, region and upgrade recency.'],
    ['ocr_accuracy, uptime_pct, truck_turn_min, gate_moves_hr', 'modelled', 'Correlated with vendor tier, upgrade year and gate automation.'],
  ]],
  ['Commercial', [
    ['acv_kusd, tam_kusd', 'modelled', 'Sized from throughput, channel breadth and sales channel.'],
    ['install_year, last_upgrade_year, contract_years, contract_end', 'modelled', 'Lifecycle chain; contract end is rolled forward to a future term.'],
    ['displacement_risk', 'modelled', 'Composite of contract proximity, performance gap, integration depth, support tier and upgrade age.'],
    ['deal_stage', 'modelled', 'Whitespace only — qualification stage for the pipeline funnel.'],
  ]],
];

function renderMethodology(){
  const f = TERMINALS;
  const byRegion = REGION_ORDER.map(r => ({r, n: f.filter(t => t.region === r).length})).filter(x => x.n);
  const vendorRows = VENDOR_ORDER.filter(v => f.some(t => t.vendor === v)).map(v => {
    const n = f.filter(t => t.vendor === v).length;
    const p = VENDOR_PROFILES[v];
    return `<tr>
      <td><span class="sw" style="background:${vendorColor(v)}"></span>${esc(v)}</td>
      <td class="n">${fmt.int(n)}</td>
      <td>${p ? esc(p.archetype) : '<span class="muted">' + esc(CATEGORY_DESC[v] || '') + '</span>'}</td>
      <td>${p ? esc(p.positioning) : ''}</td></tr>`;
  }).join('');

  $('#meth-root').innerHTML = `
    <h1 style="font-size:21px;margin-bottom:4px;">Methodology</h1>
    <p class="muted" style="margin-top:0;">Snapshot ${esc(META.snapshot)} · ${fmt.int(META.records)} terminals ·
      ${fmt.int(META.vendor_count)} vendor buckets · ${fmt.int(META.operator_count)} operator groups.</p>

    <div class="callout" style="margin:16px 0;">
      <b>Read this first.</b> This is a public, de-identified derivative of a private market map.
      Two different things are going on in the same file:
      <ul>
        <li><b>Geography and structure are real.</b> Coordinates point at genuine container terminals,
          rail intermodal yards and industrial sites. The facility taxonomy, the region split and the
          Confirmed / Inferred / Conflict / TBD attribution grading come from the underlying research.</li>
        <li><b>Identities are removed and attributes are modelled.</b> Every company, operator and site name
          is replaced by a generic identifier. Every operational, contractual and commercial attribute —
          throughput, equipment, accuracy, contract dates, licence value, risk scores — is
          <b>generated</b>, not measured.</li>
      </ul>
      Nothing here should be quoted as a fact about any real port, operator or vendor. What it does
      demonstrate is the data model and the analysis it supports.
    </div>

    <h2>Why the attributes are synthetic</h2>
    <p>The private version of this map holds one attributed field per site: which vendor's system is
    installed. That is enough to draw a footprint map, and not much else. This public build asks a
    different question — <i>what would a complete per-terminal intelligence record look like, and what
    analysis would it unlock?</i> — so it carries the full field set and fills it from a model.</p>
    <p>The generator is deterministic: every value is a hash of the site id and the field name, so the
    dataset is reproducible, diffable across builds, and internally consistent. Crane counts follow
    throughput. Truck turn time follows gate automation. Licence value follows size and channel breadth.
    Displacement risk is a real formula over the other fields, not an independent random number. The
    distributions are plausible; the individual values are fiction.</p>

    <h2>Anonymisation</h2>
    <ul>
      <li>Vendor buckets map to <code>Company 1…N</code> in a stable order; three non-company buckets
        (in-house, whitespace, defunct) keep neutral category labels.</li>
      <li>Operators continue the same identifier pool, so an operator running several terminals still
        shows up as one entity — the grouping survives, the identity does not.</li>
      <li>Site names become <code>Site &lt;id&gt;</code>. Port, city and state text is dropped, along with
        every source reference, evidence string, URL and free-text note.</li>
      <li>Coordinates are kept unmodified. Geography is public information and removing it would make
        the map meaningless.</li>
    </ul>

    <h2>Coverage</h2>
    <div class="grid g2" style="margin:10px 0 18px 0;">
      <div class="card"><div class="card-b">
        ${hbars(byRegion.map(x => ({label:x.r, value:x.n, color:regionColor(x.r)})), {w:480, labelW:120, fmt:fmt.int})}
      </div></div>
      <div class="card"><div class="card-b">
        <dl class="deflist">
          <dt>Base universe</dt><dd>${fmt.int(META.records - META.added_locations)} sites carried from the private map</dd>
          <dt>Added locations</dt><dd>${fmt.int(META.added_locations)} public terminals, de-duplicated within 8 km</dd>
          <dt>Fields per record</dt><dd>${Object.keys(TERMINALS[0]).length}</dd>
          <dt>Attributed sites</dt><dd>${fmt.int(TERMINALS.filter(t => isNamed(t.vendor)).length)}</dd>
          <dt>Whitespace</dt><dd>${fmt.int(TERMINALS.filter(isWhitespace).length)}</dd>
          <dt>Multi-vendor sites</dt><dd>${fmt.int(TERMINALS.filter(t => t.multi_vendor).length)}</dd>
        </dl>
      </div></div>
    </div>

    <h2>Field provenance</h2>
    <p>Every field is tagged with where it comes from: <span class="pill ok">observed</span> carried from
    the source data, <span class="pill info">anonymised</span> real value replaced by a stable identifier,
    <span class="pill warn">modelled</span> generated by the attribute model.</p>
    <table class="tbl fieldtable" style="margin-top:8px;">
      <thead><tr><th class="nosort">Field</th><th class="nosort">Provenance</th><th class="nosort">Notes</th></tr></thead>
      <tbody>${FIELD_DOC.map(([grp, rows]) =>
        `<tr><td colspan="3" style="background:var(--panel-2);font-weight:650;font-family:inherit;">${grp}</td></tr>` +
        rows.map(([k, prov, note]) => `<tr>
          <td>${k}</td>
          <td><span class="pill ${prov==='observed'?'ok':prov==='anonymised'?'info':'warn'}">${prov}</span></td>
          <td style="color:var(--ink-2);">${note}</td></tr>`).join('')).join('')}
      </tbody></table>

    <h2>Vendor taxonomy</h2>
    <table class="tbl" style="margin-top:8px;">
      <thead><tr><th class="nosort">Bucket</th><th class="n nosort">Sites</th>
        <th class="nosort">Archetype</th><th class="nosort">Modelled positioning</th></tr></thead>
      <tbody>${vendorRows}</tbody></table>

    <h2>Definitions</h2>
    <ul>
      <li><b>Throughput</b> — annual container moves in thousands, TEU-equivalent. Marine sites are sized
        in TEU, rail in lifts, industrial in gate moves; the dashboard sums them as a single
        moves-equivalent so cross-facility totals stay comparable. Treat mixed-type totals as indicative.</li>
      <li><b>OCR channel</b> — an independently procured recognition point: gate, crane (quay/ship-to-shore),
        rail, or yard/UTR. A site can run different vendors on different channels; that is what
        <b>multi-vendor</b> flags.</li>
      <li><b>ACV</b> — modelled annual licence and maintenance value per site, in USD thousands.</li>
      <li><b>Displacement risk</b> — 0–100 composite: contract proximity, read-accuracy gap versus peers,
        integration depth, support tier, and years since the last upgrade.</li>
      <li><b>Opportunity score</b> (Pipeline tab) — deal value × probability × timing, so whitespace wins and
        incumbent displacements can be ranked on one axis.</li>
      <li><b>HHI</b> — Herfindahl index over attributed vendors only, on the currently selected metric.
        Whitespace is excluded because an unattributed site says nothing about concentration.</li>
    </ul>

    <h2>Build</h2>
    <p>The output is a single self-contained HTML file. The only external dependency is Leaflet plus a
    CARTO basemap for the map tab; every chart is hand-rolled SVG with no charting library. The build
    script anonymises, extends, enriches, then assembles the page from templates — so no prose from the
    private source can survive into the public file by accident.</p>
    <p class="muted" style="font-size:11.5px;">Use the Database tab to export any slice as CSV, including
    the full field set.</p>`;
}
