/* Featured Zip Codes Dashboard — 98115 / 98125 / 98155
   - Mirrors the Daily Hot Sheet layout but focused on the three featured zip codes
   - Insights & Analysis up top (KPIs + narrative + per-zip cards)
   - Zip Code Snapshot table + property detail with Redfin/Google search links
   - Interactive sales chart with list-to-close ratio tooltip
   - CSV upload at the bottom
*/

const FOCUS_ZIPS = ['98115', '98125', '98155'];
const SAMPLE_CSV_URL = 'assets/sample.csv';

let chartInstance = null;

// ---------- utilities ----------
// HTML escape helper — prevents XSS from any string interpolated into innerHTML.
// Even though we treat sample data as synthetic and uploaded CSVs stay in the browser,
// escaping defensively keeps the dashboard safe if a user pastes a malicious CSV.
const escHtml = (s) => {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const fmtMoney = (n) => {
  if (n == null || isNaN(n)) return '—';
  return '$' + Math.round(n).toLocaleString();
};
const fmtMoneyShort = (n) => {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
};
const fmtNum = (n, d = 0) => {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
};
const toNum = (v) => {
  if (v == null) return null;
  const s = String(v).replace(/[$,\s]/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
};
const parseDate = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  // handles "5/13/2026 0:00" and "5/13/2026"
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

// Status classification — handles "Active", "Pending", "Pending Inspection", "Sold", etc.
function classifyStatus(s) {
  const v = (s || '').toLowerCase().trim();
  if (v.includes('sold') || v.includes('closed')) return 'sold';
  if (v.includes('pending')) return 'pending';
  if (v === 'active' || v === 'new' || v.includes('back on market') || v === 'bom') return 'new';
  return 'other';
}

// Address builder from NWMLS columns
function buildAddress(r) {
  const parts = [
    r['Street Number'],
    r['Street Number Modifier'],
    r['Street Direction'],
    r['Street Name'],
    r['Street Suffix'],
    r['Street Post Direction']
  ].filter(p => p != null && String(p).trim() !== '').map(p => String(p).trim());
  const street = parts.join(' ');
  const unit = r['Unit'] ? ` #${String(r['Unit']).trim()}` : '';
  const city = r['City'] ? `, ${String(r['City']).trim()}` : '';
  return (street + unit + city).trim() || '—';
}

// ---------- data normalization ----------
function normalizeRows(rawRows) {
  return rawRows
    .filter(r => r && r['Listing Number'])
    .map(r => {
      const listPrice = toNum(r['Listing Price']);
      const origPrice = toNum(r['Original Price']);
      const sellPrice = toNum(r['Selling Price']);
      const sqft = toNum(r['Square Footage']);
      const dom = toNum(r['DOM']);
      const statusRaw = (r['Status'] || '').trim();
      const status = classifyStatus(statusRaw);
      const zip = (r['Zip Code'] || '').toString().trim();
      const area = (r['Area'] || r['Community'] || 'Unknown').toString().trim() || 'Unknown';
      // Price reduction: original > current listing price
      const priceReduced = origPrice != null && listPrice != null && origPrice > listPrice;

      // Reference price for averages: prefer sold price for solds, else list price
      const refPrice = status === 'sold' && sellPrice != null ? sellPrice : listPrice;
      const ppsf = (refPrice != null && sqft && sqft > 0) ? refPrice / sqft : null;

      return {
        mls: String(r['Listing Number']).trim(),
        address: buildAddress(r),
        city: (r['City'] || '').trim(),
        zip,
        area,
        listPrice,
        origPrice,
        sellPrice,
        refPrice,
        sqft,
        ppsf,
        dom,
        status,
        statusRaw,
        priceReduced,
        sellingDate: parseDate(r['Selling Date']),
        listingDate: parseDate(r['Listing Date'])
      };
    });
}

// ---------- aggregation ----------
function aggregate(rows, keyFn) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    if (!groups.has(k)) {
      groups.set(k, {
        key: k,
        new: 0, pending: 0, sold: 0, reductions: 0,
        prices: [], ppsfs: [], doms: []
      });
    }
    const g = groups.get(k);
    if (r.status === 'new') g.new++;
    else if (r.status === 'pending') g.pending++;
    else if (r.status === 'sold') g.sold++;
    if (r.priceReduced) g.reductions++;
    if (r.refPrice != null) g.prices.push(r.refPrice);
    if (r.ppsf != null) g.ppsfs.push(r.ppsf);
    if (r.dom != null) g.doms.push(r.dom);
  }
  const out = [];
  for (const g of groups.values()) {
    const avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
    out.push({
      key: g.key,
      counts: { new: g.new, pending: g.pending, sold: g.sold, reductions: g.reductions },
      avgPrice: avg(g.prices),
      avgPpsf: avg(g.ppsfs),
      avgDom: avg(g.doms),
      total: g.new + g.pending + g.sold
    });
  }
  return out;
}

// ---------- rendering ----------
function renderTopKpis(rows) {
  const total = rows.length;
  const counts = { new: 0, pending: 0, sold: 0, reductions: 0 };
  for (const r of rows) {
    if (r.status === 'new') counts.new++;
    else if (r.status === 'pending') counts.pending++;
    else if (r.status === 'sold') counts.sold++;
    if (r.priceReduced) counts.reductions++;
  }
  const tiles = [
    { lbl: 'Total Listings', val: total, sub: 'all statuses' },
    { lbl: 'New / Active', val: counts.new, sub: 'on market' },
    { lbl: 'Pending', val: counts.pending, sub: 'in escrow' },
    { lbl: 'Sold', val: counts.sold, sub: 'closed' },
    { lbl: 'Price Reductions', val: counts.reductions, sub: 'orig > current' }
  ];
  const el = document.getElementById('kpi-row');
  el.innerHTML = tiles.map(t => `
    <div class="kpi">
      <div class="lbl">${t.lbl}</div>
      <div class="val">${t.val.toLocaleString()}</div>
      <div class="sub">${t.sub}</div>
    </div>
  `).join('');
}

function renderAreaTable(rows) {
  // Sort by leading Area number (e.g. "1 - Gig Harbor" → 1, "920 - NE Port Angeles" → 920).
  // Areas without a leading number sort to the end alphabetically.
  const areaNum = (s) => {
    const m = String(s).match(/^\s*(\d+)/);
    return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
  };
  const groups = aggregate(rows, r => r.area)
    .sort((a, b) => {
      const na = areaNum(a.key), nb = areaNum(b.key);
      if (na !== nb) return na - nb;
      return String(a.key).localeCompare(String(b.key));
    });
  const tbody = document.querySelector('#area-table tbody');
  if (!groups.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px">No data available.</td></tr>`;
    return;
  }
  tbody.innerHTML = groups.map(g => `
    <tr>
      <td><strong>${escHtml(g.key)}</strong></td>
      <td>${g.counts.new}</td>
      <td>${g.counts.pending}</td>
      <td>${g.counts.sold}</td>
      <td>${g.counts.reductions}</td>
      <td class="num">${fmtMoney(g.avgPrice)}</td>
      <td class="num">${g.avgPpsf != null ? '$' + fmtNum(g.avgPpsf, 0) : '—'}</td>
      <td class="num">${g.avgDom != null ? fmtNum(g.avgDom, 0) : '—'}</td>
    </tr>
  `).join('');
}

function renderZipSummary(rows) {
  const focusRows = rows.filter(r => FOCUS_ZIPS.includes(r.zip));
  const groups = aggregate(focusRows, r => r.zip);
  // ensure all 3 zips appear even if no data
  const byZip = new Map(groups.map(g => [g.key, g]));
  const tbody = document.querySelector('#zip-summary-table tbody');
  tbody.innerHTML = FOCUS_ZIPS.map(z => {
    const g = byZip.get(z) || { counts: { new: 0, pending: 0, sold: 0, reductions: 0 }, avgPrice: null, avgPpsf: null, avgDom: null };
    return `
      <tr>
        <td><strong>${escHtml(z)}</strong></td>
        <td>${g.counts.new}</td>
        <td>${g.counts.pending}</td>
        <td>${g.counts.sold}</td>
        <td>${g.counts.reductions}</td>
        <td class="num">${fmtMoney(g.avgPrice)}</td>
        <td class="num">${g.avgPpsf != null ? '$' + fmtNum(g.avgPpsf, 0) : '—'}</td>
        <td class="num">${g.avgDom != null ? fmtNum(g.avgDom, 0) : '—'}</td>
      </tr>
    `;
  }).join('');
}

// Build a small canvas image of a Unicode arrow in a given color — used as Chart.js pointStyle.
function makeArrowImage(symbol, color, size = 18) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const c = document.createElement('canvas');
  c.width = size * dpr;
  c.height = size * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = color;
  ctx.font = `700 ${size - 2}px "Inter", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(symbol, size / 2, size / 2 + 1);
  return c;
}

function renderSalesChart(rows) {
  const sold = rows.filter(r =>
    r.status === 'sold' &&
    FOCUS_ZIPS.includes(r.zip) &&
    r.sellPrice != null &&
    r.listPrice != null
  );

  const wrap = document.getElementById('hist-wrap');
  const empty = document.getElementById('hist-empty');
  if (!wrap) return;

  // Clear any prior bars but preserve the empty-state node
  Array.from(wrap.querySelectorAll('.hist-row, .hist-legend')).forEach(n => n.remove());

  if (!sold.length) {
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  // Decide bucket size off the data range so it always reads cleanly
  const prices = sold.map(r => r.sellPrice).sort((a, b) => a - b);
  const minP = prices[0];
  const maxP = prices[prices.length - 1];
  const span = maxP - minP;
  // Aim for ~7 buckets; round bucket size to nearest 100k / 250k / 500k
  const niceSteps = [100000, 250000, 500000, 1000000, 2000000];
  const targetBuckets = 7;
  let step = niceSteps.find(s => span / s <= targetBuckets) || 2000000;
  const floorP = Math.floor(minP / step) * step;
  const ceilP = Math.ceil((maxP + 1) / step) * step;
  const buckets = [];
  for (let lo = floorP; lo < ceilP; lo += step) {
    buckets.push({ lo, hi: lo + step, over: 0, at: 0, under: 0, total: 0 });
  }

  sold.forEach(r => {
    const idx = Math.min(buckets.length - 1, Math.floor((r.sellPrice - floorP) / step));
    const b = buckets[idx];
    if (!b) return;
    const ratio = r.sellPrice / r.listPrice;
    if (ratio > 1.0001) b.over++;
    else if (ratio < 0.9999) b.under++;
    else b.at++;
    b.total++;
  });

  const maxCount = Math.max(...buckets.map(b => b.total), 1);

  // Render bars
  const frag = document.createDocumentFragment();
  buckets.forEach(b => {
    const row = document.createElement('div');
    row.className = 'hist-row';
    const label = `${fmtMoneyShort(b.lo)}–${fmtMoneyShort(b.hi)}`;
    const widthPct = (b.total / maxCount) * 100;
    const overW = b.total ? (b.over / b.total) * widthPct : 0;
    const atW = b.total ? (b.at / b.total) * widthPct : 0;
    const underW = b.total ? (b.under / b.total) * widthPct : 0;
    row.innerHTML = `
      <div class="hist-label">${label}</div>
      <div class="hist-bar" title="${b.total} sold (${b.over} over · ${b.at} at · ${b.under} under)">
        <div class="seg over" style="width:${overW.toFixed(2)}%"></div>
        <div class="seg at" style="width:${atW.toFixed(2)}%"></div>
        <div class="seg under" style="width:${underW.toFixed(2)}%"></div>
      </div>
      <div class="hist-count">${b.total}</div>
    `;
    frag.appendChild(row);
  });
  // Legend
  const legend = document.createElement('div');
  legend.className = 'hist-legend';
  legend.innerHTML = `
    <span><span class="swatch over"></span>Over list</span>
    <span><span class="swatch at"></span>At list</span>
    <span><span class="swatch under"></span>Under list</span>
  `;
  frag.appendChild(legend);
  wrap.appendChild(frag);
}

// Chart.js time scale needs an adapter — use a tiny inline date adapter so we don't need a separate CDN file.
// Build a minimal adapter compatible with Chart.js v4 time scale.
function installSimpleTimeAdapter() {
  // We avoid needing chartjs-adapter-date-fns by using Chart.js' default behavior with numeric x.
  // Switch x scale to 'linear' with date formatting via tick callback.
}

// Override the chart x scale to use linear since we don't load a date adapter.
function overrideChartScales() {
  const origInit = renderSalesChart;
}

// ---------- main pipeline ----------
function process(rawRows) {
  const rows = normalizeRows(rawRows);
  document.getElementById('record-count').textContent = `${rows.length} record${rows.length === 1 ? '' : 's'}`;

  // determine "report date" — most common Selling Date or Listing Date
  let latest = null;
  for (const r of rows) {
    const d = r.sellingDate || r.listingDate;
    if (d && (!latest || d > latest)) latest = d;
  }
  document.getElementById('report-date').textContent = latest
    ? `Report — ${latest.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`
    : 'Featured Zip Codes Report';

  renderInsights(rows);
  renderZipSummary(rows);
  renderSalesChart(rows);
}

// ---------- insights & analysis ----------
function median(arr) {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function renderInsights(allRows) {
  const rows = allRows.filter(r => FOCUS_ZIPS.includes(r.zip));
  const kpiEl = document.getElementById('insight-kpis');
  const tempEl = document.getElementById('insight-temp');
  const priceEl = document.getElementById('insight-price');
  const paceEl = document.getElementById('insight-pace');
  const zipCardsEl = document.getElementById('zip-cards');

  if (!rows.length) {
    kpiEl.innerHTML = '';
    const emptyMsg = '<li style="color:var(--muted);font-style:italic">No 98115 / 98125 / 98155 records in this dataset. Upload a hot sheet with North Seattle or Shoreline activity to populate insights.</li>';
    tempEl.innerHTML = emptyMsg;
    priceEl.innerHTML = '';
    paceEl.innerHTML = '';
    zipCardsEl.innerHTML = '';
    return;
  }

  // Buckets
  const sold = rows.filter(r => r.status === 'sold' && r.sellPrice != null && r.listPrice != null);
  const pending = rows.filter(r => r.status === 'pending');
  const active = rows.filter(r => r.status === 'new');
  const reduced = rows.filter(r => r.priceReduced);

  // List-to-close ratios
  const ratios = sold.map(r => r.sellPrice / r.listPrice);
  const overList = sold.filter(r => r.sellPrice > r.listPrice);
  const atList = sold.filter(r => Math.abs(r.sellPrice - r.listPrice) < 1);
  const belowList = sold.filter(r => r.sellPrice < r.listPrice);
  const avgRatio = ratios.length ? ratios.reduce((s, x) => s + x, 0) / ratios.length : null;
  const medRatio = median(ratios);

  const soldPrices = sold.map(r => r.sellPrice);
  const soldDoms = sold.map(r => r.dom).filter(d => d != null);
  const activeDoms = active.map(r => r.dom).filter(d => d != null);
  const ppsfs = rows.map(r => r.ppsf).filter(p => p != null);

  const medSoldPrice = median(soldPrices);
  const medSoldDom = median(soldDoms);
  const medActiveDom = median(activeDoms);
  const medPpsf = median(ppsfs);

  // Temperature score: weighted by % over list, % reductions, median DOM
  const overShare = sold.length ? overList.length / sold.length : 0;
  const reductionShare = rows.length ? reduced.length / rows.length : 0;
  // Simple bucket
  let tempLabel, tempCls;
  if (overShare >= 0.5 && (medSoldDom == null || medSoldDom <= 14)) { tempLabel = 'Seller\u2019s Market'; tempCls = 'up'; }
  else if (overShare <= 0.25 && reductionShare >= 0.3) { tempLabel = 'Buyer\u2019s Market'; tempCls = 'down'; }
  else { tempLabel = 'Balanced'; tempCls = 'eq'; }

  // Headline KPI tiles
  const tiles = [
    {
      lbl: 'Featured-Zip Activity',
      val: rows.length.toString(),
      sub: `${active.length} active · ${pending.length} pending · ${sold.length} sold`,
      cls: ''
    },
    {
      lbl: 'Market Temperature',
      val: tempLabel,
      sub: sold.length ? `${(overShare * 100).toFixed(0)}% sold over list` : 'No closed sales yet',
      cls: tempCls
    },
    {
      lbl: 'Median List-to-Close',
      val: medRatio != null ? (medRatio * 100).toFixed(1) + '%' : '—',
      sub: avgRatio != null ? `avg ${(avgRatio * 100).toFixed(1)}%` : 'no sold comps',
      cls: medRatio == null ? '' : (medRatio > 1.001 ? 'up' : medRatio < 0.999 ? 'down' : 'eq')
    },
    {
      lbl: 'Median Sold Price',
      val: medSoldPrice != null ? fmtMoneyShort(medSoldPrice) : '—',
      sub: medPpsf != null ? `$${Math.round(medPpsf)} / sqft median` : 'price/sqft n/a',
      cls: ''
    },
    {
      lbl: 'Median DOM (Sold)',
      val: medSoldDom != null ? Math.round(medSoldDom) + ' days' : '—',
      sub: medActiveDom != null ? `${Math.round(medActiveDom)} d on active` : 'no active DOM',
      cls: medSoldDom == null ? '' : (medSoldDom <= 10 ? 'up' : medSoldDom >= 30 ? 'down' : 'eq')
    }
  ];
  kpiEl.innerHTML = tiles.map(t => `
    <div class="insight-kpi ${t.cls}">
      <div class="lbl">${t.lbl}</div>
      <div class="val">${t.val}</div>
      <div class="sub">${t.sub}</div>
    </div>
  `).join('');

  // ----- Market Temperature bullets -----
  const tempBullets = [];
  tempBullets.push(`Across the three featured zips: <strong>${active.length} active</strong>, <strong>${pending.length} pending</strong>, and <strong>${sold.length} sold</strong> in this dataset.`);
  if (sold.length) {
    const pctOver = ((overList.length / sold.length) * 100).toFixed(0);
    const pctAt = ((atList.length / sold.length) * 100).toFixed(0);
    const pctBelow = ((belowList.length / sold.length) * 100).toFixed(0);
    tempBullets.push(`Of closed sales: <strong>${pctOver}%</strong> over list, <strong>${pctAt}%</strong> at list, <strong>${pctBelow}%</strong> below list.`);
  }
  if (pending.length && active.length) {
    const ratio = (pending.length / active.length).toFixed(2);
    const interp = ratio >= 1 ? 'demand is absorbing inventory' : ratio >= 0.5 ? 'steady absorption' : 'inventory building';
    tempBullets.push(`Pending-to-active ratio is <strong>${ratio}</strong> — ${interp}.`);
  }
  if (reduced.length) {
    const pctReduced = ((reduced.length / rows.length) * 100).toFixed(0);
    tempBullets.push(`<strong>${reduced.length}</strong> of ${rows.length} listings show price reductions (${pctReduced}% of stock).`);
  } else if (rows.length) {
    tempBullets.push('No active price reductions in the featured zips — sellers are holding firm.');
  }
  tempEl.innerHTML = tempBullets.map(b => `<li>${b}</li>`).join('');

  // ----- Pricing Dynamics bullets -----
  const priceBullets = [];
  if (medSoldPrice != null) {
    priceBullets.push(`Median sold price across featured zips: <strong>${fmtMoney(medSoldPrice)}</strong>.`);
  }
  if (avgRatio != null) {
    const pct = (avgRatio * 100).toFixed(1);
    const dir = avgRatio > 1.005 ? 'above' : avgRatio < 0.995 ? 'below' : 'at';
    priceBullets.push(`Average sale price is closing <strong>${pct}%</strong> of list — ${dir} asking.`);
  }
  if (medPpsf != null) {
    priceBullets.push(`Median price per square foot is <strong>$${Math.round(medPpsf).toLocaleString()}</strong>.`);
  }
  // Compare zips on $/sqft
  const zipPpsf = {};
  FOCUS_ZIPS.forEach(z => {
    const vals = rows.filter(r => r.zip === z && r.ppsf != null).map(r => r.ppsf);
    zipPpsf[z] = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
  });
  const ppsfRanked = Object.entries(zipPpsf).filter(([_, v]) => v != null).sort((a, b) => b[1] - a[1]);
  if (ppsfRanked.length >= 2) {
    const top = ppsfRanked[0], bot = ppsfRanked[ppsfRanked.length - 1];
    const spread = (((top[1] - bot[1]) / bot[1]) * 100).toFixed(0);
    priceBullets.push(`<strong>${top[0]}</strong> leads on $/sqft at $${Math.round(top[1]).toLocaleString()}, a ${spread}% premium over <strong>${bot[0]}</strong> ($${Math.round(bot[1]).toLocaleString()}).`);
  }
  if (overList.length && sold.length) {
    const topOver = overList.slice().sort((a, b) => (b.sellPrice / b.listPrice) - (a.sellPrice / a.listPrice))[0];
    const pct = ((topOver.sellPrice / topOver.listPrice - 1) * 100).toFixed(1);
    priceBullets.push(`Biggest premium: <strong>${escHtml(topOver.address)}</strong> (${escHtml(topOver.zip)}) closed <strong>${pct}%</strong> over list at ${fmtMoney(topOver.sellPrice)}.`);
  }
  if (!priceBullets.length) priceBullets.push('No closed comps yet — pricing dynamics will populate as sold data arrives.');
  priceEl.innerHTML = priceBullets.map(b => `<li>${b}</li>`).join('');

  // ----- Pace & Notable Activity bullets -----
  const paceBullets = [];
  if (medSoldDom != null) {
    const interp = medSoldDom <= 7 ? 'very fast' : medSoldDom <= 14 ? 'fast' : medSoldDom <= 30 ? 'moderate' : 'slow';
    paceBullets.push(`Sold listings closed in a median of <strong>${Math.round(medSoldDom)} days</strong> on market — ${interp} pace.`);
  }
  if (medActiveDom != null) {
    paceBullets.push(`Active listings have been on market for a median of <strong>${Math.round(medActiveDom)} days</strong>.`);
  }
  // Stale listings: active with DOM > 30
  const stale = active.filter(r => r.dom != null && r.dom > 30);
  if (stale.length) {
    paceBullets.push(`<strong>${stale.length}</strong> active listing${stale.length === 1 ? '' : 's'} over 30 days — candidates for negotiation.`);
  }
  // Fastest sale
  if (sold.length) {
    const fastest = sold.slice().filter(r => r.dom != null).sort((a, b) => a.dom - b.dom)[0];
    if (fastest) {
      paceBullets.push(`Quickest close: <strong>${escHtml(fastest.address)}</strong> (${escHtml(fastest.zip)}) in <strong>${fastest.dom} day${fastest.dom === 1 ? '' : 's'}</strong> at ${fmtMoney(fastest.sellPrice)}.`);
    }
  }
  // Highest priced listing
  const priced = rows.filter(r => r.refPrice != null).sort((a, b) => b.refPrice - a.refPrice);
  if (priced.length) {
    const top = priced[0];
    paceBullets.push(`Top-priced featured listing: <strong>${escHtml(top.address)}</strong> (${escHtml(top.zip)}) at <strong>${fmtMoney(top.refPrice)}</strong>.`);
  }
  if (!paceBullets.length) paceBullets.push('No DOM data available in this dataset.');
  paceEl.innerHTML = paceBullets.map(b => `<li>${b}</li>`).join('');

  // ----- Per-zip narrative cards -----
  const cards = FOCUS_ZIPS.map(z => {
    const zr = rows.filter(r => r.zip === z);
    if (!zr.length) {
      return `
        <div class="zip-card">
          <div class="zc-head"><span class="zc-zip">${escHtml(z)}</span><span class="zc-tag">No Activity</span></div>
          <div class="zc-body" style="color:var(--muted);font-style:italic">No listings in this dataset.</div>
        </div>`;
    }
    const zSold = zr.filter(r => r.status === 'sold' && r.sellPrice != null && r.listPrice != null);
    const zActive = zr.filter(r => r.status === 'new');
    const zPending = zr.filter(r => r.status === 'pending');
    const zReduced = zr.filter(r => r.priceReduced);
    const zOver = zSold.filter(r => r.sellPrice > r.listPrice);
    const zRatios = zSold.map(r => r.sellPrice / r.listPrice);
    const zAvgRatio = zRatios.length ? zRatios.reduce((s, x) => s + x, 0) / zRatios.length : null;
    const zMedDom = median(zSold.map(r => r.dom).filter(d => d != null));
    const zMedPrice = median(zSold.map(r => r.sellPrice));
    const zMedPpsf = median(zr.map(r => r.ppsf).filter(p => p != null));

    // Bucket per zip
    let tag = 'Balanced', cls = 'balanced';
    if (zSold.length && zOver.length / zSold.length >= 0.5 && (zMedDom == null || zMedDom <= 14)) { tag = 'Hot'; cls = 'hot'; }
    else if (zSold.length && zOver.length / zSold.length <= 0.25 && (zReduced.length / zr.length) >= 0.3) { tag = 'Cooling'; cls = 'soft'; }

    const ratioTxt = zAvgRatio != null ? `${(zAvgRatio * 100).toFixed(1)}% of list` : 'no sold comps';
    const dirPhrase = zAvgRatio == null ? ''
      : zAvgRatio > 1.005 ? 'with sales clearing above asking'
      : zAvgRatio < 0.995 ? 'with concessions off list'
      : 'with sales matching list price';

    const reductionPhrase = zReduced.length ? `${zReduced.length} price reduction${zReduced.length === 1 ? '' : 's'} on the books.` : 'no price reductions.';
    const paceBit = zMedDom != null ? `Median <strong>${Math.round(zMedDom)} DOM</strong> on solds.` : '';

    const body = `${zActive.length} active, ${zPending.length} pending, ${zSold.length} sold ${dirPhrase} — ${reductionPhrase} ${paceBit}`;

    const stats = [
      { k: 'Med Sold', v: zMedPrice != null ? fmtMoneyShort(zMedPrice) : '—' },
      { k: '$/SqFt', v: zMedPpsf != null ? '$' + Math.round(zMedPpsf).toLocaleString() : '—' },
      { k: 'L→C', v: ratioTxt }
    ];

    return {
      zip: z, tag, cls, zMedDom, zAvgRatio, zReduced: zReduced.length, zSold: zSold.length, zr: zr.length,
      html: `
      <div class="zip-card ${cls}">
        <div class="zc-head">
          <span class="zc-zip">${escHtml(z)}</span>
          <span class="zc-tag">${tag}</span>
        </div>
        <div class="zc-body">${body}</div>
        <div class="zc-stats">
          ${stats.map(s => `<div class="zc-stat"><div class="k">${s.k}</div><div class="v">${s.v}</div></div>`).join('')}
        </div>
      </div>`
    };
  });
  zipCardsEl.innerHTML = cards.map(c => c.html).join('');

  // ----- Broker's Read: 2 sentences synthesized from the same metrics -----
  const brEl = document.getElementById('br-body');
  if (brEl) {
    const hotZips = cards.filter(c => c.tag === 'Hot').map(c => c.zip);
    const coolingZips = cards.filter(c => c.tag === 'Cooling').map(c => c.zip);
    const fastest = cards.filter(c => c.zMedDom != null).sort((a, b) => a.zMedDom - b.zMedDom)[0];
    const reducingMost = cards.filter(c => c.zr > 0).sort((a, b) => (b.zReduced / b.zr) - (a.zReduced / a.zr))[0];

    // Sentence 1: a broker-voiced read, anchored to the verdict + the strongest evidence
    const overPct = (overShare * 100).toFixed(0);
    const redPct = (reductionShare * 100).toFixed(0);
    const domTxt = medSoldDom != null ? `${Math.round(medSoldDom)}-day` : 'moderate';
    let s1;
    if (tempLabel === 'Seller\u2019s Market') {
      s1 = `This is a <b>seller's tape</b>. ${overPct}% of closings cleared list and homes are pricing into offers at a ${domTxt} median \u2014 buyers who hesitate are watching escalations decide it for them.`;
    } else if (tempLabel === 'Buyer\u2019s Market') {
      s1 = `Buyers have the pen here. Only ${overPct}% of closings cleared list and <b>${redPct}% of standing inventory has already taken a cut</b> \u2014 if a listing isn't moving, the market is telling the seller something specific.`;
    } else {
      s1 = `The headline reads <b>balanced</b>, but "balanced" is doing a lot of work \u2014 ${overPct}% over list, ${redPct}% reducing, ${domTxt} median pace. The market isn't one market; it's three conversations.`;
    }

    // Sentence 2: what's actually moving — zip-level color
    let s2;
    if (hotZips.length && coolingZips.length) {
      s2 = `${hotZips.join(' and ')} ${hotZips.length === 1 ? 'is' : 'are'} still drawing offers while ${coolingZips.join(' and ')} ${coolingZips.length === 1 ? 'is' : 'are'} where listings are sitting \u2014 same MLS, two different pricing conversations.`;
    } else if (hotZips.length >= 2) {
      s2 = `${hotZips.join(' and ')} are carrying the pressure${fastest ? ` (${fastest.zip} fastest at ${Math.round(fastest.zMedDom)}-day median DOM)` : ''} \u2014 prepare buyers for escalation, advise sellers to move quickly while leverage holds.`;
    } else if (hotZips.length === 1) {
      s2 = `${hotZips[0]} is doing the heavy lifting${fastest && fastest.zip === hotZips[0] ? ` at a ${Math.round(fastest.zMedDom)}-day median` : ''}. The other two zips need list prices that respect the data, not the seller's hope.`;
    } else if (coolingZips.length) {
      const r = reducingMost && reducingMost.zReduced ? ` ${reducingMost.zip} carries the most cuts (${reducingMost.zReduced} of ${reducingMost.zr} listings reduced).` : '';
      s2 = `${coolingZips.join(' and ')} ${coolingZips.length === 1 ? 'is' : 'are'} where buyers have negotiating room right now.${r}`;
    } else if (fastest) {
      s2 = `${fastest.zip} is clearing fastest at a ${Math.round(fastest.zMedDom)}-day median \u2014 the rest are moving at closer-to-normal pace.`;
    } else {
      s2 = `Not enough closed sales in this dataset to call individual zips with confidence \u2014 the next two hot sheets will sharpen the pattern.`;
    }

    brEl.innerHTML = `${s1} ${s2}`;
  }
}

function parseCsvText(text) {
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h) => h.trim()
  });
  return parsed.data;
}

function setBanner(isLive, fileName) {
  const b = document.getElementById('sample-banner');
  if (!b) return;
  if (isLive) {
    b.classList.add('is-live');
    b.innerHTML = `<strong>Live data</strong> — ${escHtml(fileName || 'your upload')}. Drop a different CSV to refresh, or reset to the sample below.`;
  } else {
    b.classList.remove('is-live');
    b.innerHTML = `<strong>Sample data</strong> — this dashboard is loaded with a synthetic NWMLS-shaped dataset for demonstration. Drop your own export below to replace it with live numbers.`;
  }
}

async function loadSample() {
  try {
    const res = await fetch(SAMPLE_CSV_URL);
    const text = await res.text();
    process(parseCsvText(text));
    document.getElementById('file-meta').textContent = 'Showing sample data: Realty-Toolkit-20-2.csv';
    setBanner(false);
  } catch (e) {
    console.error(e);
    document.getElementById('file-meta').textContent = 'Failed to load sample data. Upload a CSV to begin.';
  }
}

function handleFile(file) {
  if (!file) return;
  const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  if (!isCsv) {
    document.getElementById('file-meta').textContent = `Unsupported file: ${file.name}. Please upload a .csv export.`;
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      process(parseCsvText(ev.target.result));
      const sizeKb = (file.size / 1024).toFixed(1);
      document.getElementById('file-meta').textContent = `Loaded: ${file.name} (${sizeKb} KB)`;
      setBanner(true, file.name);
    } catch (err) {
      console.error(err);
      document.getElementById('file-meta').textContent = `Could not parse ${file.name}.`;
    }
  };
  reader.readAsText(file);
}

// ---------- wire up ----------
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('year').textContent = new Date().getFullYear();

  const dz = document.getElementById('dropzone');
  const input = document.getElementById('file-input');
  const browse = document.getElementById('browse-btn');
  const reset = document.getElementById('reset-btn');

  dz.addEventListener('click', () => input.click());
  browse.addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
  input.addEventListener('change', (e) => handleFile(e.target.files[0]));

  ['dragenter', 'dragover'].forEach(ev => {
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); });
  });
  dz.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(file);
  });

  reset.addEventListener('click', () => loadSample());

  loadSample();
});
