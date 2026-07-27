/* ============================================================
   charts.js — dependency-free SVG chart primitives.
   Every chart returns an HTML string. Interactivity is delegated:
     data-tip="<html>"      -> shared hover tooltip
     data-act="k:v"         -> click action dispatched by boot.js
   ============================================================ */
const tipAttr = html => `data-tip="${esc(html)}"`;
const actAttr = (kind, val) => `data-act="${esc(kind + '::' + val)}"`;

/* Blend a hex colour toward white; f=0 -> white, f=1 -> the colour itself. */
function tint(hex, f){
  const h = hex.replace('#','');
  const n = parseInt(h.length === 3 ? h.split('').map(c=>c+c).join('') : h, 16);
  const r = (n>>16)&255, g = (n>>8)&255, b = n&255;
  const m = c => Math.round(255 + (c - 255) * f);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

function niceMax(v){
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}
function ticks(max, n){
  const step = max / n, out = [];
  for (let i = 0; i <= n; i++) out.push(step * i);
  return out;
}

/* ---------- sparkline ---------- */
function sparkline(vals, w, h, color){
  if (!vals || vals.length < 2) return '';
  w = w || 90; h = h || 26; color = color || '#0b5fff';
  const min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1;
  const pts = vals.map((v, i) => [i * (w-2) / (vals.length-1) + 1, h - 2 - ((v - min) / span) * (h - 5)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const area = d + ` L${pts[pts.length-1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`;
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="width:${w}px;height:${h}px;">
    <path d="${area}" fill="${color}" opacity="0.10"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${pts[pts.length-1][0].toFixed(1)}" cy="${pts[pts.length-1][1].toFixed(1)}" r="2" fill="${color}"/>
  </svg>`;
}

/* ---------- horizontal bars ---------- */
function hbars(items, o){
  o = Object.assign({w:560, rowH:22, labelW:150, valueW:74, fmt:fmt.int, act:null, max:null}, o||{});
  if (!items.length) return '<div class="empty">No data for this selection.</div>';
  const max = o.max || niceMax(Math.max(...items.map(i => i.value)));
  const h = items.length * o.rowH + 8;
  const bw = o.w - o.labelW - o.valueW - 8;
  const rows = items.map((it, i) => {
    const y = i * o.rowH + 4;
    const len = max ? Math.max((it.value / max) * bw, it.value > 0 ? 1.5 : 0) : 0;
    const act = o.act ? actAttr(o.act, it.key != null ? it.key : it.label) : '';
    return `<g class="seg" ${tipAttr(it.tip || `<b>${esc(it.label)}</b><br>${o.fmt(it.value)}`)} ${act}>
      <rect x="0" y="${y}" width="${o.w}" height="${o.rowH-2}" fill="transparent"/>
      <text class="ax-lab" x="${o.labelW-8}" y="${y + o.rowH/2}" text-anchor="end" dominant-baseline="middle"
        style="fill:var(--ink-2);font-size:11px;">${esc(it.label)}</text>
      <rect x="${o.labelW}" y="${y+3}" width="${len.toFixed(1)}" height="${o.rowH-9}" rx="2" fill="${it.color||'#0b5fff'}"/>
      <text class="val-lab" x="${o.labelW + bw + 8}" y="${y + o.rowH/2}" text-anchor="end"
        dominant-baseline="middle">${o.fmt(it.value)}</text>
    </g>`;
  }).join('');
  return `<div class="chartwrap"><svg viewBox="0 0 ${o.w} ${h}">${rows}</svg></div>`;
}

/* ---------- stacked horizontal rows ---------- */
function stackedRows(rows, o){
  o = Object.assign({w:560, rowH:30, labelW:120, valueW:70, fmt:fmt.int, act:null, shareMode:false}, o||{});
  if (!rows.length) return '<div class="empty">No data for this selection.</div>';
  const max = o.shareMode ? 1 : niceMax(Math.max(...rows.map(r => r.total)));
  const bw = o.w - o.labelW - o.valueW - 8;
  const h = rows.length * o.rowH + 6;
  const body = rows.map((r, i) => {
    const y = i * o.rowH + 3;
    let x = o.labelW;
    const denom = o.shareMode ? (r.total || 1) : max;
    const segs = r.parts.filter(p => p.value > 0).map(p => {
      const len = (p.value / denom) * bw;
      const act = o.act ? actAttr(o.act, p.key) : '';
      const share = r.total ? (100 * p.value / r.total) : 0;
      const s = `<rect class="seg" x="${x.toFixed(1)}" y="${y+4}" width="${Math.max(len,0.6).toFixed(1)}"
        height="${o.rowH-13}" fill="${p.color}" ${act}
        ${tipAttr(`<b>${esc(p.key)}</b><br><span class="tk">${esc(r.label)}</span><br>${o.fmt(p.value)} · ${fmt.pct(share)} of row`)}/>`;
      x += len;
      return s;
    }).join('');
    return `<g>
      <text x="${o.labelW-8}" y="${y + o.rowH/2}" text-anchor="end" dominant-baseline="middle"
        style="fill:var(--ink-2);font-size:11px;">${esc(r.label)}</text>
      <rect x="${o.labelW}" y="${y+4}" width="${bw}" height="${o.rowH-13}" fill="#f1f4f7" rx="2"/>
      ${segs}
      <text class="val-lab" x="${o.w - 4}" y="${y + o.rowH/2}" text-anchor="end"
        dominant-baseline="middle">${o.fmt(r.total)}</text>
    </g>`;
  }).join('');
  return `<div class="chartwrap"><svg viewBox="0 0 ${o.w} ${h}">${body}</svg></div>`;
}

/* ---------- vertical columns (optionally stacked) ---------- */
function columns(categories, series, o){
  o = Object.assign({w:560, h:210, padL:44, padB:26, padT:10, fmt:fmt.int, act:null,
                     axisFmt:fmt.compact, rotate:false, highlight:null}, o||{});
  if (!categories.length) return '<div class="empty">No data for this selection.</div>';
  const totals = categories.map((_, i) => series.reduce((a, s) => a + (s.values[i]||0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const plotW = o.w - o.padL - 8, plotH = o.h - o.padB - o.padT;
  const step = plotW / categories.length, bw = Math.min(step * 0.68, 42);
  const gl = ticks(max, 4).map(v => {
    const y = o.padT + plotH - (v/max)*plotH;
    return `<line class="grid-line" x1="${o.padL}" y1="${y.toFixed(1)}" x2="${o.w-8}" y2="${y.toFixed(1)}"/>
            <text class="ax-lab" x="${o.padL-6}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle">${o.axisFmt(v)}</text>`;
  }).join('');
  const bars = categories.map((c, i) => {
    const cx = o.padL + step*i + step/2;
    let y = o.padT + plotH;
    const stack = series.map(s => {
      const v = s.values[i] || 0;
      if (!v) return '';
      const hh = (v/max)*plotH;
      y -= hh;
      const act = o.act ? actAttr(o.act, s.key) : '';
      return `<rect class="seg" x="${(cx-bw/2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}"
        height="${Math.max(hh,0.7).toFixed(1)}" fill="${s.color}" ${act}
        ${tipAttr(`<b>${esc(s.key)}</b><br><span class="tk">${esc(c)}</span><br>${o.fmt(v)}`)}/>`;
    }).join('');
    const dim = o.highlight && o.highlight !== c ? ' opacity="0.45"' : '';
    const lab = `<text class="ax-lab" x="${cx.toFixed(1)}" y="${o.padT+plotH+13}" text-anchor="${o.rotate?'end':'middle'}"
      ${o.rotate?`transform="rotate(-40 ${cx.toFixed(1)} ${o.padT+plotH+13})"`:''}>${esc(c)}</text>`;
    return `<g${dim}>${stack}${lab}</g>`;
  }).join('');
  return `<div class="chartwrap"><svg viewBox="0 0 ${o.w} ${o.h}">
    ${gl}<line class="ax-line" x1="${o.padL}" y1="${o.padT+plotH}" x2="${o.w-8}" y2="${o.padT+plotH}"/>${bars}
  </svg></div>`;
}

/* ---------- donut ---------- */
function donut(items, o){
  o = Object.assign({size:170, thickness:26, fmt:fmt.int, centerLabel:'', centerSub:'', act:null}, o||{});
  const total = items.reduce((a, i) => a + i.value, 0);
  if (!total) return '<div class="empty">No data for this selection.</div>';
  const r = o.size/2 - 4, ir = r - o.thickness, cx = o.size/2, cy = o.size/2;
  let a0 = -Math.PI/2;
  const arcs = items.filter(i => i.value > 0).map(i => {
    const a1 = a0 + (i.value/total) * Math.PI * 2;
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const p = (ang, rad) => [(cx + Math.cos(ang)*rad).toFixed(2), (cy + Math.sin(ang)*rad).toFixed(2)];
    const [x0,y0] = p(a0,r), [x1,y1] = p(a1,r), [x2,y2] = p(a1,ir), [x3,y3] = p(a0,ir);
    const d = `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${ir},${ir} 0 ${large} 0 ${x3},${y3} Z`;
    a0 = a1;
    const act = o.act ? actAttr(o.act, i.key != null ? i.key : i.label) : '';
    return `<path class="seg" d="${d}" fill="${i.color}" ${act}
      ${tipAttr(`<b>${esc(i.label)}</b><br>${o.fmt(i.value)} · ${fmt.pct(100*i.value/total)}`)}/>`;
  }).join('');
  return `<div class="chartwrap" style="max-width:${o.size}px;margin:0 auto;">
    <svg viewBox="0 0 ${o.size} ${o.size}">${arcs}
      <text x="${cx}" y="${cy-3}" text-anchor="middle" style="font-size:19px;font-weight:650;fill:var(--ink);">${esc(o.centerLabel)}</text>
      <text x="${cx}" y="${cy+13}" text-anchor="middle" class="ax-lab">${esc(o.centerSub)}</text>
    </svg></div>`;
}

/* ---------- scatter ---------- */
function scatter(pts, o){
  o = Object.assign({w:560, h:300, padL:48, padB:34, padT:12, padR:12,
                     xLabel:'', yLabel:'', xFmt:fmt.compact, yFmt:fmt.compact,
                     xLog:false, act:null}, o||{});
  if (!pts.length) return '<div class="empty">No data for this selection.</div>';
  const tx = v => o.xLog ? Math.log10(Math.max(v, 0.5)) : v;
  const xs = pts.map(p => tx(p.x)), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const xr = (x1 - x0) || 1, yr = (y1 - y0) || 1;
  const plotW = o.w - o.padL - o.padR, plotH = o.h - o.padT - o.padB;
  const px = v => o.padL + ((tx(v) - x0)/xr) * plotW;
  const py = v => o.padT + plotH - ((v - y0)/yr) * plotH;
  const rmax = Math.max(...pts.map(p => p.r || 1));
  const grid = [0,.25,.5,.75,1].map(f => {
    const y = o.padT + plotH - f*plotH, v = y0 + f*yr;
    return `<line class="grid-line" x1="${o.padL}" y1="${y.toFixed(1)}" x2="${o.w-o.padR}" y2="${y.toFixed(1)}"/>
            <text class="ax-lab" x="${o.padL-6}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle">${o.yFmt(v)}</text>`;
  }).join('');
  const xticks = [0,.25,.5,.75,1].map(f => {
    const xv = x0 + f*xr, x = o.padL + f*plotW;
    const real = o.xLog ? Math.pow(10, xv) : xv;
    return `<text class="ax-lab" x="${x.toFixed(1)}" y="${o.padT+plotH+15}" text-anchor="middle">${o.xFmt(real)}</text>`;
  }).join('');
  const dots = pts.map(p => {
    const rr = 2.4 + 5.6 * Math.sqrt((p.r||1)/rmax);
    const act = o.act ? actAttr(o.act, p.id) : '';
    return `<circle class="seg" cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="${rr.toFixed(1)}"
      fill="${p.color}" fill-opacity="0.62" stroke="${p.color}" stroke-width="0.8" ${act}
      ${tipAttr(p.tip)}/>`;
  }).join('');
  return `<div class="chartwrap"><svg viewBox="0 0 ${o.w} ${o.h}">
    ${grid}${xticks}
    <line class="ax-line" x1="${o.padL}" y1="${o.padT+plotH}" x2="${o.w-o.padR}" y2="${o.padT+plotH}"/>
    ${dots}
    <text class="ax-lab" x="${o.padL+plotW/2}" y="${o.h-3}" text-anchor="middle">${esc(o.xLabel)}</text>
    <text class="ax-lab" x="${-(o.padT+plotH/2)}" y="11" text-anchor="middle" transform="rotate(-90)">${esc(o.yLabel)}</text>
  </svg></div>`;
}

/* ---------- histogram ---------- */
function histogram(values, o){
  o = Object.assign({w:560, h:180, bins:18, color:'#0b5fff', xLabel:'', fmt:fmt.d1}, o||{});
  const v = values.filter(x => x != null && !isNaN(x));
  if (v.length < 2) return '<div class="empty">Not enough data.</div>';
  const min = Math.min(...v), max = Math.max(...v), span = (max-min) || 1;
  const counts = new Array(o.bins).fill(0);
  v.forEach(x => { counts[Math.min(o.bins-1, Math.floor((x-min)/span*o.bins))]++; });
  const cats = counts.map((_, i) => (min + span*(i+0.5)/o.bins));
  const series = [{key:'sites', color:o.color, values:counts}];
  const labs = cats.map((c, i) => (i % 3 === 0 ? o.fmt(c) : ''));
  return columns(labs, series, {w:o.w, h:o.h, fmt:fmt.int, axisFmt:fmt.compact});
}

/* ---------- heat matrix ---------- */
function heatmap(rowLabels, colLabels, get, o){
  o = Object.assign({cell:38, labelW:132, fmt:fmt.int, hue:'#0b5fff', act:null}, o||{});
  if (!rowLabels.length) return '<div class="empty">No data for this selection.</div>';
  let max = 0;
  rowLabels.forEach(r => colLabels.forEach(c => { max = Math.max(max, get(r,c).value || 0); }));
  max = max || 1;
  const head = `<tr><th class="nosort"></th>${colLabels.map(c => `<th class="nosort" style="text-align:center;">${esc(c)}</th>`).join('')}</tr>`;
  const body = rowLabels.map(r => {
    const cells = colLabels.map(c => {
      const d = get(r, c), f = (d.value||0)/max;
      const bg = tint(o.hue, 0.06 + f * 0.88);
      const fg = f > 0.55 ? '#fff' : 'var(--ink)';
      const act = o.act ? actAttr(o.act, r) : '';
      return `<td class="cell" style="background:${bg};color:${fg};" ${act}
        ${tipAttr(d.tip || `<b>${esc(r)}</b> × <b>${esc(c)}</b><br>${o.fmt(d.value)}`)}>${d.value ? o.fmt(d.value) : ''}</td>`;
    }).join('');
    return `<tr><td style="font-size:11px;color:var(--ink-2);white-space:nowrap;">${esc(r)}</td>${cells}</tr>`;
  }).join('');
  return `<div class="tbl-scroll tall"><table class="tbl matrix"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/* ---------- funnel ---------- */
function funnel(items, o){
  o = Object.assign({w:520, rowH:36, fmt:fmt.int}, o||{});
  if (!items.length) return '<div class="empty">No data for this selection.</div>';
  const max = Math.max(...items.map(i => i.value)) || 1;
  const h = items.length * o.rowH + 6;
  const body = items.map((it, i) => {
    const y = i*o.rowH + 4, w = Math.max((it.value/max) * (o.w - 200), 2);
    const x = 150;
    return `<g class="seg" ${tipAttr(`<b>${esc(it.label)}</b><br>${o.fmt(it.value)}${it.sub?'<br><span class="tk">'+esc(it.sub)+'</span>':''}`)}>
      <text x="${x-10}" y="${y+o.rowH/2}" text-anchor="end" dominant-baseline="middle"
        style="font-size:11.5px;fill:var(--ink-2);">${esc(it.label)}</text>
      <rect x="${x}" y="${y+3}" width="${w.toFixed(1)}" height="${o.rowH-10}" rx="3" fill="${it.color}"/>
      <text class="val-lab" x="${x + w + 8}" y="${y+o.rowH/2}" dominant-baseline="middle">${o.fmt(it.value)}</text>
    </g>`;
  }).join('');
  return `<div class="chartwrap"><svg viewBox="0 0 ${o.w} ${h}">${body}</svg></div>`;
}

/* ---------- legend ---------- */
function chartLegend(items, act){
  return `<div class="legend">` + items.map(i =>
    `<span class="li" ${act ? actAttr(act, i.key != null ? i.key : i.label) : ''}>
      <span class="sw" style="background:${i.color}"></span>${esc(i.label)}
      ${i.count != null ? `<span class="cnt">${fmt.int(i.count)}</span>` : ''}</span>`).join('') + `</div>`;
}
