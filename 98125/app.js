// 98125 Market Pulse — interactive dashboard logic
const fmtMoney = n => '$' + Math.round(n).toLocaleString();
const fmtMoneyShort = n => {
  if (n >= 1e6) return '$' + (n/1e6).toFixed(2).replace(/\.?0+$/,'') + 'M';
  if (n >= 1e3) return '$' + Math.round(n/1e3) + 'K';
  return '$' + n;
};
const fmtPct = (n, d=0) => n.toFixed(d) + '%';

document.getElementById('yr').textContent = new Date().getFullYear();

// Banner-aligned palette: teals + warm accents on navy
const NEIGHBORHOOD_COLORS = {
  'Pinehurst':       '#5BA0C2',
  'Victory Heights': '#E08458',
  'Olympic Hills':   '#D6A64A',
  'Cedar Park':      '#7FB8A3',
  'Matthews Beach':  '#9EC8DE',
  'Meadowbrook':     '#C9683F',
  'Lake City':       '#A5C3D6',
  'Maple Leaf':      '#C9A87A',
  'Haller Lake':     '#3B7A99',
  'Northgate':       '#E2C281',
  'Jackson Park':    '#6FAFB8',
  'Seattle':         '#8a9aab'
};

const GRID = 'rgba(91,160,194,.12)';

Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.color = '#c8d3de';
Chart.defaults.borderColor = '#1f3a5a';

fetch('data.json').then(r=>r.json()).then(D=>{
  const S = D.summary;
  const total = S.n_sold;

  // Hero
  document.getElementById('hero-n').textContent = total;
  document.getElementById('hero-med').textContent = fmtMoneyShort(S.median_price);
  document.getElementById('hero-ppsf').textContent = '$' + Math.round(S.median_ppsf);
  document.getElementById('hero-dom').textContent = S.median_dom + ' days';
  document.getElementById('hero-sl').textContent = S.median_sale_to_list.toFixed(1) + '%';

  // Snapshot: over/at/under
  const over = S.over_asking, at = S.at_asking, under = S.under_asking;
  const tot = over+at+under;
  const pOver = over/tot*100, pAt = at/tot*100, pUnder = under/tot*100;
  document.getElementById('bar-over').style.width  = pOver + '%';
  document.getElementById('bar-at').style.width    = pAt + '%';
  document.getElementById('bar-under').style.width = pUnder + '%';
  document.getElementById('pct-over').textContent  = Math.round(pOver) + '%';
  document.getElementById('pct-at').textContent    = Math.round(pAt) + '%';
  document.getElementById('pct-under').textContent = Math.round(pUnder) + '%';

  // Range
  document.getElementById('r-min').textContent = fmtMoneyShort(S.min_price);
  document.getElementById('r-max').textContent = fmtMoneyShort(S.max_price);
  // Place median tick on range bar by percentile of min->max
  const medianPct = (S.median_price - S.min_price) / (S.max_price - S.min_price) * 100;
  document.getElementById('range-median').style.left = `calc(${medianPct}% - 1px)`;
  document.getElementById('range-median').title = 'Median ' + fmtMoneyShort(S.median_price);

  // Cash / Conventional shares
  const fin = D.financing || {};
  const finTot = Object.values(fin).reduce((a,b)=>a+b,0) || 1;
  const cashPct = ((fin['Cash']||0) / finTot) * 100;
  const convPct = ((fin['Conventional']||0) / finTot) * 100;
  document.getElementById('cash-pct').textContent = Math.round(cashPct) + '%';
  document.getElementById('conv-pct').textContent = Math.round(convPct) + '%';

  // Buyer-wants tile fills
  const kw = D.kw_counts || {};
  const pctOf = n => Math.round((n/total)*100) + '%';
  document.getElementById('t-primary').textContent = pctOf(kw['Primary suite']||0);
  document.getElementById('t-rail').textContent    = (kw['Light rail']||0) + ' of ' + total;
  document.getElementById('t-remodel').textContent = pctOf(kw['Remodeled/Updated']||0);
  document.getElementById('t-yard').textContent    = (kw['Fenced yard']||0) + ' of ' + total;
  document.getElementById('t-office').textContent  = pctOf(kw['Office/WFH']||0);
  document.getElementById('t-ev').textContent      = (kw['EV charger']||0);
  document.getElementById('t-hp').textContent      = (kw['Heat pump']||0);

  /* ===== NEIGHBORHOOD CARDS ===== */
  const hoods = Object.entries(D.by_subdivision)
    .filter(([k,v])=>v.n>=3)
    .sort((a,b)=>b[1].n - a[1].n);
  const hg = document.getElementById('hood-grid');
  const maxN = Math.max(...hoods.map(h=>h[1].n));
  hoods.forEach(([name, v]) => {
    const div = document.createElement('div');
    div.className = 'hood';
    div.dataset.name = name;
    div.innerHTML = `
      <div class="hood-name">${name}</div>
      <div class="hood-stats">
        <span><b>${fmtMoneyShort(v.median_price)}</b> median</span>
        <span><b>${v.n}</b> sales</span>
      </div>
      <div class="hood-bar"><span style="width:${(v.n/maxN)*100}%"></span></div>
      <div class="hood-stats" style="margin-top:8px">
        <span>${v.median_ppsf ? '$'+Math.round(v.median_ppsf)+'/sqft' : ''}</span>
      </div>`;
    div.addEventListener('click', ()=>{
      document.querySelectorAll('.hood').forEach(x=>x.classList.remove('active'));
      div.classList.add('active');
      updateScatterHighlight(name);
    });
    hg.appendChild(div);
  });

  /* ===== PRICE PER SQFT BY NEIGHBORHOOD ===== */
  const ppsfData = hoods.filter(h=>h[1].median_ppsf);
  new Chart(document.getElementById('ppsfChart'), {
    type:'bar',
    data:{
      labels: ppsfData.map(h=>h[0]),
      datasets:[{
        label:'$ / sqft',
        data: ppsfData.map(h=>Math.round(h[1].median_ppsf)),
        backgroundColor: ppsfData.map(h=>NEIGHBORHOOD_COLORS[h[0]] || '#5BA0C2'),
        borderRadius:6,
      }]
    },
    options:{
      indexAxis:'y',
      responsive:true,
      plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>'$'+c.parsed.x+' / sqft'}}},
      scales:{
        x:{grid:{color:GRID}, ticks:{callback:v=>'$'+v}},
        y:{grid:{display:false}}
      }
    }
  });

  /* ===== MONTHLY TREND CHARTS ===== */
  const monthly = D.monthly;
  const monthLabels = Object.keys(monthly).sort();
  const monthName = ym => {
    const [y,m] = ym.split('-');
    return new Date(+y, +m-1, 1).toLocaleString('en-US',{month:'short'}) + " '" + y.slice(2);
  };

  new Chart(document.getElementById('monthlyPriceChart'), {
    type:'line',
    data:{
      labels: monthLabels.map(monthName),
      datasets:[{
        label:'Median sale price',
        data: monthLabels.map(m=>monthly[m].median),
        borderColor:'#5BA0C2',
        backgroundColor:'rgba(91,160,194,.18)',
        fill:true,
        tension:.35,
        pointBackgroundColor:'#5BA0C2',
        pointBorderColor:'#0A1B2F',
        pointRadius:4,
        pointHoverRadius:6,
      }]
    },
    options:{
      responsive:true,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{
          label:c=>fmtMoney(c.parsed.y),
          afterBody:items=>{
            const ym = monthLabels[items[0].dataIndex];
            return 'n = ' + monthly[ym].n + ' sales';
          }
        }}
      },
      scales:{
        y:{grid:{color:GRID}, ticks:{callback:v=>fmtMoneyShort(v)}},
        x:{grid:{display:false}}
      }
    }
  });

  new Chart(document.getElementById('monthlyDomChart'), {
    type:'bar',
    data:{
      labels: monthLabels.map(monthName),
      datasets:[{
        label:'Median DOM',
        data: monthLabels.map(m=>monthly[m].median_dom),
        backgroundColor: monthLabels.map(m=> monthly[m].median_dom <= 10 ? '#5BA0C2' : '#E08458'),
        borderRadius:6,
      }]
    },
    options:{
      responsive:true,
      plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>c.parsed.y+' days'}}},
      scales:{
        y:{grid:{color:GRID}, ticks:{callback:v=>v+'d'}},
        x:{grid:{display:false}}
      }
    }
  });

  /* ===== SCATTER: price vs sqft ===== */
  const recs = D.records.filter(r=>r.sp && r.sqft && r.sqft>0 && r.sub);
  const subs = [...new Set(recs.map(r=>r.sub))].filter(s=>NEIGHBORHOOD_COLORS[s]);
  const scatterDatasets = subs.map(sub => ({
    label: sub,
    data: recs.filter(r=>r.sub===sub).map(r=>({x:r.sqft, y:r.sp, _sub:sub})),
    backgroundColor: NEIGHBORHOOD_COLORS[sub] + 'cc',
    borderColor: NEIGHBORHOOD_COLORS[sub],
    pointRadius:5, pointHoverRadius:8,
  }));
  const scatterChart = new Chart(document.getElementById('scatterChart'), {
    type:'scatter',
    data:{datasets: scatterDatasets},
    options:{
      responsive:true,
      plugins:{
        legend:{position:'bottom', labels:{boxWidth:10, boxHeight:10, padding:10, font:{size:11}}},
        tooltip:{callbacks:{
          label:c=>c.raw._sub + ' · ' + fmtMoney(c.raw.y) + ' / ' + c.raw.x.toLocaleString() + ' sqft'
        }}
      },
      scales:{
        x:{title:{display:true,text:'Finished square feet',color:'#c8d3de'}, grid:{color:GRID}, ticks:{callback:v=>v.toLocaleString()}},
        y:{title:{display:true,text:'Sale price',color:'#c8d3de'}, grid:{color:GRID}, ticks:{callback:v=>fmtMoneyShort(v)}}
      }
    }
  });

  function updateScatterHighlight(activeSub){
    scatterChart.data.datasets.forEach(ds=>{
      const base = NEIGHBORHOOD_COLORS[ds.label] || '#5BA0C2';
      if (!activeSub || ds.label === activeSub) {
        ds.backgroundColor = base + 'cc';
        ds.pointRadius = ds.label === activeSub ? 7 : 5;
      } else {
        ds.backgroundColor = base + '22';
        ds.pointRadius = 3;
      }
    });
    scatterChart.update();
  }
  // Click again to deactivate
  document.querySelectorAll('.hood').forEach(h=>{
    h.addEventListener('dblclick', ()=>{
      document.querySelectorAll('.hood').forEach(x=>x.classList.remove('active'));
      updateScatterHighlight(null);
    });
  });

  /* ===== ERA CHART ===== */
  const eraOrder = ['Pre-1950','1950-1969','1970-1989','1990-2009','2010+'];
  const eraLabels = eraOrder.filter(k=>D.era[k]);
  new Chart(document.getElementById('eraChart'), {
    type:'bar',
    data:{
      labels: eraLabels,
      datasets:[
        {
          label:'Sales',
          data: eraLabels.map(k=>D.era[k].n),
          backgroundColor:'#3B7A99',
          borderRadius:6,
          yAxisID:'y',
          order:2,
        },
        {
          label:'Median price',
          data: eraLabels.map(k=>D.era[k].median_price),
          type:'line',
          borderColor:'#E08458',
          backgroundColor:'#E08458',
          tension:.3,
          yAxisID:'y1',
          pointRadius:5,
          order:1,
        }
      ]
    },
    options:{
      responsive:true,
      plugins:{
        legend:{position:'bottom', labels:{boxWidth:10, padding:10, font:{size:11}}},
        tooltip:{callbacks:{
          label:c=> c.dataset.type==='line'
            ? 'Median: ' + fmtMoneyShort(c.parsed.y)
            : c.parsed.y + ' sales'
        }}
      },
      scales:{
        y:{position:'left', title:{display:true,text:'Sales',color:'#c8d3de'}, grid:{color:GRID}},
        y1:{position:'right', title:{display:true,text:'Median price',color:'#c8d3de'}, grid:{display:false},
            ticks:{callback:v=>fmtMoneyShort(v)}},
        x:{grid:{display:false}}
      }
    }
  });

  /* ===== FEATURES CHART (toggle) ===== */
  const featureSets = {
    interior: {
      title:'Interior features mentioned in sold listings',
      data: D.interior_top,
      color:'#5BA0C2'
    },
    site: {
      title:'Outdoor & site features',
      data: D.site_top,
      color:'#3B7A99'
    },
    keywords: {
      title:'Buyer-want keywords in listing remarks',
      data: D.kw_counts,
      color:'#E08458'
    }
  };

  let featuresChart;
  function renderFeatures(tab){
    const set = featureSets[tab];
    const items = Object.entries(set.data).sort((a,b)=>b[1]-a[1]).slice(0,12);
    const labels = items.map(x=>x[0]);
    const values = items.map(x=>x[1]);
    const pcts = values.map(v=>Math.round(v/total*100));
    if (featuresChart) featuresChart.destroy();
    featuresChart = new Chart(document.getElementById('featuresChart'), {
      type:'bar',
      data:{
        labels: labels,
        datasets:[{
          label:'Sales mentioning',
          data: values,
          backgroundColor: set.color,
          borderRadius:6,
        }]
      },
      options:{
        indexAxis:'y',
        responsive:true,
        plugins:{
          legend:{display:false},
          title:{display:true, text:set.title, color:'#fbf8f3', font:{size:14, family:'Fraunces', weight:'600'}, padding:{bottom:14}},
          tooltip:{callbacks:{
            label:c=> c.parsed.x + ' sales · ' + Math.round(c.parsed.x/total*100) + '% of market'
          }}
        },
        scales:{
          x:{grid:{color:GRID}, ticks:{precision:0}},
          y:{grid:{display:false}, ticks:{font:{size:12}}}
        }
      }
    });
  }
  renderFeatures('interior');
  document.querySelectorAll('.toggle').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.toggle').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      renderFeatures(btn.dataset.tab);
    });
  });
}).catch(err=>{
  console.error('Failed to load data', err);
});
