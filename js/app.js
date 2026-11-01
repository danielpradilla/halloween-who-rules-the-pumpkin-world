// Who Rules the Pumpkin World? Renders every chart and sentence from one static JSON file.

const SVGNS = 'http://www.w3.org/2000/svg';
const main = document.getElementById('story');
const sig = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 });
const whole = new Intl.NumberFormat('en');
const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const FLAGS = { A: 'official figure', E: 'estimated value', I: 'imputed value', X: 'figure from an external organization' };

const fmtT = (t) => `${sig.format(t)} t`;
const fmtUsd = (v) => `$${sig.format(v)}`;
const pct = (s) => (s == null ? '—' : s > 0 && s < 0.001 ? '<0.1%' : `${(s * 100).toFixed(1)}%`);
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const pShare = (c) => c.production?.share ?? null;
const eShare = (c) => c.exports?.share ?? null;
const sumOrNull = (vals) => (vals.some((v) => v == null) ? null : vals.reduce((a, b) => a + b, 0));
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

function svgEl(tag, attrs = {}, text) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

function makeSvg(width, height, label) {
  return svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': label });
}

// Which side of the paradox a country sits on. Missing data is its own class, never zero.
function side(c) {
  if (pShare(c) == null || eShare(c) == null) return 'missing';
  return pShare(c) > eShare(c) ? 'grow' : 'sell';
}

/* ---------- Loading, empty and error states ---------- */

function setState(message, isError) {
  document.querySelectorAll('[data-state="loading"]').forEach((host) => {
    host.innerHTML = `<p class="state${isError ? ' error' : ''}">${message}</p>`;
    host.dataset.state = isError ? 'error' : 'empty';
  });
  document.getElementById('lede').innerHTML = message;
  document.getElementById('country-card').innerHTML = `<p class="state${isError ? ' error' : ''}">${message}</p>`;
}

async function load() {
  try {
    const res = await fetch(main.dataset.src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.countries?.length) {
      setState('The data file contains no countries.', true);
      return;
    }
    render(data);
  } catch (err) {
    setState(`The figures could not be loaded (${esc(err.message)}). Reload the page, or open <a href="${esc(main.dataset.src)}">the data file</a> directly.`, true);
  }
}

/* ---------- Text facts ---------- */

function fillFacts(data, ctx) {
  const t = data.totals;
  const dates = Object.values(data.retrieved).sort();
  const day = (d) => longDate.format(new Date(`${d}T00:00:00Z`));
  const retrieved = dates[0] === dates.at(-1) ? day(dates[0]) : `${day(dates[0])} to ${day(dates.at(-1))}`;
  const gap = t.worldProductionT - t.countryProductionSumT;
  const unreported = t.largestUnreportedByMirror[0];
  const facts = {
    year: data.referenceYear,
    nextYear: data.referenceYear + 1,
    worldT: `${whole.format(Math.round(t.worldProductionT))} tonnes`,
    countrySumT: `${whole.format(Math.round(t.countryProductionSumT))} tonnes`,
    gapT: `${whole.format(Math.round(gap))} tonnes (${pct(gap / t.worldProductionT)})`,
    producingCountries: t.producingCountries,
    exportReporters: t.exportReporters,
    exportTotal: `US$${(t.reportedExportsUsd / 1e9).toFixed(2)} billion`,
    flagA: t.productionFlags.A,
    flagE: t.productionFlags.E,
    flagI: t.productionFlags.I,
    clsH6: `${t.exportClassifications.H6 ?? 0} reporters`,
    clsH5: t.exportClassifications.H5 ?? 0,
    clsH4: t.exportClassifications.H4 ?? 0,
    faoUpdated: day(data.sources.production.datasetUpdated),
    retrieved,
    productionMissing: t.productionMissing.length ? andList(t.productionMissing) : 'no country',
    unreported1: unreported ? `${unreported.name} (${fmtUsd(unreported.mirrorImportsUsd)})` : 'none',
    tenthExport: fmtUsd(t.tenthExportUsd),
    unreportedProducers: andList(ctx.producers.slice(0, 20).filter((c) => !c.exports).map((c) => c.name)) || 'no country',
    coverageVerdict: !unreported || unreported.mirrorImportsUsd < t.tenthExportUsd
      ? 'so partner data do not suggest that any non-reporter belongs in the top 10'
      : 'so at least one non-reporter may belong in the top 10',
  };
  document.querySelectorAll('[data-fact]').forEach((node) => {
    if (node.dataset.fact in facts) node.textContent = facts[node.dataset.fact];
  });

  const { p1, p2, e1, e2, year } = ctx;
  const growExp = sumOrNull([eShare(p1), eShare(p2)]);
  document.getElementById('lede').innerHTML =
    `In ${year}, <span class="grow">${esc(p1.name)} and ${esc(p2.name)}</span> grew ${pct(pShare(p1) + pShare(p2))} of the world’s pumpkins, squash and gourds, ` +
    `and accounted for ${growExp == null ? 'an unreported share' : pct(growExp)} of reported export value. ` +
    `<span class="sell">${esc(e1.name)} and ${esc(e2.name)}</span> grew ${pct(sumOrNull([pShare(e1), pShare(e2)]))} and sold ${pct(eShare(e1) + eShare(e2))}.`;

  const exportRankText = (c) => (c.exports ? ordinal(c.exports.rank) : 'nowhere (no export report)');
  const prodRankText = (c) => (c.production ? ordinal(c.production.rank) : 'nowhere (no FAOSTAT figure)');
  document.getElementById('growers-copy').innerHTML =
    `FAOSTAT records ${t.producingCountries} countries and territories growing pumpkins, squash and gourds in ${year}: ${sig.format(t.worldProductionT)} tonnes in all. ` +
    `<b>${esc(p1.name)}</b> and <b>${esc(p2.name)}</b> grew ${pct(pShare(p1) + pShare(p2))} of it between them. ` +
    `The top exporter, ${esc(e1.name)}, ranks ${prodRankText(e1)} here; the second, ${esc(e2.name)}, ranks ${prodRankText(e2)}.`;
  document.getElementById('exporters-copy').innerHTML =
    `${t.exportReporters} countries and territories declared ${facts.exportTotal} of fresh pumpkin, squash and gourd exports in ${year}. ` +
    `<b>${esc(e1.name)}</b> and <b>${esc(e2.name)}</b> shipped ${pct(eShare(e1) + eShare(e2))} of it. ` +
    `The top grower, ${esc(p1.name)}, ranks ${exportRankText(p1)} here; the second, ${esc(p2.name)}, ranks ${exportRankText(p2)}.`;
  document.getElementById('paradox-copy').innerHTML =
    'Each line joins a country’s rank as a grower (left) to its rank as an exporter (right). A falling line means the country ranks higher as a grower than as an exporter; a rising line, the reverse. ' +
    'Switch to <b>Shares</b> to put both measures on one percentage scale. Pick any country for its numbers.';

  const overlap = ctx.topP.filter((c) => ctx.topE.includes(c));
  const ratioText = (c) => (c.exportWeightToProduction == null ? null : `${esc(c.name)} ${c.exportWeightToProduction < 0.001 ? 'under 0.1%' : pct(c.exportWeightToProduction)}`);
  const ratios = [e1, e2, p1, p2].map(ratioText).filter(Boolean);
  const buyerText = (c) => {
    if (!c.topBuyers?.length || !c.mirrorImportsUsd) return null;
    const share = c.topBuyers.reduce((a, b) => a + b.usd, 0) / c.mirrorImportsUsd;
    return `<li>${esc(c.name)}’s largest buyers, by their own import declarations: ${andList(c.topBuyers.map((b) => esc(b.name)))}, together ${pct(share)} of all imports declared from ${esc(c.name)}.</li>`;
  };
  const imp = t.topImporters[0];
  document.getElementById('facts-list').innerHTML = [
    `<li>${esc(p1.name)} and ${esc(p2.name)}: ${pct(pShare(p1) + pShare(p2))} of world production, ${growExp == null ? 'exports not fully reported' : `${pct(growExp)} of reported exports`}.</li>`,
    `<li>${esc(e1.name)} and ${esc(e2.name)}: ${pct(eShare(e1) + eShare(e2))} of reported exports, ${pct(sumOrNull([pShare(e1), pShare(e2)]))} of world production.</li>`,
    `<li>Countries in both top 10s: ${andList(overlap.map((c) => esc(c.name)))} (${overlap.length}).</li>`,
    ratios.length ? `<li>Exported weight as a share of production weight (approximate): ${ratios.join('; ')}.</li>` : '',
    buyerText(e1) ?? '',
    buyerText(e2) ?? '',
    imp ? `<li>The largest importer, ${esc(imp.name)}, declared ${fmtUsd(imp.usd)} of imports: ${pct(imp.usd / t.importsDeclaredUsd)} of all declared imports.</li>` : '',
  ].join('');
}

/* ---------- Opening: share split ---------- */

function renderSplit(ctx) {
  const host = document.getElementById('split');
  const picks = [...new Set([ctx.p1, ctx.p2, ctx.e1, ctx.e2])];
  const colors = ['var(--pumpkin)', 'var(--pumpkin-2)', 'var(--charcoal)', 'var(--charcoal-2)'];
  const rows = [
    { label: 'Share of world production', total: `${sig.format(ctx.data.totals.worldProductionT)} t`, get: pShare },
    { label: 'Share of reported world exports', total: fmtUsd(ctx.data.totals.reportedExportsUsd), get: eShare },
  ];
  host.innerHTML = '';
  host.classList.add('reveal');
  for (const row of rows) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="split-row-label"><b>${row.label}</b><span>${row.total}</span></div>`;
    const bar = document.createElement('div');
    bar.className = 'split-bar';
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${row.label}: ${picks.map((c) => `${c.name} ${pct(row.get(c))}`).join(', ')}, all other countries ${pct(1 - sumOrNull(picks.map(row.get)))}`);
    let used = 0;
    picks.forEach((c, i) => {
      const share = row.get(c);
      if (share == null) return; // unreported: no segment rather than a zero-width guess
      used += share;
      const seg = document.createElement('span');
      seg.className = 'split-seg';
      seg.style.cssText = `width:${share * 100}%;background:${colors[i]};color:${i < 2 ? 'var(--ink)' : '#fff'};--i:${i}`;
      seg.title = `${c.name}: ${pct(share)}`;
      if (share >= 0.09) seg.textContent = pct(share);
      bar.append(seg);
    });
    const rest = document.createElement('span');
    rest.className = 'split-seg rest';
    rest.style.cssText = `width:${(1 - used) * 100}%;--i:${picks.length}`;
    rest.title = `All other countries: ${pct(1 - used)}`;
    rest.textContent = 1 - used >= 0.12 ? `Others ${pct(1 - used)}` : '';
    bar.append(rest);
    wrap.append(bar);
    host.append(wrap);
  }
  const legend = document.createElement('ul');
  legend.className = 'split-legend';
  legend.innerHTML = picks
    .map((c, i) => `<li><span class="swatch" style="background:${colors[i]}"></span>${esc(c.name)} <span class="vals">${pct(pShare(c))} → ${pct(eShare(c))}</span></li>`)
    .join('') + '<li><span class="swatch" style="background:var(--rest)"></span>All other countries</li>';
  host.append(legend);
  host.dataset.state = 'ready';
}

/* ---------- Chapters 1 and 2: ranked bars ---------- */

function renderBars(hostId, rows, opts) {
  const host = document.getElementById(hostId);
  const width = Math.max(300, host.clientWidth);
  const narrow = width < 520;
  const nameW = narrow ? 136 : 172;
  const valueW = narrow ? 104 : 132;
  const rowH = 30;
  const barH = 18;
  const plotW = width - nameW - valueW;
  const max = Math.max(...rows.map(opts.value));
  const svg = makeSvg(width, rows.length * rowH + 4, opts.label);
  rows.forEach((c, i) => {
    const y = i * rowH;
    const w = Math.max(1, (opts.value(c) / max) * plotW);
    const g = svgEl('g', { class: `bar-row${ctxKeys.has(c.id) ? '' : ' dim'}`, transform: `translate(0 ${y})` });
    g.append(
      svgEl('rect', { class: 'bar-bg', x: 0, y: 0, width, height: rowH }),
      svgEl('text', { class: 'bar-rank', x: 0, y: rowH / 2 + 4 }, opts.rank(c)),
      svgEl('text', { class: 'bar-name', x: 24, y: rowH / 2 + 4.5, 'font-size': narrow ? 12 : 13 }, c.name),
    );
    const bar = svgEl('rect', { class: 'bar', x: nameW, y: (rowH - barH) / 2, width: w, height: barH, style: `--i:${i}` });
    const value = svgEl('text', { class: 'bar-value', x: nameW + w + 7, y: rowH / 2 + 4 });
    value.append(document.createTextNode(opts.format(c)));
    value.append(svgEl('tspan', { class: 'bar-share' }, ` · ${pct(opts.share(c))}`));
    g.append(bar, value, svgEl('title', {}, `${c.name}: ${opts.format(c)}, ${pct(opts.share(c))} (rank ${opts.rank(c)})`));
    svg.append(g);
  });
  host.replaceChildren(svg);
  host.dataset.state = 'ready';
  host.classList.add('reveal');
}


function renderTables(ctx) {
  const table = (label, head, body) =>
    `<div class="table-shell" tabindex="0" role="region" aria-label="${label}"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  document.getElementById('growers-table').innerHTML = table('Top 20 producers',
    '<th class="num" scope="col">Rank</th><th scope="col">Country</th><th class="num" scope="col">Tonnes</th><th class="num" scope="col">Share of world</th><th scope="col">FAO flag</th>',
    ctx.producers.slice(0, 20).map((c) => `<tr><td class="num">${c.production.rank}</td><td>${esc(c.name)}</td><td class="num">${whole.format(Math.round(c.production.tonnes))}</td><td class="num">${pct(c.production.share)}</td><td>${c.production.flag} · ${FLAGS[c.production.flag] ?? ''}</td></tr>`).join(''),
  );
  document.getElementById('exporters-table').innerHTML = table('Top 20 exporters',
    '<th class="num" scope="col">Rank</th><th scope="col">Country</th><th class="num" scope="col">US dollars</th><th class="num" scope="col">Share</th><th class="num" scope="col">Net weight, t</th><th scope="col">HS version</th>',
    ctx.exporters.slice(0, 20).map((c) => `<tr><td class="num">${c.exports.rank}</td><td>${esc(c.name)}</td><td class="num">${whole.format(Math.round(c.exports.usd))}</td><td class="num">${pct(c.exports.share)}</td><td class="num">${c.exports.netWeightT == null ? 'not reported' : whole.format(Math.round(c.exports.netWeightT))}</td><td>${c.exports.classification}</td></tr>`).join(''),
  );
  document.getElementById('paradox-table').innerHTML = table('Countries in either top 10',
    '<th scope="col">Country</th><th class="num" scope="col">Production rank</th><th class="num" scope="col">Production share</th><th class="num" scope="col">Export rank</th><th class="num" scope="col">Export share</th><th class="num" scope="col">Places moved</th>',
    ctx.set.map((c) => {
      const moved = c.production && c.exports ? c.production.rank - c.exports.rank : null;
      return `<tr><td>${esc(c.name)}</td><td class="num">${c.production?.rank ?? 'no figure'}</td><td class="num">${pct(pShare(c))}</td><td class="num">${c.exports?.rank ?? 'not reported'}</td><td class="num">${pct(eShare(c))}</td><td class="num">${moved == null ? '—' : moved > 0 ? `+${moved}` : moved}</td></tr>`;
    }).join(''),
  );
}

/* ---------- Chapter 3: paradox chart ---------- */

const state = { view: 'rank', selected: null, hover: null };
let ctxKeys = new Set(); // ids of the two top growers and two top exporters, emphasised in the bar charts

function byRank(get) {
  return (a, b) => (get(a) ?? Infinity) - (get(b) ?? Infinity);
}

function addPumpkin(g, x, y, size) {
  g.append(svgEl('use', { href: '#pumpkin', class: 'end', x: x - size / 2, y: y - size * 0.6, width: size, height: size * 1.1 }));
}

function drawRank(ctx, width) {
  const narrow = width < 560;
  const labelW = narrow ? 126 : 178;
  const fs = narrow ? 11 : 12.5;
  const L = labelW;
  const R = width - labelW;
  const top = 50;
  const rowH = narrow ? 26 : 28;
  const gap = 32;
  const n = ctx.set.length;
  const yAt = (i) => top + i * rowH + (i >= 10 ? gap : 0) + rowH / 2;
  const leftOrder = [...ctx.set].sort(byRank((c) => c.production?.rank));
  const rightOrder = [...ctx.set].sort(byRank((c) => c.exports?.rank));
  const height = top + n * rowH + gap + 8;
  const svg = makeSvg(width, height, `Production rank versus export rank for ${n} countries`);

  svg.append(
    svgEl('text', { class: 'col-head', x: 0, y: 14 }, 'Growers'),
    svgEl('text', { class: 'col-sub', x: 0, y: 30 }, 'rank by tonnes'),
    svgEl('text', { class: 'col-head sell', x: width, y: 14, 'text-anchor': 'end' }, 'Exporters'),
    svgEl('text', { class: 'col-sub', x: width, y: 30, 'text-anchor': 'end' }, 'rank by US$'),
  );
  const zoneY = top + 10 * rowH + gap / 2;
  svg.append(svgEl('line', { class: 'zone-rule', x1: 0, x2: width, y1: zoneY, y2: zoneY }));

  ctx.set.forEach((c, k) => {
    const y1 = yAt(leftOrder.indexOf(c));
    const y2 = yAt(rightOrder.indexOf(c));
    const cls = side(c);
    const g = svgEl('g', { class: `country ${cls}`, 'data-id': c.id });
    const mid = (L + R) / 2;
    const d = `M${L} ${y1} C${mid} ${y1} ${mid} ${y2} ${R} ${y2}`;
    const link = svgEl('path', { class: `link${cls === 'missing' ? ' missing' : ''}`, d, style: `--i:${k}` });
    g.append(svgEl('path', { class: 'hit', d }), link);
    if (c.production) addPumpkin(g, L, y1, 15);
    if (c.exports) addPumpkin(g, R, y2, 15);
    else g.append(svgEl('circle', { class: 'dumb-dot missing', cx: R, cy: y2, r: 5 }));
    const pr = c.production ? c.production.rank : 'n/r';
    const er = c.exports ? c.exports.rank : 'n/r';
    const left = svgEl('text', { class: 'label', x: L - 13, y: y1 + 4, 'text-anchor': 'end', 'font-size': fs }, c.name);
    const right = svgEl('text', { class: 'label', x: R + 13, y: y2 + 4, 'font-size': fs });
    if (narrow) {
      // Narrow screens: no separate rank columns, so the rank rides next to the name
      left.append(svgEl('tspan', { class: 'rank-num', dx: 4 }, pr));
      right.append(svgEl('tspan', { class: 'rank-num' }, `${er} `), document.createTextNode(c.name));
    } else {
      right.textContent = c.name;
      g.append(
        svgEl('text', { class: 'rank-num', x: 0, y: y1 + 4 }, pr),
        svgEl('text', { class: 'rank-num', x: width, y: y2 + 4, 'text-anchor': 'end' }, er),
      );
    }
    g.append(left, right, svgEl('title', {}, `${c.name}: production rank ${c.production?.rank ?? 'none'}, export rank ${c.exports?.rank ?? 'not reported'}`));
    svg.append(g);
  });
  svg.append(svgEl('text', { class: 'zone-label', x: width / 2, y: zoneY - 5, 'text-anchor': 'middle', 'pointer-events': 'none' },
    narrow ? 'Below: outside the top 10' : 'Below the line: outside the top 10, in rank order, not to scale'));
  return svg;
}

function drawShare(ctx, width) {
  const narrow = width < 560;
  const nameW = narrow ? 112 : 160;
  const valW = narrow ? 96 : 130;
  const top = 34;
  const rowH = 26;
  const rows = [...ctx.set].sort(byRank((c) => c.production?.rank));
  const maxShare = Math.max(...rows.flatMap((c) => [pShare(c) ?? 0, eShare(c) ?? 0]));
  const max = Math.ceil(maxShare * 10) / 10;
  const x = (s) => nameW + (s / max) * (width - nameW - valW - 10);
  const height = top + rows.length * rowH + 6;
  const svg = makeSvg(width, height, `Share of world production and share of reported exports for ${rows.length} countries`);
  for (let s = 0; s <= max + 1e-9; s += 0.1) {
    svg.append(
      svgEl('line', { class: 'grid-line', x1: x(s), x2: x(s), y1: top - 6, y2: height }),
      svgEl('text', { class: 'axis-text', x: x(s), y: top - 12, 'text-anchor': 'middle' }, `${Math.round(s * 100)}%`),
    );
  }
  svg.append(svgEl('text', { class: 'axis-text', x: width, y: top - 12, 'text-anchor': 'end' }, narrow ? 'grow → sell' : 'production → exports'));
  rows.forEach((c, i) => {
    const y = top + i * rowH + rowH / 2;
    const g = svgEl('g', { class: `country ${side(c)}`, 'data-id': c.id });
    g.append(
      svgEl('rect', { class: 'row-bg', x: 0, y: y - rowH / 2, width, height: rowH }),
      svgEl('text', { class: 'label', x: nameW - 12, y: y + 4, 'text-anchor': 'end', 'font-size': narrow ? 11.5 : 12.5 }, c.name),
    );
    const ps = pShare(c);
    const es = eShare(c);
    if (ps != null && es != null) g.append(svgEl('line', { class: 'dumb-link', x1: x(ps), x2: x(es), y1: y, y2: y }));
    if (ps != null) g.append(svgEl('circle', { class: 'dumb-dot grow', cx: x(ps), cy: y, r: 5.5 }));
    if (es != null) g.append(svgEl('circle', { class: 'dumb-dot sell', cx: x(es), cy: y, r: 5.5 }));
    const val = svgEl('text', { class: 'val', x: width, y: y + 4, 'text-anchor': 'end' });
    val.append(svgEl('tspan', { class: 'val grow' }, pct(ps)), document.createTextNode(' → '), svgEl('tspan', { class: 'val sell' }, es == null ? 'n/r' : pct(es)));
    g.append(val, svgEl('title', {}, `${c.name}: ${pct(ps)} of world production, ${es == null ? 'exports not reported' : `${pct(es)} of reported exports`}`));
    svg.append(g);
  });
  return svg;
}

function renderParadox(ctx) {
  state.hover = null;
  const host = document.getElementById('paradox-chart');
  const width = Math.max(300, host.clientWidth);
  const svg = state.view === 'rank' ? drawRank(ctx, width) : drawShare(ctx, width);
  host.replaceChildren(svg);
  host.dataset.state = 'ready';
  host.classList.add('reveal');
  svg.querySelectorAll('.link').forEach((p) => p.style.setProperty('--len', Math.ceil(p.getTotalLength())));
  svg.querySelectorAll('.country').forEach((g) => {
    const id = Number(g.dataset.id);
    g.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { state.hover = id; applyFocus(); } });
    g.addEventListener('pointerleave', () => { if (state.hover === id) { state.hover = null; applyFocus(); } });
    g.addEventListener('click', () => select(ctx, id));
  });

  const isRank = state.view === 'rank';
  document.getElementById('paradox-title-text').textContent = isRank ? 'Production rank and export rank' : 'Share of world production and share of reported exports';
  document.getElementById('paradox-sub').textContent = isRank
    ? `Countries in either top 10, ${ctx.year}. Ranks 11 and below are stacked in order. n/r: not reported. Click or tap a line.`
    : `Countries in either top 10, ${ctx.year}. Both measures on the same percentage scale. Click or tap a row.`;
  const item = (mark, text) => `<span class="legend-item">${mark} ${text}</span>`;
  document.getElementById('paradox-legend').innerHTML = isRank
    ? item('<span class="key key-grow"></span>', 'Larger share of world production than of exports') +
      item('<span class="key key-sell"></span>', 'Larger share of exports than of production') +
      item('<span class="key key-missing"></span>', 'Exports not reported (dashed)')
    : item('<span class="dot dot-grow"></span>', 'Share of world production (tonnes)') +
      item('<span class="dot dot-sell"></span>', 'Share of reported world exports (US$)');
  applyFocus();
}

function applyFocus() {
  const svg = document.querySelector('#paradox-chart svg');
  if (!svg) return;
  let any = false;
  svg.querySelectorAll('.country').forEach((g) => {
    const id = Number(g.dataset.id);
    const sel = id === state.selected;
    const hov = id === state.hover;
    g.classList.toggle('is-selected', sel);
    g.classList.toggle('is-hover', hov);
    any ||= sel || hov;
    if (sel) g.parentNode.append(g); // draw the selected line on top
  });
  svg.classList.toggle('has-focus', any);
}

function renderCard(ctx, c) {
  const card = document.getElementById('country-card');
  const { year } = ctx;
  const t = ctx.data.totals;
  let verdict;
  if (c.production && c.exports) {
    const diff = c.exports.rank - c.production.rank;
    const shift = diff === 0 ? '<span class="rank-shift">same rank</span>'
      : `<span class="rank-shift${diff > 0 ? ' down' : ''}">${Math.abs(diff)} place${Math.abs(diff) === 1 ? '' : 's'} ${diff > 0 ? 'lower' : 'higher'}</span>`;
    verdict = `${ordinal(c.production.rank)} for production, ${ordinal(c.exports.rank)} for export value: ${shift} as an exporter.`;
  } else if (c.production) {
    verdict = `${ordinal(c.production.rank)} for production. No export figure reported for ${year}.`;
  } else if (c.exports) {
    verdict = `${ordinal(c.exports.rank)} for export value. No FAOSTAT production figure for ${year}.`;
  } else {
    verdict = `No production or export figures for ${year}.`;
  }

  const prodStat = c.production
    ? `<p class="stat-value">${fmtT(c.production.tonnes)}</p><p class="stat-meta">${pct(c.production.share)} of world production<br>Rank ${c.production.rank} of ${t.producingCountries} · FAO ${FLAGS[c.production.flag] ?? c.production.flag}</p>`
    : `<p class="stat-missing">No FAOSTAT production figure for ${year}.</p>`;
  const expStat = c.exports
    ? `<p class="stat-value">${fmtUsd(c.exports.usd)}</p><p class="stat-meta">${pct(c.exports.share)} of reported world exports<br>Rank ${c.exports.rank} of ${t.exportReporters}</p>`
    : `<p class="stat-missing">Not reported to UN Comtrade for ${year}.${c.mirrorImportsUsd ? ` Partners declared ${fmtUsd(c.mirrorImportsUsd)} of imports from ${esc(c.name)}.` : ''}</p>`;

  const notes = [];
  if (c.exportWeightToProduction != null) {
    const r = c.exportWeightToProduction;
    notes.push(r > 1
      ? `Exported weight is ${pct(r)} of production weight, more than it grew. Re-exports or the difference in scope between the two sources could explain this; the data cannot tell which.`
      : `Exported weight equals about ${r < 0.001 ? 'less than 0.1%' : pct(r)} of production weight.`);
  }
  if (c.exports && c.topBuyers?.length) {
    notes.push(`Main buyers, by their import declarations: ${c.topBuyers.map((b) => `${esc(b.name)} ${fmtUsd(b.usd)}`).join(', ')}.`);
  }
  if (!ctx.set.includes(c)) notes.push('Outside both top 10s, so it is not drawn in the chart.');

  card.innerHTML = `
    <p class="eyebrow">Selected country</p>
    <h3>${esc(c.name)}</h3>
    <p class="card-verdict">${verdict}</p>
    <div class="card-stats">
      <div class="stat"><p class="stat-label">Grows</p>${prodStat}</div>
      <div class="stat sell"><p class="stat-label">Exports</p>${expStat}</div>
    </div>
    ${notes.length ? `<ul class="card-list">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}
    <p class="card-foot">Production: FAOSTAT, tonnes. Exports: UN Comtrade HS 070993, US$ FOB, declared by the exporter. ${year}. All varieties of pumpkins, squash and gourds.</p>`;
}

function select(ctx, id) {
  const c = ctx.byId.get(id);
  if (!c) return;
  state.selected = id;
  document.getElementById('country-select').value = String(id);
  renderCard(ctx, c);
  applyFocus();
}

function setupControls(ctx) {
  const sel = document.getElementById('country-select');
  const opt = (c) => `<option value="${c.id}">${esc(c.name)}</option>`;
  const byName = (a, b) => a.name.localeCompare(b.name);
  const others = ctx.data.countries.filter((c) => !ctx.set.includes(c) && (c.production || c.exports)).sort(byName);
  sel.innerHTML = `<optgroup label="In either top 10">${[...ctx.set].sort(byName).map(opt).join('')}</optgroup><optgroup label="All other countries">${others.map(opt).join('')}</optgroup>`;
  sel.disabled = false;
  sel.addEventListener('change', () => select(ctx, Number(sel.value)));

  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.view === btn.dataset.view) return;
      state.view = btn.dataset.view;
      document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      renderParadox(ctx);
    });
  });
}

/* ---------- Reveal on scroll ---------- */

function setupReveal() {
  const nodes = document.querySelectorAll('.reveal');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) {
    nodes.forEach((n) => n.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        io.unobserve(e.target);
      }
    }
  }, { threshold: 0.2 });
  nodes.forEach((n) => io.observe(n));
}

/* ---------- Main ---------- */

function render(data) {
  const countries = data.countries;
  const producers = countries.filter((c) => c.production).sort(byRank((c) => c.production.rank));
  const exporters = countries.filter((c) => c.exports).sort(byRank((c) => c.exports.rank));
  const topP = producers.slice(0, 10);
  const topE = exporters.slice(0, 10);
  const ctx = {
    data,
    year: data.referenceYear,
    producers,
    exporters,
    topP,
    topE,
    set: [...new Set([...topP, ...topE])],
    byId: new Map(countries.map((c) => [c.id, c])),
    p1: producers[0],
    p2: producers[1],
    e1: exporters[0],
    e2: exporters[1],
  };
  ctxKeys = new Set([ctx.p1, ctx.p2, ctx.e1, ctx.e2].map((c) => c.id));

  fillFacts(data, ctx);
  renderSplit(ctx);
  const drawBars = () => {
    renderBars('growers-chart', topP, {
      label: `Top 10 producers by tonnes, ${ctx.year}`,
      value: (c) => c.production.tonnes,
      share: pShare,
      rank: (c) => c.production.rank,
      format: (c) => fmtT(c.production.tonnes),
    });
    renderBars('exporters-chart', topE, {
      label: `Top 10 exporters by US dollars, ${ctx.year}`,
      value: (c) => c.exports.usd,
      share: eShare,
      rank: (c) => c.exports.rank,
      format: (c) => fmtUsd(c.exports.usd),
    });
  };
  drawBars();
  document.getElementById('growers-chart').classList.add('grow');
  document.getElementById('exporters-chart').classList.add('sell');
  renderTables(ctx);
  setupControls(ctx);
  renderParadox(ctx);
  select(ctx, ctx.p1.id);
  setupReveal();

  let lastWidth = window.innerWidth;
  let timer;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      drawBars();
      renderParadox(ctx);
    }, 150);
  });
}

load();
