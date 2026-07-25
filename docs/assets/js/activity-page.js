'use strict';

/* ── DESIGN SYSTEM ACCENT (lime) ── */
/* Resolved from --accent: oklch(0.86 0.20 130) */
const DS_ACCENT      = '#a8d14f';        /* lime — main stroke / fill */
const DS_ACCENT_DIM  = 'rgba(168,209,79,0.12)';
const DS_ACCENT_LINE = 'rgba(168,209,79,0.35)';
const DS_ACCENT_MID  = 'rgba(168,209,79,0.55)';

/* ── CONSTANTS ── */
const API_BASE = 'https://j2zxz92vd4.execute-api.eu-west-2.amazonaws.com/prod';
const CF_BASE  = '';

const POWER_ZONE_COLOURS = [
  'oklch(0.55 0.05 250)',   /* Z1 slate */
  'oklch(0.68 0.10 200)',   /* Z2 teal */
  'oklch(0.78 0.16 130)',   /* Z3 green */
  'oklch(0.80 0.18 75)',    /* Z4 amber */
  'oklch(0.72 0.22 25)',    /* Z5 coral */
  'oklch(0.60 0.25 0)'      /* Z6 red */
];
const HR_ZONE_COLOURS = [
  'oklch(0.55 0.05 250)',   /* Z1 slate */
  'oklch(0.68 0.10 200)',   /* Z2 teal */
  'oklch(0.78 0.16 130)',   /* Z3 green */
  'oklch(0.80 0.18 75)',    /* Z4 amber */
  'oklch(0.72 0.22 25)'     /* Z5 coral */
];
const POWER_ZONE_NAMES   = ['Z1 Active Recovery','Z2 Endurance','Z3 Tempo','Z4 Threshold','Z5 VO2 Max','Z6 Anaerobic'];
const HR_ZONE_NAMES      = ['Z1 Recovery','Z2 Aerobic','Z3 Tempo','Z4 Threshold','Z5 Maximum'];

Chart.defaults.color = 'var(--fg-3)';
Chart.defaults.font.family = "var(--font-mono)";
Chart.defaults.font.size = 10;

/* ── UTILS ── */
function fmtDuration(secs) {
  if (secs == null) return '—';
  const h = Math.floor(secs/3600), m = Math.floor((secs%3600)/60), s = secs%60;
  if (h > 0) return `${h}h ${m.toString().padStart(2,'0')}m`;
  return `${m}:${s.toString().padStart(2,'0')}`;
}
function fmtPace(mps) {
  if (!mps || mps <= 0) return '—';
  const spk = 1000/mps, m = Math.floor(spk/60), s = Math.round(spk%60);
  return `${m}:${s.toString().padStart(2,'0')}/km`;
}
function fmtDist(m) {
  if (m == null) return '—';
  return m >= 1000 ? (m/1000).toFixed(2)+' km' : m.toFixed(0)+' m';
}
function fmtDate(iso) {
  if (!iso) return '—';
  const clean = iso.replace(/Z$/, '').replace(/[+-]\d{2}:\d{2}$/, '');
  const d = new Date(clean.length <= 10 ? clean + 'T00:00:00' : clean);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', {weekday:'long',year:'numeric',month:'long',day:'numeric'});
}
function avg(arr) {
  if (!arr?.length) return null;
  const v = arr.filter(x => x != null && x > 0);
  return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null;
}
function maxVal(arr) {
  if (!arr?.length) return null;
  return Math.max(...arr.filter(x=>x!=null));
}
function isCycling(s) { return ['Ride','VirtualRide','GravelRide','MountainBikeRide','EBikeRide'].includes(s); }
function isRunning(s)  { return ['Run','VirtualRun','TrailRun'].includes(s); }
function isRowing(s)   { return (s||'').toLowerCase().includes('row'); }
function sportIcon(s)  { if(isCycling(s))return'⬡'; if(isRunning(s))return'▷'; if(isRowing(s))return'⊕'; return'○'; }

function decimateChartData(time, data, n=800) {
  if (!time?.length) return {time:[],data:[]};
  const step = Math.max(1, Math.ceil(time.length/n));
  const t=[], d=[];
  for (let i=0; i<time.length; i+=step) { t.push(time[i]); d.push(data[i]??null); }
  return {time:t, data:d};
}

/* ── ZONE HELPERS ── */
function getPowerZone(w, ftp) {
  if (!ftp||!w) return 0;
  const p=w/ftp;
  if(p<=0.55)return 0; if(p<=0.75)return 1; if(p<=0.90)return 2;
  if(p<=1.05)return 3; if(p<=1.20)return 4; return 5;
}
function getHrZone(hr, hmax) {
  if (!hmax||!hr) return 0;
  const p=hr/hmax;
  if(p<0.60) return 0;
  if(p<0.70) return 1;
  if(p<0.80) return 2;
  if(p<0.90) return 3;
  return 4;
}

/* ── CROSSHAIR ── */
const _charts = [];
let _crosshairMarker = null, _decimatedLatlng = [], _lapStartSec = [];

function dispatchCrosshair(sec) {
  document.dispatchEvent(new CustomEvent('act-xhair', {detail:{sec}}));
}
document.addEventListener('act-xhair', e => {
  const sec = e.detail.sec;
  _charts.forEach(c => {
    if (!c||c._destroyed) return;
    const len = c.data.datasets[0]?.data?.length||0;
    const idx = Math.min(Math.round(sec / (c._timeStep||1)), len-1);
    c.tooltip.setActiveElements(
      c.data.datasets.map((_,di)=>({datasetIndex:di,index:idx})),
      {x:0,y:0}
    );
    c.update('none');
  });
  if (_crosshairMarker && _decimatedLatlng.length) {
    const step = Math.ceil((window._origGpsLen||_decimatedLatlng.length)/800);
    const idx = Math.min(Math.floor(sec/step), _decimatedLatlng.length-1);
    _crosshairMarker.setLatLng(_decimatedLatlng[idx]);
  }
  if (_lapStartSec.length) {
    let li=0;
    _lapStartSec.forEach((s,i)=>{ if(sec>=s) li=i; });
    document.querySelectorAll('#laps-list .lap-row').forEach((r,i)=>{
      r.classList.toggle('lap-hl', i===li);
    });
  }
});

/* ── GRADIENT FILL HELPER ── */
function createGradientFill(ctx, chartArea, colorTop, colorBottom) {
  if (!chartArea) return colorBottom;
  const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  gradient.addColorStop(0, colorTop);
  gradient.addColorStop(1, colorBottom);
  return gradient;
}

const gradientFillPlugin = {
  id: 'gradientFill',
  beforeDraw(chart) {
    const {ctx, chartArea} = chart;
    if (!chartArea) return;
    chart.data.datasets.forEach(ds => {
      if (ds._gradientTop && ds._gradientBottom) {
        ds.backgroundColor = createGradientFill(ctx, chartArea, ds._gradientTop, ds._gradientBottom);
      }
    });
  }
};
Chart.register(gradientFillPlugin);

/* ── H-LINES PLUGIN (Layer 2b) ──
   Draws dashed horizontal reference lines at specified y-values.
   Datasets opt in via a chart-level option: options.plugins.hLines = [
     {y: 280, color: 'rgba(0,229,255,0.5)', label: 'FTP', dash: [4,4], yAxisID: 'y'},
     ...
   ]
   Drawn above grid but below data; no interference with tooltips. */
const hLinesPlugin = {
  id: 'hLines',
  afterDatasetsDraw(chart) {
    const opts = chart.options.plugins?.hLines;
    if (!opts?.length) return;
    const {ctx, chartArea} = chart;
    if (!chartArea) return;
    ctx.save();
    opts.forEach(line => {
      const scale = chart.scales[line.yAxisID || 'y'];
      if (!scale) return;
      const y = scale.getPixelForValue(line.y);
      if (y < chartArea.top || y > chartArea.bottom) return;
      ctx.beginPath();
      ctx.setLineDash(line.dash || [4, 4]);
      ctx.strokeStyle = line.color || 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (line.label) {
        ctx.fillStyle = line.color || 'rgba(255,255,255,0.6)';
        ctx.font = '700 9px "Geist Mono", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(line.label, chartArea.right - 4, y - 2);
      }
    });
    ctx.restore();
  }
};
Chart.register(hLinesPlugin);

/* ── V-LINES PLUGIN (Layer 2b) ──
   Draws dashed vertical reference lines at specified x-values with
   an optional label. Datasets opt in via chart-level option:
     options.plugins.vLines = [{x: 300, color: 'rgba(...)', label: '5m', xAxisID: 'x'}]
   Labels render at bottom of the line in DM Mono 9px.
   Useful for marking common peak-effort durations on the duration curve. */
const vLinesPlugin = {
  id: 'vLines',
  afterDatasetsDraw(chart) {
    const opts = chart.options.plugins?.vLines;
    if (!opts?.length) return;
    const {ctx, chartArea} = chart;
    if (!chartArea) return;
    ctx.save();
    opts.forEach(line => {
      const scale = chart.scales[line.xAxisID || 'x'];
      if (!scale) return;
      const x = scale.getPixelForValue(line.x);
      if (x < chartArea.left || x > chartArea.right) return;
      ctx.beginPath();
      ctx.setLineDash(line.dash || [3, 4]);
      ctx.strokeStyle = line.color || 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      if (line.label) {
        ctx.fillStyle = line.labelColor || 'rgba(200,204,216,0.7)';
        ctx.font = '700 9px "Geist Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(line.label, x, chartArea.top + 2);
      }
    });
    ctx.restore();
  }
};
Chart.register(vLinesPlugin);

/* ── renderChartMeta helper (Layer 2b) ──
   Renders the inline metadata strip on a chart card header.
   items: [{val, lbl, vcls}]  — same shape as the stats tile builder. */
function renderChartMeta(elId, items) {
  const el = document.getElementById(elId);
  if (!el) return;
  const clean = items.filter(i => i && i.val != null && i.val !== '');
  if (!clean.length) { el.innerHTML = ''; return; }
  el.innerHTML = clean.map(i => `
    <div class="chm-item">
      <div class="chm-val ${i.vcls || ''}">${i.val}</div>
      <div class="chm-lbl">${i.lbl}</div>
    </div>
  `).join('');
}

/* ── CHART FACTORY ── */
const zoneSegmentPlugin = {
  id: 'zoneSegment',
  beforeDatasetDraw(chart, args) {
    const ds = chart.data.datasets[args.index];
    if (!ds._zoneColors || !ds._zoneColors.length) return;
    const {ctx, chartArea} = chart;
    const meta = chart.getDatasetMeta(args.index);
    if (!meta.data.length) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
    ctx.clip();
    for (let i=0; i<meta.data.length-1; i++) {
      const p1=meta.data[i], p2=meta.data[i+1];
      if(!p1||!p2) continue;
      const grad = ctx.createLinearGradient(p1.x,0,p2.x,0);
      grad.addColorStop(0, ds._zoneColors[i]||ds.borderColor);
      grad.addColorStop(1, ds._zoneColors[i+1]||ds.borderColor);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
    return false;
  }
};
Chart.register(zoneSegmentPlugin);

function makeChart(canvasId, datasets, scalesOpts, timeArr, timeStep) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const baseScales = {
    x: {
      type:'linear',
      ticks:{
        maxTicksLimit:6, 
        callback:v=>fmtDuration(v), 
        maxRotation:0,
        autoSkip: true,
        padding: 0
      },
      grid:{color:'rgba(255,255,255,0.04)'},
      border:{color:'rgba(255,255,255,0.08)'},
      afterFit: axis => { 
        axis.paddingRight = 0; 
        axis.paddingLeft = 0;
      }
    },
    y: {
      grid:{color:'rgba(255,255,255,0.04)'},
      border:{color:'rgba(255,255,255,0.08)'},
      ticks:{
        maxTicksLimit:5,
        padding: 4
      },
      afterFit: axis => { 
        // Fix y-axis width to prevent layout shifts
        axis.width = 56; 
      }
    }
  };
  
  // Merge scales, ensuring no hidden axes exist
  const mergedScales = {...baseScales};
  if (scalesOpts) {
    Object.keys(scalesOpts).forEach(key => {
      if (scalesOpts[key]) {
        mergedScales[key] = {...baseScales[key], ...scalesOpts[key]};
      }
    });
  }
  
  const chart = new Chart(ctx, {
    type:'line',
    data:{datasets},
    options:{
      responsive:true, 
      maintainAspectRatio:false,
      animation:false,
      layout:{padding:{top:0, right:0, bottom:0, left:0}},
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:'rgba(8,10,13,0.92)',
          borderColor:'rgba(255,255,255,0.1)',
          borderWidth:1,
          callbacks:{
            title: items => fmtDuration(Math.round(items[0]?.parsed?.x??0))
          }
        }
      },
      scales:mergedScales,
      onHover(e,els) {
        if(!els.length) return;
        const sec = timeArr?.[els[0].index] ?? els[0].element.x;
        dispatchCrosshair(Math.round(sec));
      }
    }
  });
  chart._timeStep = timeStep || 1;
  _charts.push(chart);
  return chart;
}

function buildDataset(time, raw, color, zoneColorsFn, label, fillColor, yAxisID) {
  const dec = decimateChartData(time, raw);
  const pts = dec.time.map((t,i)=>({x:t,y:dec.data[i]??null}));
  const zoneColors = zoneColorsFn ? dec.data.map(zoneColorsFn) : null;
  return {
    label: label||'',
    data: pts,
    borderColor: zoneColors ? 'transparent' : color,
    _zoneColors: zoneColors,
    backgroundColor: fillColor||'transparent',
    fill: !!fillColor,
    borderWidth: 1.5,
    pointRadius: 0,
    tension: 0,
    yAxisID: yAxisID||'y'
  };
}

/* ── GPS MAP ── */
let _leafletMap = null;

/* ═══════════════════════════════════════════════════════════
   MAP STATS RIBBON (Layer 2b)
   Populates the 5-cell ribbon under the GPS map. All values from
   Intervals pre-calculated fields in the stream JSON top level.
   Non-GPS activities (rowing, trainer rides) — ribbon hidden.
   ─────────────────────────────────────────────────────────── */
function buildMapRibbon(data) {
  const el = document.getElementById('map-ribbon');
  if (!el) return;

  const cells = [];
  if (data.distance != null && data.distance > 0) {
    cells.push({ val: fmtDist(data.distance), lbl: 'Distance', vcls: 'accent' });
  }
  if (data.total_elevation_gain != null && data.total_elevation_gain > 0) {
    cells.push({ val: '+' + Math.round(data.total_elevation_gain) + ' m', lbl: 'Elev Gain', vcls: 'green' });
  }
  if (data.total_elevation_loss != null && data.total_elevation_loss > 0) {
    cells.push({ val: '-' + Math.round(data.total_elevation_loss) + ' m', lbl: 'Elev Loss', vcls: '' });
  }
  if (data.max_speed != null && data.max_speed > 0) {
    cells.push({ val: (data.max_speed * 3.6).toFixed(1) + ' km/h', lbl: 'Max Speed', vcls: 'yellow' });
  }
  if (data.max_altitude != null && data.min_altitude != null) {
    cells.push({
      val: Math.round(data.min_altitude) + '–' + Math.round(data.max_altitude) + ' m',
      lbl: 'Altitude',
      vcls: ''
    });
  } else if (data.max_altitude != null) {
    cells.push({ val: Math.round(data.max_altitude) + ' m', lbl: 'Max Alt', vcls: '' });
  }

  if (!cells.length) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'grid';
  // Up to 5 cells; fewer cells = fewer columns so tiles don't look sparse
  el.style.gridTemplateColumns = `repeat(${Math.min(cells.length, 5)}, 1fr)`;
  el.innerHTML = cells.map(c => `
    <div class="mr-cell">
      <div class="mr-val ${c.vcls || ''}">${c.val}</div>
      <div class="mr-lbl">${c.lbl}</div>
    </div>
  `).join('');
}

function decimateGps(latlng, n=800) {
  if (!latlng?.length) return [];
  let pairs;
  if (typeof latlng[0]==='number') {
    pairs=[];
    for(let i=0;i+1<latlng.length;i+=2) pairs.push([latlng[i],latlng[i+1]]);
  } else pairs=latlng;
  const valid=pairs.filter(p=>Array.isArray(p)&&p.length>=2&&p[0]!=null&&p[1]!=null
    &&!(p[0]===0&&p[1]===0)&&isFinite(p[0])&&isFinite(p[1]));
  if(!valid.length) return [];
  const step=Math.ceil(valid.length/n);
  return valid.filter((_,i)=>i%step===0);
}

function initMap(latlng, powerArr, hrArr, sport, ftp, hrmax) {
  if (!latlng?.length) return;
  window._origGpsLen = typeof latlng[0]==='number' ? Math.floor(latlng.length/2) : latlng.length;
  _decimatedLatlng = decimateGps(latlng);
  const decimPow = (() => { const step=Math.ceil(window._origGpsLen/800); return (powerArr||[]).filter((_,i)=>i%step===0); })();
  const decimHr  = (() => { const step=Math.ceil(window._origGpsLen/800); return (hrArr||[]).filter((_,i)=>i%step===0); })();

  if (!_decimatedLatlng.length) {
    document.getElementById('map-section').style.display='none';
    document.getElementById('map-stats-row').style.gridTemplateColumns='1fr';
    return;
  }

  _leafletMap = L.map('activity-map',{zoomControl:true,preferCanvas:true});
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{
    attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    subdomains:'abcd', maxZoom:20, crossOrigin:true
  }).addTo(_leafletMap);

  _leafletMap.invalidateSize(false);

  const getCol = i => {
    if(isCycling(sport)&&ftp&&decimPow[i]!=null) return POWER_ZONE_COLOURS[getPowerZone(decimPow[i],ftp)];
    if(isRunning(sport)&&hrmax&&decimHr[i]!=null) return HR_ZONE_COLOURS[getHrZone(decimHr[i],hrmax)];
    return '#9ca3af';
  };

  let rStart=0, rCol=getCol(0);
  for(let i=1;i<=_decimatedLatlng.length;i++) {
    const col=i<_decimatedLatlng.length?getCol(i):null;
    if(col!==rCol||i===_decimatedLatlng.length) {
      const seg=_decimatedLatlng.slice(rStart,i+1).filter(Boolean);
      if(seg.length>=2) L.polyline(seg,{color:rCol,weight:4,opacity:0.9}).addTo(_leafletMap);
      rStart=i; rCol=col;
    }
  }

  if(_decimatedLatlng.length) {
    setTimeout(()=>{
      _leafletMap.invalidateSize(false);
      try {
        const b=L.latLngBounds(_decimatedLatlng);
        if(b.isValid()) _leafletMap.fitBounds(b,{padding:[16,16]});
        else _leafletMap.setView(_decimatedLatlng[0],13);
      } catch(e) { if(_decimatedLatlng[0]) _leafletMap.setView(_decimatedLatlng[0],13); }
    },50);
  }

  _crosshairMarker = L.circleMarker(_decimatedLatlng[0],{
    radius:6,color:'#fff',fillColor:DS_ACCENT,fillOpacity:1,weight:2
  }).addTo(_leafletMap);

  const legendEl = document.getElementById('zone-legend');
  const mapTitleEl = document.getElementById('map-title');
  const footerLabelEl = document.getElementById('map-footer-label');
  if(isCycling(sport)&&ftp) {
    mapTitleEl.textContent='GPS Route';
    if (footerLabelEl) footerLabelEl.textContent = `Power Zones · FTP ${Math.round(ftp)}W`;
    legendEl.innerHTML=['Z1','Z2','Z3','Z4','Z5','Z6'].map((z,i)=>
      `<span class="zone-pip" style="background:${POWER_ZONE_COLOURS[i]}"></span><span class="zone-lbl">${z}</span>`
    ).join('');
  } else if(isRunning(sport)&&hrmax) {
    mapTitleEl.textContent='GPS Route';
    if (footerLabelEl) footerLabelEl.textContent = `HR Zones · Max ${Math.round(hrmax)} bpm`;
    legendEl.innerHTML=['Z1','Z2','Z3','Z4','Z5'].map((z,i)=>
      `<span class="zone-pip" style="background:${HR_ZONE_COLOURS[i]}"></span><span class="zone-lbl">${z}</span>`
    ).join('');
  } else {
    if (footerLabelEl) footerLabelEl.textContent = 'GPS Route';
  }
}

/* ── SPARKLINE TOOLTIP HELPER ──────────────────────────────── */
function getSparklineTooltip(sparkKey) {
  const tooltips = {
    'velocity_smooth': 'Speed over time during activity',
    'distance': 'Cumulative distance progression',
    'altitude': 'Elevation profile throughout activity',
    'watts': 'Power output over time',
    'heartrate': 'Heart rate over time',
    'cadence': 'Cadence (RPM/SPM) over time'
  };
  return tooltips[sparkKey] || 'Activity data over time';
}

/* ═══════════════════════════════════════════════════════════
   HERO STRIP BUILDER — 6-cell Cockpit telemetry row
   Reads Intervals pre-calculated values. Sport-dispatched.
   Null values drop cells cleanly (fewer than 6 tiles if needed).
   ─────────────────────────────────────────────────────────── */
function buildHero(data) {
  const sport = data.sport_type || '';
  const s = data.streams || {};
  const cells = [];

  // Helper: push a card definition
  // { lbl, num, unit, sub, delta, cls, sparkKey, sparkReverse }
  //   delta: { dir:'up'|'down'|'neu', text:'▲ 4m' }
  //   sparkKey: key into data.streams for sparkline data
  const push = (cfg) => cells.push(cfg);

  // ── Universal: Moving Time ──────────────────────────────
  if (data.moving_time != null) {
    const h = Math.floor(data.moving_time / 3600);
    const m = Math.floor((data.moving_time % 3600) / 60);
    push({
      lbl: 'Moving Time',
      num: h > 0 ? `${h}:${String(m).padStart(2,'0')}` : `${m}`,
      unit: h > 0 ? 'h:m' : 'min',
      sub: data.elapsed_time && data.elapsed_time > data.moving_time
        ? `+ ${Math.round((data.elapsed_time - data.moving_time)/60)} min stopped` : '',
      cls: 'c-accent',
      sparkKey: 'velocity_smooth',
    });
  }

  // ── Universal: Distance ─────────────────────────────────
  if (data.distance != null && data.distance > 0) {
    const km = (data.distance / 1000).toFixed(1);
    push({
      lbl: 'Distance',
      num: km,
      unit: 'km',
      sub: data.icu_lap_count ? `${data.icu_lap_count} laps` : '',
      cls: 'c-green',
      sparkKey: 'distance',
    });
  }

  // ── Universal: Elevation ────────────────────────────────
  if (data.total_elevation_gain != null && data.total_elevation_gain > 0) {
    const gain = Math.round(data.total_elevation_gain);
    const maxA  = data.max_altitude != null ? Math.round(data.max_altitude) : null;
    push({
      lbl: 'Elevation',
      num: gain,
      unit: 'm↑',
      sub: maxA != null ? `${((gain / (data.distance||1))*100).toFixed(1)}% max · ${maxA} m` : '',
      cls: 'c-accent',
      sparkKey: 'altitude',
    });
  }

  // ── Sport-specific cards ────────────────────────────────
  if (isCycling(sport)) {
    if (data.icu_average_watts != null) {
      const np = data.icu_weighted_avg_watts ? Math.round(data.icu_weighted_avg_watts) : null;
      const IF = data.icu_intensity != null ? (data.icu_intensity/100).toFixed(2) : null;
      push({
        lbl: 'Avg Power',
        num: Math.round(data.icu_average_watts),
        unit: 'W',
        sub: [np ? `NP ${np} W` : null, IF ? `IF ${IF}` : null].filter(Boolean).join(' · '),
        cls: 'c-accent',
        sparkKey: 'watts',
      });
    }
    if (data.average_heartrate != null) {
      const dom = (() => {
        if (!s.heartrate?.length || !data.athlete_max_hr) return null;
        const counts = [0,0,0,0,0];
        s.heartrate.forEach(v => { if (v>0) counts[Math.min(getHrZone(v, data.athlete_max_hr),4)]++; });
        const d = counts.indexOf(Math.max(...counts));
        return `Z${d+1} ${Math.round(counts[d]/s.heartrate.length*100)}%`;
      })();
      push({
        lbl: 'Avg Heart',
        num: Math.round(data.average_heartrate),
        unit: 'bpm',
        sub: [data.max_heartrate ? `max ${Math.round(data.max_heartrate)}` : null, dom].filter(Boolean).join(' · '),
        cls: 'c-red',
        sparkKey: 'heartrate',
      });
    }
  } else if (isRunning(sport)) {
    if (data.average_speed != null && data.average_speed > 0) {
      const paceStr = fmtPace(data.average_speed);
      const [pm, ps] = paceStr.replace('/km','').split(':');
      push({
        lbl: 'Avg Pace',
        num: `${pm}:${ps}`,
        unit: '/km',
        sub: data.max_speed > 0 ? `best ${fmtPace(data.max_speed)}` : '',
        cls: 'c-green',
        sparkKey: 'velocity_smooth',
        sparkReverse: true,
      });
    }
    if (data.average_heartrate != null) {
      const dom = (() => {
        if (!s.heartrate?.length || !data.athlete_max_hr) return null;
        const counts = [0,0,0,0,0];
        s.heartrate.forEach(v => { if (v>0) counts[Math.min(getHrZone(v, data.athlete_max_hr),4)]++; });
        const d = counts.indexOf(Math.max(...counts));
        return `Z${d+1} ${Math.round(counts[d]/s.heartrate.length*100)}%`;
      })();
      push({
        lbl: 'Avg Heart',
        num: Math.round(data.average_heartrate),
        unit: 'bpm',
        sub: [data.max_heartrate ? `max ${Math.round(data.max_heartrate)}` : null, dom].filter(Boolean).join(' · '),
        cls: 'c-red',
        sparkKey: 'heartrate',
      });
    }
    if (data.icu_training_load != null && data.icu_training_load > 0) {
      push({
        lbl: 'TSS',
        num: Math.round(data.icu_training_load),
        unit: '',
        sub: data.trimp ? `TRIMP ${Math.round(data.trimp)}` : '',
        cls: 'c-orange',
        sparkKey: null,
      });
    }
  } else if (isRowing(sport)) {
    if (data.average_speed != null && data.average_speed > 0) {
      const splitSecs = 500 / data.average_speed;
      const m = Math.floor(splitSecs/60), sc = (splitSecs%60).toFixed(1);
      push({
        lbl: '/500m Split',
        num: `${m}:${String(sc).padStart(4,'0')}`,
        unit: '',
        sub: data.icu_average_watts ? `avg ${Math.round(data.icu_average_watts)} W` : '',
        cls: 'c-green',
        sparkKey: 'watts',
      });
    }
    if (data.average_heartrate != null) {
      push({
        lbl: 'Avg Heart',
        num: Math.round(data.average_heartrate),
        unit: 'bpm',
        sub: data.max_heartrate ? `max ${Math.round(data.max_heartrate)}` : '',
        cls: 'c-red',
        sparkKey: 'heartrate',
      });
    }
    if (data.icu_training_load != null && data.icu_training_load > 0) {
      push({ lbl:'TSS', num:Math.round(data.icu_training_load), unit:'', sub:'', cls:'c-orange', sparkKey:null });
    }
  } else {
    if (data.average_heartrate != null) {
      push({ lbl:'Avg Heart', num:Math.round(data.average_heartrate), unit:'bpm', sub:'', cls:'c-red', sparkKey:'heartrate' });
    }
    if (data.icu_training_load != null && data.icu_training_load > 0) {
      push({ lbl:'TSS', num:Math.round(data.icu_training_load), unit:'', sub:'', cls:'c-orange', sparkKey:null });
    }
  }

  const el = document.getElementById('act-hero');
  if (!el || !cells.length) { if(el) el.style.display='none'; return; }
  el.style.gridTemplateColumns = `repeat(${Math.min(cells.length, 6)}, 1fr)`;

  // Sparkline colour map (matches card colour class)
  const sparkColors = {
    'c-accent': { stroke:DS_ACCENT, fill:DS_ACCENT_DIM   },
    'c-green':  { stroke:'#00ff87', fill:'rgba(0,255,135,0.12)'   },
    'c-red':    { stroke:'#ef4444', fill:'rgba(239,68,68,0.10)'   },
    'c-yellow': { stroke:'#ffd600', fill:'rgba(255,214,0,0.10)'   },
    'c-orange': { stroke:'#ff6b2b', fill:'rgba(255,107,43,0.10)'  },
    'c-purple': { stroke:'#a855f7', fill:'rgba(168,85,247,0.10)'  },
  };

  el.innerHTML = cells.map((c, idx) => {
    const deltaHtml = c.delta
      ? `<span class="ah-delta ${c.delta.dir}">${c.delta.text}</span>` : '';
    return `
      <div class="ah-cell ${c.cls || ''}" data-hero-idx="${idx}">
        <div class="ah-top">
          <div class="ah-lbl">${c.lbl}</div>
          ${deltaHtml}
        </div>
        <div class="ah-num-row">
          <span class="ah-num">${c.num}</span>
          ${c.unit ? `<span class="ah-unit">${c.unit}</span>` : ''}
        </div>
        <div class="ah-sub">${c.sub || ''}</div>
        ${c.sparkKey && s[c.sparkKey]?.length ? `<canvas class="ah-spark" id="ah-spark-${idx}" title="${getSparklineTooltip(c.sparkKey)}"></canvas>` : '<div class="ah-spark"></div>'}
      </div>`;
  }).join('');

  // Draw sparklines — use setTimeout to ensure layout is complete
  setTimeout(() => {
    cells.forEach((c, idx) => {
      if (!c.sparkKey || !s[c.sparkKey]?.length) return;
      const canvas = document.getElementById(`ah-spark-${idx}`);
      if (!canvas) return;
      const raw = s[c.sparkKey];

      // Sample down to ~60 points
      const step = Math.max(1, Math.floor(raw.length / 60));
      const pts = [];
      for (let i = 0; i < raw.length; i += step) {
        const v = raw[i];
        if (v != null && v > 0) pts.push(v);
      }
      if (pts.length < 2) return;

      // Use fixed dimensions matching CSS (100% wide, 36px tall)
      const W = canvas.parentElement?.offsetWidth || 160;
      const H = 36;
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width  = W + 'px';
      canvas.style.height = H + 'px';
      const ctx2 = canvas.getContext('2d');
      ctx2.scale(dpr, dpr);

      const col = sparkColors[c.cls] || sparkColors['c-accent'];
      const min = Math.min(...pts), max = Math.max(...pts);
      const range = Math.max(max - min, 1);
      const pad = 2;
      const xStep = (W - pad * 2) / (pts.length - 1);
      const yFor  = v => H - pad - ((c.sparkReverse ? (max - v) : (v - min)) / range) * (H - pad * 2);

      // Gradient fill
      const grad = ctx2.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, col.stroke.replace(/[\d.]+\)$/, '0.25)'));
      grad.addColorStop(1, col.stroke.replace(/[\d.]+\)$/, '0)'));
      ctx2.beginPath();
      ctx2.moveTo(pad, yFor(pts[0]));
      pts.forEach((v, i) => ctx2.lineTo(pad + i * xStep, yFor(v)));
      ctx2.lineTo(pad + (pts.length - 1) * xStep, H);
      ctx2.lineTo(pad, H);
      ctx2.closePath();
      ctx2.fillStyle = grad;
      ctx2.fill();

      // Line
      ctx2.beginPath();
      ctx2.moveTo(pad, yFor(pts[0]));
      pts.forEach((v, i) => ctx2.lineTo(pad + i * xStep, yFor(v)));
      ctx2.strokeStyle = col.stroke;
      ctx2.lineWidth = 1.5;
      ctx2.lineJoin = 'round';
      ctx2.stroke();
    });
  }, 100);
}

/* ═══════════════════════════════════════════════════════════
   STATS PANEL BUILDER (Layer 2b) — Intervals telemetry sidekick
   Reads pre-calculated Intervals values verbatim. No browser-side
   recalculation. The only derived value is W/kg from two Intervals
   fields (weighted_avg_watts / weight) — a trivial division, not a
   reconstruction.
   Signature unchanged (data, ftp) — ftp arg ignored (data.icu_ftp
   used directly). Kept for call-site compatibility.
   ─────────────────────────────────────────────────────────── */
function buildWorkoutStats(data, _ftp) {
  const sport = data.sport_type || '';
  const tiles = [];
  const push = (val, lbl, vcls) => {
    if (val != null && val !== '' && !Number.isNaN(val)) {
      tiles.push({ val, lbl, vcls: vcls || '' });
    }
  };

  if (isCycling(sport)) {
    if (data.icu_weighted_avg_watts != null) {
      push(Math.round(data.icu_weighted_avg_watts) + 'W', 'Normalised Power', 'accent');
    }
    if (data.icu_intensity != null) {
      push((data.icu_intensity / 100).toFixed(2), 'Intensity Factor', 'yellow');
    }
    if (data.icu_variability_index != null) {
      push((+data.icu_variability_index).toFixed(2), 'Variability Index');
    }
    if (data.icu_efficiency_factor != null) {
      push((+data.icu_efficiency_factor).toFixed(2), 'Efficiency Factor', 'green');
    }
    if (data.icu_weighted_avg_watts != null && data.icu_weight) {
      const wkg = data.icu_weighted_avg_watts / data.icu_weight;
      push(wkg.toFixed(2) + ' W/kg', 'Watts per kg', 'accent');
    }
    if (data.icu_joules != null) {
      push(Math.round(data.icu_joules / 1000) + ' kJ', 'Total Work', 'orange');
    }
    if (data.average_heartrate != null) {
      push(Math.round(data.average_heartrate) + ' bpm', 'Avg Heart Rate', 'red');
    }
    if (data.max_heartrate != null) {
      push(Math.round(data.max_heartrate) + ' bpm', 'Max Heart Rate', 'red');
    }
    if (data.decoupling != null) {
      const d = +data.decoupling;
      push((d >= 0 ? '+' : '') + d.toFixed(1) + '%', 'Pwr:HR Decoup.',
        Math.abs(d) < 5 ? 'green' : 'red');
    }
    if (data.icu_training_load != null && data.icu_training_load > 0) {
      push(Math.round(data.icu_training_load), 'TSS', 'orange');
    }
    if (data.icu_w_prime != null) {
      push((data.icu_w_prime / 1000).toFixed(1) + ' kJ', "W' Balance", 'accent');
    }
  } else if (isRunning(sport)) {
    if (data.icu_intensity != null) {
      push((data.icu_intensity / 100).toFixed(2), 'Intensity Factor', 'yellow');
    }
    if (data.icu_training_load != null && data.icu_training_load > 0) {
      push(Math.round(data.icu_training_load), 'TSS', 'orange');
    }
    if (data.average_heartrate != null) {
      push(Math.round(data.average_heartrate) + ' bpm', 'Avg Heart Rate', 'red');
    }
    if (data.max_heartrate != null) {
      push(Math.round(data.max_heartrate) + ' bpm', 'Max Heart Rate', 'red');
    }
    if (data.total_elevation_gain != null && data.total_elevation_gain > 0) {
      push(Math.round(data.total_elevation_gain) + ' m', 'Elev Gain', 'green');
    }
    if (data.total_elevation_loss != null && data.total_elevation_loss > 0) {
      push('-' + Math.round(data.total_elevation_loss) + ' m', 'Elev Loss');
    }
    if (data.average_stride != null) {
      push((+data.average_stride).toFixed(2) + ' m', 'Stride Length', 'purple');
    }
    if (data.decoupling != null) {
      const d = +data.decoupling;
      push((d >= 0 ? '+' : '') + d.toFixed(1) + '%', 'Pace:HR Decoup.',
        Math.abs(d) < 5 ? 'green' : 'red');
    }
    if (data.trimp != null) {
      push(Math.round(data.trimp), 'TRIMP');
    }
    if (data.polarization_index != null && +data.polarization_index > 0) {
      push((+data.polarization_index).toFixed(1), 'Polarization Idx');
    }
  } else if (isRowing(sport)) {
    if (data.icu_average_watts != null) {
      push(Math.round(data.icu_average_watts) + 'W', 'Avg Power', 'accent');
    }
    if (data.icu_joules != null) {
      push(Math.round(data.icu_joules / 1000) + ' kJ', 'Total Work', 'orange');
    }
    if (data.average_cadence != null) {
      push(Math.round(data.average_cadence) + ' spm', 'Stroke Rate', 'purple');
    }
    if (data.icu_training_load != null && data.icu_training_load > 0) {
      push(Math.round(data.icu_training_load), 'TSS', 'orange');
    }
    if (data.trimp != null) {
      push(Math.round(data.trimp), 'TRIMP');
    }
    if (data.average_heartrate != null) {
      push(Math.round(data.average_heartrate) + ' bpm', 'Avg Heart Rate', 'red');
    }
  } else {
    if (data.icu_training_load != null && data.icu_training_load > 0) {
      push(Math.round(data.icu_training_load), 'TSS', 'orange');
    }
    if (data.icu_average_watts != null) {
      push(Math.round(data.icu_average_watts) + 'W', 'Avg Power', 'accent');
    }
    if (data.average_heartrate != null) {
      push(Math.round(data.average_heartrate) + ' bpm', 'Avg Heart Rate', 'red');
    }
    if (data.trimp != null) {
      push(Math.round(data.trimp), 'TRIMP');
    }
  }

  // Title + sub
  const titleEl = document.getElementById('ws-title');
  const subEl   = document.getElementById('ws-sub');
  if (titleEl) {
    titleEl.className = 'act-stats-title' +
      (isRunning(sport) ? ' c-green' : isRowing(sport) ? ' c-purple' : '');
    titleEl.textContent = isCycling(sport) ? 'Ride Telemetry' :
                          isRunning(sport) ? 'Run Telemetry' :
                          isRowing(sport)  ? 'Row Telemetry' :
                          'Workout Telemetry';
  }
  if (subEl) {
    const bits = [];
    if (data.icu_ftp != null) bits.push(`FTP ${Math.round(data.icu_ftp)}${isCycling(sport) ? 'W' : ''}`);
    if (data.athlete_max_hr != null) bits.push(`HRmax ${Math.round(data.athlete_max_hr)}`);
    subEl.textContent = bits.join(' · ');
  }

  const el = document.getElementById('workout-stats');
  if (!el) return;

  if (!tiles.length) {
    el.className = 'act-stats-grid cols-1';
    el.innerHTML = '<div class="asg-empty">No pre-calculated metrics available for this activity.</div>';
    return;
  }
  el.className = 'act-stats-grid';
  el.innerHTML = tiles.map(t => `
    <div class="asg-tile">
      <div class="asg-val ${t.vcls}">${t.val}</div>
      <div class="asg-lbl">${t.lbl}</div>
    </div>
  `).join('');
}

/* ── ELEVATION PROFILE CHART ── */
function buildElevationChart(data, ftp, hrmax) {
  const s = data.streams||{};
  const time = s.time||[], alt = s.altitude||s.fixed_altitude||[];
  const sport = data.sport_type;

  if(!alt.length||!time.length) {
    document.getElementById('elevation-section').style.display='none';
    return;
  }
  const isCyc=isCycling(sport), isRun=isRunning(sport);

  const METRICS = [
    {id:'elev', lbl:'Elevation', color:'rgba(34,197,94,0.7)', key:null,              yId:'yElev', fill:'rgba(34,197,94,0.12)', always:true},
    {id:'power',lbl:'Power',     color:DS_ACCENT,             key:'watts',           yId:'yR1',   show:isCyc||!!s.watts?.length},
    {id:'pace', lbl:isCyc?'Speed':'Pace', color:'#fbbf24',   key:'velocity_smooth', yId:'yR4',   show:true, reverse:isRun},
    {id:'hr',   lbl:'HR',        color:'#ef4444',             key:'heartrate',       yId:'yR2',   show:true},
    {id:'cad',  lbl:isCyc?'Cadence':isRun?'Cadence':'S/Rate',color:'#a78bfa',      key:'cadence',yId:'yR3',  show:true},
  ].filter(m=>m.always||m.show);

  window._activeMetrics = window._activeMetrics||{};
  METRICS.forEach(m=>{
    if(window._activeMetrics[m.id]===undefined)
      window._activeMetrics[m.id] = m.always ? true : m.id!=='cad';
  });
  const active = window._activeMetrics;

  const decAlt = decimateChartData(time, alt, 600);
  const decStreams = {};
  METRICS.forEach(m=>{
    if(!m.key||!s[m.key]) return;
    let raw=s[m.key];
    if(m.id==='pace'&&isRun) raw=raw.map(v=>v>0?+(1000/v/60).toFixed(3):null);
    if(m.id==='pace'&&isCyc) raw=raw.map(v=>v!=null?+(v*3.6).toFixed(2):null);
    decStreams[m.id]=decimateChartData(time,raw,600);
  });

  function buildDatasets() {
    return METRICS.filter(m=>active[m.id]).map(m=>{
      if(m.id==='elev') return {
        label:'Elevation',data:decAlt.time.map((t,i)=>({x:t,y:decAlt.data[i]??null})),
        borderColor:'rgba(150,160,170,0.7)',backgroundColor:'rgba(106,116,132,0.12)',
        fill:true,borderWidth:1,pointRadius:0,tension:0.4,yAxisID:'yElev',order:10
      };
      const dec=decStreams[m.id]; if(!dec) return null;
      return {
        label:m.lbl,data:dec.time.map((t,i)=>({x:t,y:dec.data[i]??null})),
        borderColor:m.color,backgroundColor:'transparent',
        fill:false,borderWidth:1.5,pointRadius:0,tension:0,yAxisID:m.yId,order:1
      };
    }).filter(Boolean);
  }

  const elevVals=decAlt.data.filter(v=>v!=null);
  const eMin=Math.min(...elevVals), eMax=Math.max(...elevVals);
  const range = Math.max(eMax - eMin, 10);
  const elevYMin = eMin - range * 0.18;

  function buildScales() {
    const sc = {
      x:{type:'linear',ticks:{maxTicksLimit:8,callback:v=>fmtDuration(v),maxRotation:0,color:'rgba(200,210,220,0.9)'},
        grid:{color:'rgba(255,255,255,0.06)'},border:{color:'rgba(255,255,255,0.12)'},
        afterFit: axis => { axis.paddingRight = 0; }},
      yElev:{position:'left',min:elevYMin,grid:{color:'rgba(255,255,255,0.06)'},
        border:{color:'rgba(255,255,255,0.12)'},
        ticks:{maxTicksLimit:4,callback:v=>Math.round(v)+'m',color:'rgba(200,210,220,0.9)'},
        afterFit: axis => { axis.width = 56; }}
    };
    if(active['power']) sc.yR1={position:'right',grid:{display:false},border:{display:false},
      ticks:{maxTicksLimit:4,color:DS_ACCENT,callback:v=>Math.round(v)+'W'},
      afterFit: axis => { axis.width = 56; }};
    if(active['hr'])    sc.yR2={position:'right',grid:{display:false},border:{display:false},
      ticks:{maxTicksLimit:4,color:'oklch(0.72 0.20 25)',callback:v=>Math.round(v)},
      afterFit: axis => { axis.width = 56; }};
    if(active['cad'])   sc.yR3={position:'right',grid:{display:false},border:{display:false},
      ticks:{maxTicksLimit:4,color:'oklch(0.72 0.18 290)',callback:v=>Math.round(v)},
      afterFit: axis => { axis.width = 56; }};
    if(active['pace'])  sc.yR4={position:'right',reverse:isRun,grid:{display:false},border:{display:false},
      ticks:{maxTicksLimit:4,color:'oklch(0.76 0.19 50)',
        callback:v=>isRun?`${Math.floor(v)}:${String(Math.round((v%1)*60)).padStart(2,'0')}`:v.toFixed(0)+' km/h'},
      afterFit: axis => { axis.width = 56; }};
    return sc;
  }

  const ctx=document.getElementById('chart-elevation');
  if(!ctx) return;
  window._elevChart=new Chart(ctx,{
    type:'line',data:{datasets:buildDatasets()},
    options:{responsive:true,maintainAspectRatio:false,
      animation:{duration:1200,easing:'easeInQuart'},
      layout:{padding:{right:0,left:0}},
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},tooltip:{backgroundColor:'rgba(15,22,32,0.88)',
        borderColor:'rgba(20,20,20,0.15)',borderWidth:1,
        callbacks:{title:items=>fmtDuration(Math.round(items[0]?.parsed?.x??0))}}},
      scales:buildScales()}
  });
  window._rebuildElevChart=()=>{
    if(!window._elevChart) return;
    window._elevChart.data.datasets=buildDatasets();
    window._elevChart.options.scales=buildScales();
    window._elevChart.update();
  };

  const togglesEl=document.getElementById('metric-toggles');
  if(togglesEl) togglesEl.innerHTML=METRICS.filter(m=>!m.always).map(m=>
    `<button class="metric-toggle ${active[m.id]?'active':''}" data-metric="${m.id}"
      style="color:${m.color};border-color:${m.color}"
      onclick="toggleMetric('${m.id}',this)">${m.lbl}</button>`
  ).join('');
}

function toggleMetric(id,btn) {
  btn.classList.toggle('active');
  if(window._activeMetrics) window._activeMetrics[id]=btn.classList.contains('active');
  if(window._rebuildElevChart) window._rebuildElevChart();
}

/* ═══════════════════════════════════════════════════════════
   PRIMARY TRACE (Layer 2b) — Power (cycling) / Pace (running)
   Zone-coloured segments + gradient fill + dashed reference lines
   for FTP/Avg. Header strip shows Avg / NP / Max inline.
   All metrics from Intervals — no browser-side recalculation.
   ─────────────────────────────────────────────────────────── */
async function buildPrimaryTrace(data, ftp, hrmax) {
  const s = data.streams || {}, time = s.time || [], sport = data.sport_type;
  const isCyc = isCycling(sport), isRun = isRunning(sport);

  if (!s.watts?.length && !s.velocity_smooth?.length) {
    // No power and no pace stream (e.g. Workout/Cardio activities carrying
    // only time+heartrate) — neither the primary trace nor the duration
    // curve has anything to plot. curve-row is a SIBLING of power-row, not
    // a child, so it must be hidden explicitly or it renders an empty
    // canvas under placeholder text.
    document.getElementById('power-row').style.display = 'none';
    const curveRow = document.getElementById('curve-row');
    if (curveRow) curveRow.style.display = 'none';
    return;
  }

  // Sport-coloured title accent bar (runs green, ride accent)
  const primaryTitleEl = document.getElementById('primary-trace-title');
  const curveTitleEl   = document.getElementById('curve-title');
  if (primaryTitleEl) {
    primaryTitleEl.className = 'act-stats-title' + (isRun ? ' c-green' : '');
  }
  if (curveTitleEl) {
    curveTitleEl.className = 'act-stats-title' + (isRun ? ' c-green' : '');
  }

  if (isRun && s.velocity_smooth?.length) {
    // ── Running: Pace trace ────────────────────────────────
    primaryTitleEl.textContent = 'Pace';
    curveTitleEl.textContent   = '90-Day Pace Curve';

    // Build pace array in min/km (null where velocity <= 0)
    const paceArr = s.velocity_smooth.map(v => v > 0 ? +(1000 / v / 60).toFixed(3) : null);
    const dec = decimateChartData(time, paceArr);

    // Zone colour by HR zone
    const zc = hrmax ? (() => {
      const dhr = decimateChartData(time, s.heartrate || []);
      return dhr.data.map(v => v != null ? HR_ZONE_COLOURS[getHrZone(v, hrmax)] : '#9ca3af');
    })() : null;

    // Avg pace from Intervals (pre-calculated)
    const avgMps = data.average_speed;
    const avgPace = avgMps > 0 ? 1000 / avgMps / 60 : null;

    // Header meta strip
    renderChartMeta('primary-hmeta', [
      avgPace != null ? { val: `${Math.floor(avgPace)}:${String(Math.round((avgPace%1)*60)).padStart(2,'0')}`, lbl: 'Avg Pace', vcls: 'green' } : null,
      data.max_speed > 0 ? (() => {
        const bestPace = 1000 / data.max_speed / 60;
        return { val: `${Math.floor(bestPace)}:${String(Math.round((bestPace%1)*60)).padStart(2,'0')}`, lbl: 'Best', vcls: 'green' };
      })() : null,
      data.average_heartrate != null ? { val: Math.round(data.average_heartrate), lbl: 'Avg HR', vcls: 'red' } : null
    ]);

    // Build reference lines (Avg pace only — no FTP analogue for running)
    const hLines = [];
    if (avgPace != null) {
      hLines.push({ y: avgPace, color: 'rgba(0,255,135,0.45)', label: 'AVG', dash: [4, 4] });
    }

    const chart = makeChart('chart-primary', [{
      label: 'Pace',
      data: dec.time.map((t, i) => ({ x: t, y: dec.data[i] ?? null })),
      borderColor: zc ? 'transparent' : '#00ff87',
      _zoneColors: zc,
      backgroundColor: 'transparent', fill: true,
      _gradientTop: 'rgba(0,255,135,0.35)',
      _gradientBottom: 'rgba(0,255,135,0.0)',
      borderWidth: 2, pointRadius: 0, tension: 0, yAxisID: 'y'
    }], {
      y: {
        position: 'left', reverse: true,
        min: avgPace != null ? avgPace - 2.0 : undefined,
        max: avgPace != null ? avgPace + 2.5 : undefined,
        grid: { color: 'rgba(20,20,20,0.07)' },
        border: { color: 'rgba(20,20,20,0.1)' },
        ticks: {
          maxTicksLimit: 5, color: 'oklch(0.82 0.18 150)',
          callback: v => `${Math.floor(v)}:${String(Math.round((v%1)*60)).padStart(2,'0')}`
        },
        afterFit: axis => { axis.width = 56; }
      }
    }, time);
    if (chart && hLines.length) {
      chart.options.plugins.hLines = hLines;
      chart.update('none');
    }

    await buildDurationCurve('chart-curve', 'pace', s.velocity_smooth, null, 'min/km',
      v => `${Math.floor(v)}:${String(Math.round((v%1)*60)).padStart(2,'0')}`,
      '#00ff87', true, s.distance);

  } else if (isCyc && s.watts?.length) {
    // ── Cycling: Power trace ──────────────────────────────
    primaryTitleEl.textContent = 'Power';
    curveTitleEl.textContent   = '90-Day Power Curve';

    const dec = decimateChartData(time, s.watts);
    const zc  = ftp ? dec.data.map(v => v != null ? POWER_ZONE_COLOURS[getPowerZone(v, ftp)] : '#9ca3af') : null;

    // Header meta — Avg / NP / Max all from Intervals
    renderChartMeta('primary-hmeta', [
      data.icu_average_watts != null ? { val: Math.round(data.icu_average_watts) + 'W', lbl: 'Avg', vcls: 'accent' } : null,
      data.icu_weighted_avg_watts != null ? { val: Math.round(data.icu_weighted_avg_watts) + 'W', lbl: 'NP', vcls: 'accent' } : null,
      (() => {
        const mx = maxVal(s.watts);
        return mx != null ? { val: Math.round(mx) + 'W', lbl: 'Max', vcls: 'yellow' } : null;
      })()
    ]);

    // Reference lines: FTP + Avg
    const hLines = [];
    if (ftp) {
      hLines.push({ y: ftp, color: 'rgba(255,214,0,0.55)', label: `FTP ${Math.round(ftp)}W`, dash: [6, 4] });
    }
    if (data.icu_average_watts != null) {
      hLines.push({ y: data.icu_average_watts, color: DS_ACCENT_LINE, label: 'AVG', dash: [4, 4] });
    }

    const chart = makeChart('chart-primary', [{
      label: 'Power',
      data: dec.time.map((t, i) => ({ x: t, y: dec.data[i] ?? null })),
      borderColor: zc ? 'transparent' : DS_ACCENT,
      _zoneColors: zc,
      backgroundColor: 'transparent', fill: true,
      _gradientTop: 'rgba(0,255,135,0.35)',
      _gradientBottom: 'rgba(0,255,135,0.0)',
      borderWidth: 2, pointRadius: 0, tension: 0, yAxisID: 'y'
    }], {
      y: {
        position: 'left',
        grid: { color: 'rgba(255,255,255,0.04)' },
        border: { color: 'rgba(255,255,255,0.08)' },
        ticks: { maxTicksLimit: 5, color: DS_ACCENT, callback: v => Math.round(v) + 'W' },
        afterFit: axis => { axis.width = 56; }
      }
    }, time);
    if (chart && hLines.length) {
      chart.options.plugins.hLines = hLines;
      chart.update('none');
    }

    await buildDurationCurve('chart-curve', 'power', s.watts, ftp, 'W',
      v => Math.round(v) + 'W', DS_ACCENT);
  }
}

/* ═══════════════════════════════════════════════════════════
   DURATION CURVE (Layer 2b) — activity vs 90-day best
   Renders log-scale duration→best-value chart with:
     - 90d best as dashed reference line + light fill
     - This activity's best curve zone-coloured endpoint
     - Vertical markers at common peak durations (5s/1m/5m/20m/60m
       for power; 1k/5k/10k/HM for pace)
     - Header meta strip with 2-3 peak values the athlete cares about
   All 90d data comes from the pre-computed curves JSON in S3.
   ─────────────────────────────────────────────────────────── */
async function buildDurationCurve(canvasId, type, rawStream, ref, unit, tickFmt, colour, reverseY, distStream) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !rawStream?.length) return;

  const isPace = type === 'pace';
  const maxDur = rawStream.length;
  const totalDistM = distStream?.length ? distStream[distStream.length - 1] : 0;
  const buckets = [];

  if (isPace && totalDistM > 0) {
    const distBuckets = [100, 200, 400, 800, 1000, 1500, 2000, 3000, 5000, 8000, 10000, 16000, 21097, 42195];
    distBuckets.forEach(d => { if (d <= totalDistM) buckets.push(d); });
  } else {
    for (let s = 5; s <= maxDur; s = s < 60 ? s + 5 : s < 300 ? s + 15 : s < 3600 ? s + 30 : s + 120) buckets.push(s);
  }

  const activityBest = buckets.map(bucket => {
    if (isPace && distStream?.length) {
      let bestSec = Infinity;
      for (let i = 0; i < distStream.length; i++) {
        const targetDist = (distStream[i] || 0) + bucket;
        let j = i + 1;
        while (j < distStream.length && (distStream[j] || 0) < targetDist) j++;
        if (j >= distStream.length) break;
        const elapsed = j - i;
        if (elapsed < bestSec) bestSec = elapsed;
      }
      if (!isFinite(bestSec)) return null;
      const mps = bucket / bestSec;
      return mps > 0 ? +(1000 / mps / 60).toFixed(3) : null;
    } else {
      const dur = bucket;
      if (dur > rawStream.length) return null;
      let best = 0;
      for (let i = 0; i <= rawStream.length - dur; i++) {
        const slice = rawStream.slice(i, i + dur);
        const valid = slice.filter(v => v != null && v > 0);
        if (valid.length < dur * 0.8) continue;
        const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
        if (mean > best) best = mean;
      }
      return best > 0 ? Math.round(best) : null;
    }
  });

  // Load 90-day best curve (pre-computed in S3)
  let best90 = null;
  try {
    const filename = isPace ? 'pace_curves_90d.json' : 'power_curves_90d.json';
    const r = await fetch(`${CF_BASE}data/${filename}`);
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
      const cd = await r.json();
      const curve = cd?.list?.[0];
      if (curve?.values?.length) {
        if (isPace) {
          const dists = curve.distance || [], times = curve.values || [];
          best90 = buckets.map(distBucket => {
            const idx = dists.findIndex(d => d >= distBucket);
            if (idx === -1) return null;
            const sec = times[idx];
            if (!sec || sec <= 0) return null;
            // values[] is elapsed seconds for the distance (not sec/km)
            // e.g. for 5000m in 1200s → mps = 5000/1200 → min/km = (1000/mps)/60
            const mps = dists[idx] / sec;
            const minPerKm = 1000 / mps / 60;
            // Sanity check: if minPerKm > 30 the values are likely already in sec/km
            // In that case treat values[idx] directly as seconds per km
            if (minPerKm > 30) {
              return sec > 0 ? +(sec / 60).toFixed(3) : null;
            }
            return minPerKm > 0 ? +minPerKm.toFixed(3) : null;
          });
        } else {
          const secs = curve.secs || [];
          best90 = buckets.map(dur => {
            const idx = secs.findIndex(s => s >= dur);
            if (idx === -1) return null;
            const v = curve.values[idx];
            return v ? Math.round(v) : null;
          });
        }
      }
    }
  } catch (_) {}

  const datasets = [];
  if (best90) {
    datasets.push({
      label: '90d Best',
      data: buckets.map((d, i) => ({ x: d, y: best90[i] ?? null })),
      borderColor: 'rgba(255,255,255,0.55)',
      backgroundColor: 'rgba(255,255,255,0.08)',
      fill: true, borderWidth: 2, pointRadius: 0, tension: 0.3,
      borderDash: [5, 3], order: 10
    });
  }
  datasets.push({
    label: 'This Activity',
    data: buckets.map((d, i) => ({ x: d, y: activityBest[i] ?? null })),
    borderColor: colour,
    backgroundColor: colour.replace(')', ',0.12)').replace('rgb', 'rgba'),
    fill: false, borderWidth: 2, pointRadius: 0, tension: 0.3, order: 1
  });

  // ── Peak markers: common durations worth flagging ────────
  // Cycling: 5s, 1m, 5m, 20m, 60m
  // Running: 1k, 5k, 10k, HM
  const markerDefs = isPace
    ? [[1000, '1k'], [5000, '5k'], [10000, '10k'], [21097, 'HM']]
    : [[5, '5s'], [60, '1m'], [300, '5m'], [1200, '20m'], [3600, '60m']];

  const vLines = markerDefs
    .filter(([bucket]) => buckets.includes(bucket))
    .map(([bucket, label]) => ({
      x: bucket, label,
      color: 'rgba(255,255,255,0.12)',
      labelColor: 'rgba(200,204,216,0.55)',
      dash: [3, 4]
    }));

  // ── Header meta: surface 2-3 peak values from the activity ────────
  // Cycling priority: 20m > 5m > 1m (threshold + VO2 indicators)
  // Running priority: 5k > 10k > 1k (the distances that actually matter)
  const metaBuckets = isPace
    ? [{ b: 5000, lbl: '5k' }, { b: 10000, lbl: '10k' }, { b: 1000, lbl: '1k' }]
    : [{ b: 1200, lbl: '20m' }, { b: 300, lbl: '5m' }, { b: 60, lbl: '1m' }];

  const metaItems = metaBuckets
    .map(({ b, lbl }) => {
      const idx = buckets.indexOf(b);
      if (idx === -1) return null;
      const val = activityBest[idx];
      if (val == null) return null;
      const best = best90?.[idx];
      let delta = '';
      if (best != null && best > 0) {
        if (isPace) {
          // Pace: lower is better
          const deltaSec = (val - best) * 60;
          if (Math.abs(deltaSec) > 1) {
            const sign = deltaSec < 0 ? '−' : '+';
            delta = ` ${sign}${Math.abs(deltaSec).toFixed(0)}s`;
          }
        } else {
          // Power: higher is better
          const pct = ((val / best - 1) * 100);
          if (Math.abs(pct) > 0.5) {
            const sign = pct >= 0 ? '+' : '';
            delta = ` ${sign}${pct.toFixed(0)}%`;
          }
        }
      }
      const vcls = isPace ? 'green' : 'accent';
      return { val: tickFmt(val) + delta, lbl: `Best ${lbl}`, vcls };
    })
    .filter(Boolean)
    .slice(0, 3);

  renderChartMeta('curve-hmeta', metaItems);

  new Chart(ctx, {
    type: 'line', data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { right: 0 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        vLines: vLines,
        legend: {
          display: true, position: 'top', align: 'end',
          labels: {
            color: 'rgba(200,204,216,0.7)',
            font: { size: 9, family: "var(--font-mono)" },
            boxWidth: 10, boxHeight: 2, padding: 10
          }
        },
        tooltip: {
          backgroundColor: 'rgba(8,10,13,0.92)',
          borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
          callbacks: {
            title: items => isPace
              ? fmtDist(Math.round(items[0]?.parsed?.x ?? 0))
              : fmtDuration(Math.round(items[0]?.parsed?.x ?? 0)),
            label: item => `${item.dataset.label}: ${tickFmt(item.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          type: 'logarithmic',
          ticks: {
            maxTicksLimit: 8, maxRotation: 0,
            callback: v => isPace ? fmtDist(Math.round(v)) : fmtDuration(Math.round(v))
          },
          grid: { color: 'rgba(255,255,255,0.04)' },
          border: { color: 'rgba(255,255,255,0.08)' },
          afterFit: axis => { axis.paddingRight = 0; }
        },
        y: {
          reverse: reverseY || false,
          grid: { color: 'rgba(255,255,255,0.04)' },
          border: { color: 'rgba(255,255,255,0.08)' },
          ticks: { maxTicksLimit: 5, color: colour, callback: tickFmt },
          afterFit: axis => { axis.width = 56; }
        }
      }
    }
  });
}

/* ── HR TRACE + ZONE BARS ── */
/* ═══════════════════════════════════════════════════════════
   HR SECTION (Layer 2b) — trace + thermometer zone breakdown
   Trace: zone-coloured + gradient fill + HRmax/Avg reference lines
          + header meta strip (Avg / Max / HR Load)
   Thermometer: vertical stacked blocks Z5→Z1 with height
                proportional to time-in-zone.
                Primary source: data.icu_hr_zone_times (seconds per zone)
                Fallback: count HR stream samples
   ─────────────────────────────────────────────────────────── */
function buildHrSection(data, hrmax) {
  const s = data.streams || {}, time = s.time || [];
  if (!s.heartrate?.length) {
    document.querySelector('.split-row:has(#chart-hr)').style.display = 'none';
    return;
  }

  // ── Trace ───────────────────────────────────────────────
  const dec = decimateChartData(time, s.heartrate);
  const zoneColors = hrmax ? dec.data.map(v => v != null ? HR_ZONE_COLOURS[getHrZone(v, hrmax)] : '#9ca3af') : null;
  const ds = {
    label: 'HR',
    data: dec.time.map((t, i) => ({ x: t, y: dec.data[i] ?? null })),
    borderColor: zoneColors ? 'transparent' : '#ef4444',
    _zoneColors: zoneColors,
    backgroundColor: 'transparent', fill: true,
    _gradientTop: 'rgba(239,68,68,0.45)',
    _gradientBottom: 'rgba(239,68,68,0.0)',
    borderWidth: 2, pointRadius: 0, tension: 0
  };

  // Header meta strip: Avg / Max / HR Load (all from Intervals)
  renderChartMeta('hr-hmeta', [
    data.average_heartrate != null ? { val: Math.round(data.average_heartrate), lbl: 'Avg', vcls: 'red' } : null,
    data.max_heartrate != null ? { val: Math.round(data.max_heartrate), lbl: 'Max', vcls: 'red' } : null,
    data.hr_load != null ? { val: Math.round(data.hr_load), lbl: 'HR Load', vcls: 'orange' } : null
  ]);

  // Reference lines — HRmax (if set) + Avg HR (from Intervals)
  const hLines = [];
  if (hrmax) {
    hLines.push({ y: hrmax, color: 'rgba(239,68,68,0.55)', label: `MAX ${Math.round(hrmax)}`, dash: [6, 4] });
  }
  if (data.average_heartrate != null) {
    hLines.push({ y: data.average_heartrate, color: 'rgba(200,204,216,0.35)', label: 'AVG', dash: [4, 4] });
  }

  const chart = makeChart('chart-hr', [ds], {}, dec.time);
  if (chart && hLines.length) {
    chart.options.plugins.hLines = hLines;
    chart.update('none');
  }

  // ── Thermometer ─────────────────────────────────────────
  const thermEl = document.getElementById('hr-thermo');
  if (!thermEl) return;

  if (!hrmax) {
    thermEl.innerHTML = '<div class="ht-empty-state">Set max HR to see zone distribution</div>';
    renderChartMeta('hrz-hmeta', []);
    return;
  }

  // Prefer Intervals pre-calculated zone times (seconds per zone)
  // Fallback: count HR stream samples (1 sample ≈ 1 second)
  let zoneSecs;
  const icuTimes = data.icu_hr_zone_times;
  if (Array.isArray(icuTimes) && icuTimes.length >= 5) {
    // Intervals stores zone times as an array. Use first 5 zones for display.
    zoneSecs = icuTimes.slice(0, 5).map(v => +v || 0);
  } else {
    // Fallback: count stream samples
    zoneSecs = new Array(5).fill(0);
    s.heartrate.filter(v => v != null && v > 0).forEach(v => zoneSecs[Math.min(getHrZone(v, hrmax), 4)]++);
  }

  const total = zoneSecs.reduce((a, b) => a + b, 0);
  if (total === 0) {
    thermEl.innerHTML = '<div class="ht-empty-state">No zone data available</div>';
    renderChartMeta('hrz-hmeta', []);
    return;
  }

  // Header meta strip: show the dominant zone
  const dominantIdx = zoneSecs.indexOf(Math.max(...zoneSecs));
  const dominantPct = Math.round(zoneSecs[dominantIdx] / total * 100);
  renderChartMeta('hrz-hmeta', [
    { val: `Z${dominantIdx + 1}`, lbl: 'Dominant', vcls: 'red' },
    { val: dominantPct + '%', lbl: 'Time', vcls: 'red' },
    { val: fmtDuration(total), lbl: 'Total', vcls: '' }
  ]);

  // Build thermometer — Z5 on top, Z1 on bottom.
  // Zones with 0 time still render as a thin 18px slice (CSS min-height)
  // so the legend remains visible. Non-zero zones expand proportionally.
  //
  // Flex-basis strategy: each block's flex-basis = (secs/total) * 100%.
  // Blocks with zero time get flex-basis:0 but min-height keeps them visible.
  const blocks = [];
  for (let i = 4; i >= 0; i--) {
    const secs = zoneSecs[i];
    const pct  = total > 0 ? (secs / total * 100) : 0;
    const mins = Math.round(secs / 60);
    const isEmpty = secs === 0;
    // Compute flex-basis — giving a small baseline for non-empty zones
    // so the smallest zone remains legible.
    const basis = isEmpty ? 0 : Math.max(pct, 4);
    blocks.push(`
      <div class="ht-block${isEmpty ? ' empty' : ''}" data-zone="${i}"
           style="background:${HR_ZONE_COLOURS[i]};flex-basis:${basis}%">
        <div class="ht-left">
          <span class="ht-zone">Z${i + 1}</span>
          <span class="ht-name">${HR_ZONE_NAMES[i].replace(/^Z\d+ /, '')}</span>
        </div>
        <div class="ht-right">
          <span class="ht-pct">${Math.round(pct)}%</span>
          <span class="ht-mins">${mins}m</span>
        </div>
      </div>`);
  }
  thermEl.innerHTML = blocks.join('');
}

/* ═══════════════════════════════════════════════════════════
   CADENCE + SPEED (Layer 2b)
   Cadence: purple trace with gradient fill + Avg reference line.
            Card title + unit dispatched by sport (rpm/spm/strokes).
   Speed (cycling only): amber gradient trace + Avg/Max reference
            lines. Running gets cadence full-width.
   ─────────────────────────────────────────────────────────── */
function buildCadenceSpeed(data) {
  const s = data.streams || {}, time = s.time || [], sport = data.sport_type;
  const isCyc = isCycling(sport), isRun = isRunning(sport);

  // ── Cadence ────────────────────────────────────────────
  if (s.cadence?.length) {
    const titleEl = document.getElementById('cadence-title');
    if (titleEl) {
      titleEl.textContent = isCyc ? 'Cadence' : isRun ? 'Cadence' : 'Stroke Rate';
    }

    const unit = isCyc ? 'rpm' : isRun ? 'spm' : 'spm';

    // Meta strip: Avg / Max — from Intervals where possible, stream max as fallback
    const avgCad = data.average_cadence != null ? Math.round(data.average_cadence) : null;
    const maxCad = (() => {
      const m = maxVal(s.cadence);
      return m != null ? Math.round(m) : null;
    })();
    renderChartMeta('cadence-hmeta', [
      avgCad != null ? { val: avgCad, lbl: `Avg ${unit}`, vcls: 'purple' } : null,
      maxCad != null ? { val: maxCad, lbl: `Max ${unit}`, vcls: 'purple' } : null
    ]);

    const dec = decimateChartData(time, s.cadence);
    const chart = makeChart('chart-cadence', [{
      label: 'Cadence',
      data: dec.time.map((t, i) => ({ x: t, y: dec.data[i] ?? null })),
      borderColor: '#a78bfa',
      backgroundColor: 'transparent', fill: true,
      _gradientTop: 'rgba(167,139,250,0.38)',
      _gradientBottom: 'rgba(167,139,250,0.0)',
      borderWidth: 1.5, pointRadius: 0, tension: 0
    }], {
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        border: { color: 'rgba(255,255,255,0.08)' },
        ticks: { maxTicksLimit: 5, color: 'oklch(0.72 0.18 290)', callback: v => Math.round(v) },
        afterFit: axis => { axis.width = 56; }
      }
    }, dec.time);

    // Avg reference line
    if (chart && avgCad != null) {
      chart.options.plugins.hLines = [
        { y: avgCad, color: 'rgba(167,139,250,0.45)', label: 'AVG', dash: [4, 4] }
      ];
      chart.update('none');
    }
  } else {
    const cadCard = document.getElementById('cadence-card');
    if (cadCard) cadCard.style.display = 'none';
  }

  // ── Speed (cycling only) ───────────────────────────────
  if (isCyc && s.velocity_smooth?.length) {
    // Meta strip: Avg / Max — pre-calculated by Intervals when available
    const avgKmh = data.average_speed != null ? +(data.average_speed * 3.6).toFixed(1) : null;
    const maxKmh = data.max_speed != null ? +(data.max_speed * 3.6).toFixed(1) : null;
    renderChartMeta('speed-hmeta', [
      avgKmh != null ? { val: avgKmh + ' km/h', lbl: 'Avg', vcls: 'yellow' } : null,
      maxKmh != null ? { val: maxKmh + ' km/h', lbl: 'Max', vcls: 'yellow' } : null
    ]);

    const speedArr = s.velocity_smooth.map(v => v != null ? +(v * 3.6).toFixed(2) : null);
    const dec = decimateChartData(time, speedArr);
    const chart = makeChart('chart-speed', [{
      label: 'Speed',
      data: dec.time.map((t, i) => ({ x: t, y: dec.data[i] ?? null })),
      borderColor: '#fbbf24',
      backgroundColor: 'transparent', fill: true,
      _gradientTop: 'rgba(251,191,36,0.42)',
      _gradientBottom: 'rgba(251,191,36,0.0)',
      borderWidth: 1.5, pointRadius: 0, tension: 0
    }], {
      y: {
        ticks: { maxTicksLimit: 5, color: 'oklch(0.84 0.18 80)', callback: v => v.toFixed(0) + ' km/h' },
        grid: { color: 'rgba(255,255,255,0.04)' },
        border: { color: 'rgba(255,255,255,0.08)' },
        afterFit: axis => { axis.width = 56; }
      }
    }, dec.time);

    // Avg + Max reference lines
    const hLines = [];
    if (avgKmh != null) hLines.push({ y: avgKmh, color: 'rgba(251,191,36,0.45)', label: 'AVG', dash: [4, 4] });
    if (maxKmh != null) hLines.push({ y: maxKmh, color: 'rgba(251,191,36,0.28)', label: 'MAX', dash: [2, 3] });
    if (chart && hLines.length) {
      chart.options.plugins.hLines = hLines;
      chart.update('none');
    }
  } else {
    const speedCard = document.getElementById('speed-card');
    if (speedCard) speedCard.style.display = 'none';
    const row = document.getElementById('cad-speed-row');
    if (row) row.style.gridTemplateColumns = '1fr';
  }
}

/* ── SEGMENTS ── */
/* ═══════════════════════════════════════════════════════════
   SEGMENTS (Layer 2b) — accent-bar rows
   Left edge coloured by highest achievement: gold/silver/bronze
   (PR rank) > top (overall KOM) > ag (AG QOM). Four-column grid:
   accent bar / name+meta / time / badges stacked.
   ─────────────────────────────────────────────────────────── */
function buildSegments(segments) {
  const el = document.getElementById('seg-items');
  const meta = document.getElementById('segments-meta');
  if (!segments?.length) {
    el.innerHTML = '<div class="seg-empty">No qualifying segment achievements.<br><span style="opacity:.6;font-size:9px">Showing only PR top 3, overall top 10, and age group top 10</span></div>';
    meta.textContent = '';
    return;
  }
  meta.textContent = `— ${segments.length} qualifying`;
  const sorted = [...segments].sort((a, b) => {
    return (a.pr_rank ?? 99) - (b.pr_rank ?? 99)
        || (a.kom_rank ?? 99) - (b.kom_rank ?? 99)
        || (a.qom_rank ?? 99) - (b.qom_rank ?? 99);
  });

  const accentClass = seg => {
    if (seg.pr_rank === 1) return 'acc-gold';
    if (seg.pr_rank === 2) return 'acc-silver';
    if (seg.pr_rank === 3) return 'acc-bronze';
    if (seg.kom_rank != null && seg.kom_rank <= 10) return 'acc-top';
    if (seg.qom_rank != null && seg.qom_rank <= 10) return 'acc-ag';
    return '';
  };

  el.innerHTML = sorted.map(seg => {
    const badges = [];
    if (seg.pr_rank === 1) badges.push('<span class="seg-badge sb-gold">🥇 PR</span>');
    else if (seg.pr_rank === 2) badges.push('<span class="seg-badge sb-silver">🥈 2nd Best</span>');
    else if (seg.pr_rank === 3) badges.push('<span class="seg-badge sb-bronze">🥉 3rd Best</span>');
    if (seg.kom_rank != null && seg.kom_rank <= 10) badges.push(`<span class="seg-badge sb-top10">🏆 Top ${seg.kom_rank}</span>`);
    if (seg.qom_rank != null && seg.qom_rank <= 10) badges.push(`<span class="seg-badge sb-ag">👴 Top ${seg.qom_rank} AG</span>`);
    const metaBits = [
      seg.distance_m ? fmtDist(seg.distance_m) : '',
    ].filter(Boolean).join(' · ');
    return `<div class="seg-item">
      <div class="seg-accent ${accentClass(seg)}"></div>
      <div class="seg-body">
        <div class="seg-name">${seg.name || 'Unnamed'}</div>
        <div class="seg-meta">${metaBits}</div>
      </div>
      <div>
        <div class="seg-time">${seg.elapsed_time_s ? fmtDuration(seg.elapsed_time_s) : '—'}</div>
        <div class="seg-time-lbl">Time</div>
      </div>
      <div class="seg-badges">${badges.join('')}</div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════
   LAP SPLITS (Layer 2b) — accent-bar row cards
   Significance rules (any triggers the accent bar):
     - Lap IF >= 0.95 (avg_watts / icu_ftp)           → hot (orange)
     - Lap IF >= 1.05                                  → red
     - Lap zone (from Intervals) >= 4                  → hot
     - Lap HR zone >= 4                                → hot
     - Lap work fraction >= 10% of total activity work → accent (cyan)
   Inline mini-bar shows avg power (cycling) / avg pace (running) as
   a fraction of the activity's max lap value. Crosshair sync on click.
   ─────────────────────────────────────────────────────────── */
/* ── LAP BAR CHART ── */
function buildLapChart(laps, sport) {
  const container = document.getElementById('lap-bars');
  const tooltip = document.getElementById('lap-tooltip');
  const wrapper = document.getElementById('lap-chart-wrapper');
  
  if (!laps?.length) {
    wrapper.style.display = 'none';
    return;
  }

  const isCyc = isCycling(sport);
  const isRun = isRunning(sport);
  
  // Determine primary metric for bar height
  let primaryMetric = 'avg_watts'; // default for cycling/rowing
  if (isRun) primaryMetric = 'avg_speed';
  
  // Calculate max value for scaling
  const maxValue = Math.max(...laps.map(l => +l[primaryMetric] || 0));
  if (maxValue === 0) {
    wrapper.style.display = 'none';
    return;
  }
  
  // Cumulative time for x-axis labels
  let cumulativeTime = 0;
  const timeLabels = [];
  
  container.innerHTML = laps.map((lap, i) => {
    const value = +lap[primaryMetric] || 0;
    const heightPct = (value / maxValue) * 100;
    
    // Determine if this is a rest/recovery lap
    const isRest = isCyc ? (value < maxValue * 0.3) : (value < maxValue * 0.5);
    const barClass = isRest ? 'lap-bar rest' : 'lap-bar';
    
    // Format cumulative time for label
    const mins = Math.floor(cumulativeTime / 60);
    const secs = cumulativeTime % 60;
    const timeLabel = `${mins}:${secs.toString().padStart(2, '0')}`;
    timeLabels.push(timeLabel);
    
    // Update cumulative for next lap
    cumulativeTime += lap.elapsed_s || 0;
    
    // Show label on select laps (every 3rd lap, or if total < 10 show more)
    const showLabel = laps.length <= 10 ? (i % 2 === 0) : (i % 3 === 0);
    
    return `<div class="${barClass}" 
                 style="height: ${heightPct}%"
                 data-lap="${lap.lap}"
                 data-idx="${i}">
              ${showLabel ? `<div class="lap-time-label">${timeLabel}</div>` : ''}
            </div>`;
  }).join('');
  
  // Add hover interactions
  const bars = container.querySelectorAll('.lap-bar');
  bars.forEach((bar, i) => {
    const lap = laps[i];
    
    bar.addEventListener('mouseenter', (e) => {
      // Build tooltip content based on sport
      let tooltipHtml = `<div class="lap-tooltip-row">
        <span class="lap-tooltip-label">Lap ${lap.lap}</span>
        <span class="lap-tooltip-value">${fmtDuration(lap.elapsed_s)}</span>
      </div>`;
      
      if (isCyc) {
        tooltipHtml += `<div class="lap-tooltip-row">
          <span class="lap-tooltip-label">Avg Power</span>
          <span class="lap-tooltip-value">${Math.round(lap.avg_watts || 0)}W</span>
        </div>`;
        if (lap.avg_speed) {
          tooltipHtml += `<div class="lap-tooltip-row">
            <span class="lap-tooltip-label">Avg Speed</span>
            <span class="lap-tooltip-value">${(lap.avg_speed * 3.6).toFixed(1)} km/h</span>
          </div>`;
        }
      } else if (isRun) {
        tooltipHtml += `<div class="lap-tooltip-row">
          <span class="lap-tooltip-label">Avg Pace</span>
          <span class="lap-tooltip-value">${fmtPace(lap.avg_speed)}</span>
        </div>`;
      } else {
        tooltipHtml += `<div class="lap-tooltip-row">
          <span class="lap-tooltip-label">Avg Power</span>
          <span class="lap-tooltip-value">${Math.round(lap.avg_watts || 0)}W</span>
        </div>`;
      }
      
      tooltipHtml += `<div class="lap-tooltip-row">
        <span class="lap-tooltip-label">Avg HR</span>
        <span class="lap-tooltip-value">${Math.round(lap.avg_hr || 0)} bpm</span>
      </div>`;
      
      if (lap.distance_m) {
        tooltipHtml += `<div class="lap-tooltip-row">
          <span class="lap-tooltip-label">Distance</span>
          <span class="lap-tooltip-value">${fmtDist(lap.distance_m)}</span>
        </div>`;
      }
      
      tooltip.innerHTML = tooltipHtml;
      tooltip.classList.add('visible');
      
      // Position tooltip
      const barRect = bar.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      tooltip.style.left = `${barRect.left - containerRect.left + barRect.width / 2}px`;
      tooltip.style.top = `${barRect.top - containerRect.top - 10}px`;
      tooltip.style.transform = 'translate(-50%, -100%)';
      
      // Highlight bar
      bar.classList.add('active');
      
      // Dispatch crosshair event
      if (_lapStartSec[i] !== undefined) {
        dispatchCrosshair(_lapStartSec[i]);
      }
    });
    
    bar.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
      bar.classList.remove('active');
    });
    
    // Click to lock crosshair
    bar.addEventListener('click', () => {
      if (_lapStartSec[i] !== undefined) {
        dispatchCrosshair(_lapStartSec[i]);
      }
    });
  });
}

function buildLaps(laps, sport, ftp, hrmax, totalWorkKj) {
  if (!laps?.length) {
    document.getElementById('laps-section').style.display = 'none';
    return;
  }
  document.getElementById('laps-meta').textContent = `— ${laps.length} laps`;
  const isCyc = isCycling(sport), isRun = isRunning(sport);

  // Sport-dispatched column definitions. Each: {lbl, key, fmt, cls?, barFrom?}
  // barFrom: 'power' | 'pace' — which metric drives the inline mini-bar
  let cols;
  if (isCyc) {
    cols = [
      { lbl: 'Lap',    key: 'lap',         fmt: v => v,                                                 cls: 'first' },
      { lbl: 'Time',   key: 'elapsed_s',   fmt: v => v ? fmtDuration(v) : '—' },
      { lbl: 'Dist',   key: 'distance_m',  fmt: v => v ? fmtDist(v) : '—' },
      { lbl: 'Avg W',  key: 'avg_watts',   fmt: v => v ? Math.round(v) + 'W' : '—',     cls: 'acc', barFrom: 'power' },
      { lbl: 'NP',     key: 'np_watts',    fmt: v => v ? Math.round(v) + 'W' : '—' },
      { lbl: 'HR',     key: 'avg_hr',      fmt: v => v ? Math.round(v) : '—' },
      { lbl: 'Cad',    key: 'avg_cadence', fmt: v => v ? Math.round(v) : '—', cls: 'muted' }
    ];
  } else if (isRun) {
    cols = [
      { lbl: 'Lap',    key: 'lap',         fmt: v => v,                                                 cls: 'first' },
      { lbl: 'Time',   key: 'elapsed_s',   fmt: v => v ? fmtDuration(v) : '—' },
      { lbl: 'Dist',   key: 'distance_m',  fmt: v => v ? fmtDist(v) : '—' },
      { lbl: 'Pace',   key: 'avg_speed',   fmt: v => v && v > 0 ? fmtPace(v) : '—',       cls: 'grn', barFrom: 'pace' },
      { lbl: 'HR',     key: 'avg_hr',      fmt: v => v ? Math.round(v) : '—' },
      { lbl: 'Cad',    key: 'avg_cadence', fmt: v => v ? Math.round(v) : '—', cls: 'muted' }
    ];
  } else {
    cols = [
      { lbl: 'Lap',    key: 'lap',         fmt: v => v,                                                 cls: 'first' },
      { lbl: 'Time',   key: 'elapsed_s',   fmt: v => v ? fmtDuration(v) : '—' },
      { lbl: 'Dist',   key: 'distance_m',  fmt: v => v ? fmtDist(v) : '—' },
      { lbl: 'Avg W',  key: 'avg_watts',   fmt: v => v ? Math.round(v) + 'W' : '—',     cls: 'acc', barFrom: 'power' },
      { lbl: 'HR',     key: 'avg_hr',      fmt: v => v ? Math.round(v) : '—' }
    ];
  }

  // Grid template: 4px accent + all data cols equal 1fr
  const gridTemplate = `4px ${cols.map(() => '1fr').join(' ')}`;

  // Head row — skip accent column, match data cols
  const head = document.getElementById('laps-head');
  head.style.gridTemplateColumns = gridTemplate;
  head.innerHTML = '<div></div>' + cols.map(c => `<div>${c.lbl}</div>`).join('');

  _lapStartSec = laps.map(l => l.start_time ?? 0);

  // Significance thresholds
  const maxLapPower = Math.max(...laps.map(l => +l.avg_watts || 0));
  const maxLapSpeed = Math.max(...laps.map(l => +l.avg_speed || 0));
  const maxBar = isCyc ? maxLapPower : maxLapSpeed;

  const sigFor = lap => {
    const w = +lap.avg_watts || 0;
    const hr = +lap.avg_hr || 0;
    const z = +lap.zone || 0;
    if (ftp && w > 0) {
      const lapIf = w / ftp;
      if (lapIf >= 1.05) return 'sig-red';
      if (lapIf >= 0.95) return 'sig-hot';
    }
    if (hrmax && hr > 0 && getHrZone(hr, hrmax) >= 4) return 'sig-hot';
    if (z >= 4) return 'sig-hot';
    // Work fraction significance
    if (totalWorkKj && w > 0 && lap.elapsed_s > 0) {
      const lapKj = w * lap.elapsed_s / 1000;
      if (lapKj / totalWorkKj >= 0.10) return 'sig';
    }
    return '';
  };

  const barClassFor = (lap, sigClass) => {
    if (sigClass === 'sig-red') return 'red';
    if (sigClass === 'sig-hot') return 'hot';
    if (!isCyc) return 'grn';
    return '';
  };

  const list = document.getElementById('laps-list');
  list.innerHTML = laps.map((lap, i) => {
    const sig = sigFor(lap);
    // Mini-bar width — cycling uses avg_watts / max; running uses avg_speed / max
    let barPct = 0;
    if (maxBar > 0) {
      const v = isCyc ? (+lap.avg_watts || 0) : (+lap.avg_speed || 0);
      barPct = Math.min(100, Math.round(v / maxBar * 100));
    }
    const barCls = barClassFor(lap, sig);
    const cellsHtml = cols.map((c, ci) => {
      const val = c.fmt(lap[c.key]);
      const cellCls = ['lap-cell', c.cls || ''].filter(Boolean).join(' ');
      // Inject mini-bar under the cell flagged barFrom
      if (c.barFrom && barPct > 0) {
        return `<div class="${cellCls}">
          <div>${val}</div>
          <div class="lap-bar-wrap"><div class="lap-bar-fill ${barCls}" style="width:${barPct}%"></div></div>
        </div>`;
      }
      return `<div class="${cellCls}">${val}</div>`;
    }).join('');
    return `<div class="lap-row" style="grid-template-columns:${gridTemplate}"
                 onclick="dispatchCrosshair(${_lapStartSec[i] ?? 0})">
      <div class="lap-accent ${sig}"></div>
      ${cellsHtml}
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════
   FLIGHT DECK HERO BUILDER
   Populates the new hero: TSS ring arc, stat strip, readings.
   All values from existing stream data — no new data fields.
   Called once from init() after data is loaded.
   ─────────────────────────────────────────────────────────── */
function buildFlightDeck(data, ftp, hrmax) {
  const sport  = data.sport_type || '';
  const isCyc  = isCycling(sport);
  const isRun  = isRunning(sport);
  const s      = data.streams || {};

  // ── Ring: TSS as centre number, IF/rIF drives arc fill ───
  const tss = data.icu_training_load != null ? Math.round(data.icu_training_load) : null;
  const ringNumEl = document.getElementById('fd-ring-num');
  const ringSubEl = document.getElementById('fd-ring-sub');
  const ringIfEl  = document.getElementById('fd-ring-if');
  const ringArcEl = document.getElementById('fd-ring-arc');

  if (ringNumEl) ringNumEl.textContent = tss != null ? tss : '—';
  // Sub label is always "TSS"
  if (ringSubEl) ringSubEl.textContent = 'TSS';

  // TSS-based ring colour scale:
  //  < 40  → vibrant blue     (easy / recovery)
  //  < 60  → bright green     (moderate)
  //  < 80  → bright yellow    (solid effort)
  //  < 100 → bold red-orange  (hard)
  //  100+  → coral/hot red    (high exertion)
  const tssRingColor = (() => {
    if (tss == null) return 'oklch(0.65 0.18 240)';
    if (tss <  40)   return 'oklch(0.68 0.22 240)';
    if (tss <  60)   return 'oklch(0.84 0.24 145)';
    if (tss <  80)   return 'oklch(0.92 0.22 100)';
    if (tss < 100)   return 'oklch(0.72 0.26 35)';
    return               'oklch(0.68 0.28 20)';
  })();

  // Arc fill = intensity ratio (IF or rIF), clamped 0–1
  // IF line shown below TSS in accent-matched colour
  let arcFill = 0;
  let ifText  = '';
  if (isCyc && data.icu_intensity != null) {
    const IF = data.icu_intensity / 100;
    arcFill  = Math.min(1, Math.max(0, IF));
    ifText   = `IF ${IF.toFixed(2)}`;
  } else if (isRun && data.icu_intensity != null) {
    const rIF = data.icu_intensity / 100;
    arcFill   = Math.min(1, Math.max(0, rIF));
    ifText    = `rIF ${rIF.toFixed(2)}`;
  } else if (tss != null) {
    arcFill = Math.min(1, tss / 150);
  }

  // IF line: same colour as the arc so they visually connect
  if (ringIfEl) {
    ringIfEl.textContent = ifText;
    ringIfEl.style.color = ifText ? tssRingColor : 'transparent';
  }

  // Animate arc + apply TSS colour
  if (ringArcEl) {
    const circ = 2 * Math.PI * 68;
    ringArcEl.setAttribute('stroke', tssRingColor);
    ringArcEl.closest('.fd-ring-wrap')?.style.setProperty('--fd-ring-color', tssRingColor);
    setTimeout(() => {
      ringArcEl.style.strokeDasharray = `${arcFill * circ} ${circ}`;
    }, 80);
  }

  // ── Meta row: glyph, eyebrow, date badge ─────────────────
  const glyphEl    = document.getElementById('fd-glyph');
  const eyebrowEl  = document.getElementById('fd-eyebrow');
  const dateBadgeEl= document.getElementById('fd-date-badge');

  if (glyphEl) {
    glyphEl.textContent = sportIcon(sport);
    if (isRun) glyphEl.classList.add('run');
  }
  if (eyebrowEl) {
    const sportLabel = sport.replace(/([A-Z])/g, ' $1').trim().toUpperCase();
    eyebrowEl.textContent = sportLabel;
    if (isRun) eyebrowEl.classList.add('run');
  }
  if (dateBadgeEl && data.start_date_local) {
    dateBadgeEl.textContent = fmtDate(data.start_date_local);
  }

  // ── Kudos (bind if data.kudos_count present) ──────────────
  if (data.kudos_count != null) {
    const kudosEl = document.getElementById('fd-kudos');
    if (kudosEl) { kudosEl.style.display = ''; }
  }

  // ── Stat strip ────────────────────────────────────────────
  const strip = document.getElementById('fd-statstrip');
  if (!strip) return;

  const stats = [];
  const pushStat = (lbl, val, unit, hl=false) => {
    if (val == null || val === '—') return;
    stats.push({ lbl, val, unit, hl });
  };

  // Universal stats
  if (data.distance != null && data.distance > 0) {
    pushStat('Distance', (data.distance / 1000).toFixed(2), 'km');
  }
  if (data.moving_time != null) {
    pushStat('Moving', fmtDuration(data.moving_time), '');
  }
  if (data.total_elevation_gain != null && data.total_elevation_gain > 0) {
    pushStat('Elevation', Math.round(data.total_elevation_gain), 'm');
  }

  if (isCyc) {
    if (data.average_speed != null) pushStat('Avg Speed', (data.average_speed * 3.6).toFixed(1), 'km/h');
    if (data.icu_average_watts != null) pushStat('Avg Power', Math.round(data.icu_average_watts), 'W');
    if (data.icu_weighted_avg_watts != null) pushStat('Norm Power', Math.round(data.icu_weighted_avg_watts), 'W', true);
    if (data.icu_joules != null) pushStat('Work', Math.round(data.icu_joules / 1000), 'kJ');
  } else if (isRun) {
    if (data.average_speed > 0) pushStat('Avg Pace', fmtPace(data.average_speed).replace('/km',''), '/km', true);
    if (data.average_heartrate != null) pushStat('Avg HR', Math.round(data.average_heartrate), 'bpm');
    if (data.average_cadence != null)   pushStat('Cadence', Math.round(data.average_cadence), 'spm');
  } else {
    if (data.average_speed > 0)        pushStat('Avg Speed', (data.average_speed * 3.6).toFixed(1), 'km/h');
    if (data.average_heartrate != null) pushStat('Avg HR', Math.round(data.average_heartrate), 'bpm');
  }
  if (tss != null) pushStat('TSS', tss, '');

  strip.innerHTML = stats.map(st => `
    <div class="fd-bigstat${isRun ? ' run' : ''}">
      <div class="l">${st.lbl}</div>
      <div class="v${st.hl ? ' hl' : ''}">${st.val}${st.unit ? `<span class="u">${st.unit}</span>` : ''}</div>
    </div>
  `).join('');

  // ── Readings column ───────────────────────────────────────
  const readingsEl = document.getElementById('fd-readings');
  if (!readingsEl) return;
  const readings = [];

  if (isCyc) {
    // Peak power (max of watts stream)
    const peakW = s.watts?.length ? Math.round(Math.max(...s.watts.filter(Boolean))) : null;
    if (peakW != null) {
      readings.push({
        lbl: 'Peak Power', val: peakW + 'W',
        badge: '5 s burst', badgeCls: 'lime'
      });
    }
    // Variability index = NP/AP
    if (data.icu_weighted_avg_watts && data.icu_average_watts) {
      const VI = (data.icu_weighted_avg_watts / data.icu_average_watts).toFixed(2);
      readings.push({
        lbl: 'Variability', val: VI,
        badge: 'NP / AP', badgeCls: 'ice'
      });
    }
    // Avg HR + max
    if (data.average_heartrate != null) {
      const maxStr = data.max_heartrate ? `max ${Math.round(data.max_heartrate)}` : '';
      readings.push({
        lbl: 'Heart Rate', val: Math.round(data.average_heartrate) + ' bpm',
        badge: maxStr, badgeCls: 'coral'
      });
    }
  } else if (isRun) {
    // Best pace (max speed = min pace)
    if (data.max_speed > 0) {
      readings.push({
        lbl: 'Best Pace', val: fmtPace(data.max_speed),
        badge: 'fastest km', badgeCls: 'coral'
      });
    }
    // rIF
    if (data.icu_intensity != null) {
      readings.push({
        lbl: 'Intensity rIF', val: (data.icu_intensity / 100).toFixed(2),
        badge: 'thr ÷ avg', badgeCls: 'ice'
      });
    }
    // HR
    if (data.average_heartrate != null) {
      const maxStr = data.max_heartrate ? `max ${Math.round(data.max_heartrate)}` : '';
      readings.push({
        lbl: 'Heart Rate', val: Math.round(data.average_heartrate) + ' bpm',
        badge: maxStr, badgeCls: 'coral'
      });
    }
  } else {
    // Fallback: avg HR + TSS
    if (data.average_heartrate != null) {
      readings.push({ lbl: 'Heart Rate', val: Math.round(data.average_heartrate) + ' bpm', badge: '', badgeCls: 'coral' });
    }
    if (tss != null) {
      readings.push({ lbl: 'TSS', val: tss, badge: '', badgeCls: 'lime' });
    }
  }

  readingsEl.innerHTML = readings.map(r => `
    <div class="fd-reading">
      <div class="fd-reading-left">
        <div class="fd-reading-lbl">${r.lbl}</div>
        <div class="fd-reading-val">${r.val}</div>
      </div>
      ${r.badge ? `<div class="fd-reading-badge ${r.badgeCls}">${r.badge}</div>` : ''}
    </div>
  `).join('');

  // ── Back link: sport-aware ─────────────────────────────────
  const backEl = document.getElementById('fd-back-link');
  if (backEl) {
    if (isRun)            { backEl.textContent = '← Running';  backEl.href = 'running.html'; }
    else if (isCycling(sport)) { backEl.textContent = '← Cycling'; backEl.href = 'cycling.html'; }
    else                  { backEl.textContent = '← Overview'; backEl.href = 'index.html'; }
  }
}

/* ── MAIN INIT ── */
async function init() {
  const params=new URLSearchParams(location.search);
  let actId=params.get('id');
  if(!actId) { showError('No activity ID specified.',''); return; }
  if(!actId.startsWith('i')) actId='i'+actId;

  let data;
  try {
    const r=await fetch(`${CF_BASE}data/streams/${actId}.json`);
    const ct=(r.headers.get('content-type')||'');
    if(!r.ok || !ct.includes('json')) { showError('Activity not available.','Stream data is only kept for 14 days.'); return; }
    data=await r.json();
  } catch(e) { showError('Failed to load.', e.message); return; }

  const sport = data.sport_type||'';
  const ftp   = data.icu_ftp||null;
  const hrmax = data.athlete_max_hr||null;

  const syncEl=document.getElementById('last-sync');
  if(syncEl&&data.synced_at) {
    const d=new Date(data.synced_at);
    syncEl.textContent=d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})+' sync';
  }

  const badge=document.getElementById('sport-badge');
  badge.textContent=`${sportIcon(sport)} ${sport.replace(/([A-Z])/g,' $1').trim()}`;
  badge.className=`act-sport-badge ${sport}`;
  document.getElementById('activity-name').textContent = data.name||'Activity';
  document.getElementById('activity-date').textContent = fmtDate(data.start_date_local||data.synced_at);
  document.getElementById('kudos-count').textContent   = data.kudos_count??'0';
  document.title=`${data.name||'Activity'} — Training OS`;

  // Flight deck hero (new design)
  buildFlightDeck(data, ftp, hrmax);
  // Layer 2a — Cockpit hero + Intervals-driven summary panel (hidden, for JS compat)
  buildHero(data);
  // Layer 2b — Intervals telemetry stats panel (was buildWorkoutStats)
  buildWorkoutStats(data, ftp);
  buildMapRibbon(data);
  buildElevationChart(data, ftp, hrmax);

  const latlng=data.streams?.latlng;
  if(latlng?.length && !isRowing(sport)) {
    window._pendingMap=()=>initMap(latlng, data.streams?.watts, data.streams?.heartrate, sport, ftp, hrmax);
  } else {
    document.getElementById('map-section').style.display='none';
    document.getElementById('map-stats-row').style.gridTemplateColumns='1fr';
  }

  buildPrimaryTrace(data, ftp, hrmax);
  buildHrSection(data, hrmax);
  buildCadenceSpeed(data);
  buildSegments(data.segments);
  {
    const totalWorkKj = data.icu_joules != null ? data.icu_joules / 1000 : null;
    buildLapChart(data.laps, sport);
    buildLaps(data.laps, sport, ftp, hrmax, totalWorkKj);
  }

  // ── Rail Flow patch: populate new header + rail-row left cols ──
/* ── RAIL FLOW PATCH ─────────────────────────────────────────
   Runs after all existing build functions complete.
   Populates the new Rail Flow header chips and rail-row left
   columns from data already in the stream JSON.
   Zero changes to existing functions. Pure additive.
   ─────────────────────────────────────────────────────────── */
function rlPatch(data) {
  if (!data) return;
  const sport = data.sport_type || '';
  const ftp   = data.icu_ftp   || null;
  const hrmax = data.athlete_max_hr || null;
  const streams = data.streams || {};

  // ── Header chips ──────────────────────────────────────────
  // TSS chip
  if (data.icu_training_load != null) {
    const chip = document.getElementById('hdr-tss-chip');
    if (chip) { chip.textContent = 'TSS ' + Math.round(data.icu_training_load); chip.style.display = ''; }
  }
  // Zone chip — derive dominant HR zone label
  if (hrmax && streams.heartrate && streams.heartrate.length) {
    const counts = [0,0,0,0,0];
    streams.heartrate.forEach(hr => { if (hr > 0) counts[getHrZone(hr, hrmax)]++; });
    const dom = counts.indexOf(Math.max(...counts));
    const names = ['Z1 Recovery','Z2 Aerobic','Z3 Tempo','Z4 Threshold','Z5 Max'];
    const chip  = document.getElementById('hdr-zone-chip');
    if (chip) { chip.textContent = names[dom]; chip.style.display = ''; }
  }
  // Activity ID in breadcrumb
  const idCrumb = document.getElementById('activity-id-crumb');
  if (idCrumb && data.activity_id) idCrumb.textContent = data.activity_id;

  // STRAVA button in header
  if (data.strava_id) {
    const btn = document.getElementById('strava-link-hdr');
    if (btn) { btn.href = 'https://www.strava.com/activities/' + data.strava_id; btn.style.display = ''; }
  }
  // INTERVALS button in header
  if (data.activity_id) {
    const iBtn = document.getElementById('intervals-link-hdr');
    if (iBtn) { iBtn.href = 'https://intervals.icu/activities/' + data.activity_id; iBtn.style.display = ''; }
  }

  // ── Map meta tiles ────────────────────────────────────────
  const setMeta = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.textContent = val; };
  setMeta('map-meta-dist', data.distance != null ? fmtDist(data.distance) : null);
  setMeta('map-meta-elev', data.total_elevation_gain != null ? Math.round(data.total_elevation_gain) + ' m' : null);
  setMeta('map-meta-dur',  data.moving_time != null ? fmtDuration(data.moving_time) : null);
  setMeta('map-meta-spd',  data.average_speed != null ? (data.average_speed * 3.6).toFixed(1) + ' km/h' : null);

  // ── Power/Pace rail row — left column numbers ─────────────
  const isPace = isRunning(sport);
  const isRow  = isRowing(sport);
  const numEl  = document.getElementById('primary-avg-num');
  const unitEl = document.getElementById('primary-avg-unit');
  const noteEl = document.getElementById('primary-row-note');
  const dotEl  = document.getElementById('primary-label-dot');

  if (isPace) {
    // Running — primary metric is pace
    if (numEl && data.average_speed > 0) numEl.textContent = fmtPace(data.average_speed).replace('/km','');
    if (unitEl) unitEl.textContent = '/km avg';
    if (dotEl)  dotEl.style.background = 'var(--green)';
    // Note: best pace
    if (noteEl && data.max_speed > 0) noteEl.textContent = 'best ' + fmtPace(data.max_speed);
    // KVs: HR decoupling + IF
    const kvs = [];
    if (data.icu_intensity != null) kvs.push(['IF', (data.icu_intensity/100).toFixed(2)]);
    if (data.decoupling != null)    kvs.push(['Decouple', (+data.decoupling).toFixed(1) + '%']);
    if (data.total_elevation_gain)  kvs.push(['Elev', Math.round(data.total_elevation_gain) + ' m ↑']);
    rlSetKvs('primary-row-kvs', kvs);
  } else if (isCycling(sport)) {
    // Cycling — primary metric is power
    if (numEl && data.icu_average_watts != null) numEl.textContent = Math.round(data.icu_average_watts);
    if (unitEl) unitEl.textContent = 'W avg';
    // Note: NP · IF
    if (noteEl) {
      const parts = [];
      if (data.icu_weighted_avg_watts != null) parts.push('NP ' + Math.round(data.icu_weighted_avg_watts) + 'W');
      if (data.icu_intensity != null)          parts.push('IF '  + (data.icu_intensity/100).toFixed(2));
      noteEl.textContent = parts.join(' · ');
    }
    // KVs
    const kvs = [];
    if (data.icu_weighted_avg_watts && data.icu_weight) kvs.push(['W/kg', (data.icu_weighted_avg_watts/data.icu_weight).toFixed(2)]);
    if (data.icu_joules != null) kvs.push(['Work', Math.round(data.icu_joules/1000) + ' kJ']);
    if (data.decoupling != null) kvs.push(['Decouple', (+data.decoupling).toFixed(1) + '%']);
    rlSetKvs('primary-row-kvs', kvs);
  } else if (isRow) {
    // Rowing — 500m split
    if (numEl && data.average_speed > 0) {
      const s = 500 / data.average_speed;
      const m = Math.floor(s/60), sec = (s%60).toFixed(1);
      numEl.textContent = m + ':' + String(sec).padStart(4,'0');
    }
    if (unitEl) unitEl.textContent = '/500m';
  }

  // ── Curve row — peak number ───────────────────────────────
  // Power curve: read from power_curves_90d.json if available;
  // otherwise derive from streams.watts max (rough)
  (async () => {
    if (isCycling(sport) && streams.watts && streams.watts.length) {
      const peak = Math.max(...streams.watts.filter(Boolean));
      const numC = document.getElementById('curve-peak-num');
      const uniC = document.getElementById('curve-peak-unit');
      if (numC) numC.textContent = Math.round(peak);
      if (uniC) uniC.textContent = 'W peak';
      // KVs from 90d curves if available
      try {
        const r = await fetch('data/power_curves_90d.json');
        if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
          const c = await r.json();
          const secs  = c?.list?.[0]?.secs  || [];
          const vals  = c?.list?.[0]?.values || [];
          const labels = [[60,'1 min'],[300,'5 min'],[1200,'20 min']];
          const kvs = labels.map(([s, lbl]) => {
            const idx = secs.findIndex(x => x >= s);
            return idx >= 0 ? [lbl, Math.round(vals[idx]) + ' W'] : null;
          }).filter(Boolean);
          rlSetKvs('curve-row-kvs', kvs);
        }
      } catch(e) { /* silent */ }
    } else if (isRunning(sport) && streams.velocity_smooth && streams.velocity_smooth.length) {
      const best = Math.min(...streams.velocity_smooth.filter(v => v > 0));
      const numC = document.getElementById('curve-peak-num');
      const uniC = document.getElementById('curve-peak-unit');
      if (numC && best > 0) numC.textContent = fmtPace(best).replace('/km','');
      if (uniC) uniC.textContent = '/km best';
    }
  })();

  // ── HR rail row — left column ─────────────────────────────
  const hrAvg = document.getElementById('hr-avg-num');
  if (hrAvg && data.average_heartrate != null) hrAvg.textContent = Math.round(data.average_heartrate);
  const hrNote = document.getElementById('hr-row-note');
  if (hrNote && data.max_heartrate != null) hrNote.textContent = 'max ' + Math.round(data.max_heartrate) + ' bpm';
  if (hrmax && streams.heartrate && streams.heartrate.length) {
    const counts = [0,0,0,0,0];
    streams.heartrate.forEach(hr => { if (hr > 0) counts[getHrZone(hr, hrmax)]++; });
    const total = counts.reduce((a,b)=>a+b,0) || 1;
    const dom   = counts.indexOf(Math.max(...counts));
    const znames = ['Recovery','Aerobic','Tempo','Threshold','Max'];
    const kvs = [
      ['Dominant', 'Z' + (dom+1) + ' ' + znames[dom]],
      ['Max',      Math.round(data.max_heartrate || 0) + ' bpm'],
    ];
    rlSetKvs('hr-row-kvs', kvs);

    // Zone bar chart — dominant highlighted, others light tint, pct labels above
    const zoneCanvas = document.getElementById('chart-hr-zones');
    if (zoneCanvas) {
      const pcts = counts.map(c => total > 0 ? +(c/total*100).toFixed(1) : 0);
      const shortNames = ['Z1\nRecovery', 'Z2\nAerobic', 'Z3\nTempo', 'Z4\nThreshold', 'Z5\nMax'];

      // Each bar uses its actual HR zone colour: dominant at full opacity, others dimmer
      const bgColors = HR_ZONE_COLOURS.map((col, i) => {
        // Parse oklch to rgba by using the colour directly with opacity
        const opacity = i === dom ? '0.85' : '0.35';
        // Return as CSS color-mix so we can apply opacity
        return col.replace('oklch(', `oklch(`).replace(')', ` / ${opacity})`);
      });

      // Inline plugin: draw pct labels above each bar — always bright enough to read
      const pctLabelPlugin = {
        id: 'pctLabels',
        afterDatasetDraw(chart) {
          const { ctx, data: d, scales: { x, y } } = chart;
          const ds = chart.getDatasetMeta(0);
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ds.data.forEach((bar, i) => {
            const val = d.datasets[0].data[i];
            if (val <= 0) return;
            // Dominant: bright white; others: fg-2 equivalent
            ctx.font = `${i === dom ? '700' : '500'} 11px 'Geist Mono', monospace`;
            ctx.fillStyle = i === dom ? 'rgba(236,237,239,0.95)' : 'rgba(181,184,189,0.80)';
            ctx.fillText(val + '%', bar.x, bar.y - 3);
          });
          ctx.restore();
        }
      };

      new Chart(zoneCanvas, {
        type: 'bar',
        plugins: [pctLabelPlugin],
        data: {
          labels: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'],
          datasets: [{
            data: pcts,
            backgroundColor: bgColors,
            borderColor: 'transparent',
            borderWidth: 0,
            borderRadius: 5,
            borderSkipped: false,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          layout: { padding: { top: 22, bottom: 0, left: 4, right: 4 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(15,22,32,0.92)',
              borderColor: 'rgba(255,255,255,0.10)', borderWidth: 1,
              callbacks: {
                title: items => shortNames[items[0].dataIndex].replace('\n', ' '),
                label: item => {
                  const mins = Math.round(counts[item.dataIndex] / 60);
                  const secs = counts[item.dataIndex] % 60;
                  return ` ${item.raw}%  (${mins}m ${secs}s)`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: {
                // Zone labels: dominant bright, others fg-2
                color: (ctx) => ctx.index === dom ? 'rgba(236,237,239,0.95)' : 'rgba(181,184,189,0.70)',
                font: { size: 9, family: "var(--font-mono)", weight: ctx => ctx.index === dom ? '700' : '400' },
                padding: 4
              }
            },
            y: {
              display: false,
              min: 0,
              max: Math.max(...pcts) * 1.35
            }
          }
        }
      });
    }
  }

  // ── Cadence left column ───────────────────────────────────
  const cadNum  = document.getElementById('cad-avg-num');
  const cadUnit = document.getElementById('cad-avg-unit');
  if (cadNum && data.average_cadence != null) cadNum.textContent = Math.round(data.average_cadence);
  if (cadUnit) cadUnit.textContent = isRunning(sport) ? 'spm' : 'rpm';

  // ── Speed left column ─────────────────────────────────────
  const spdNum  = document.getElementById('speed-avg-num');
  const spdUnit = document.getElementById('speed-avg-unit');
  if (spdNum && data.average_speed != null) spdNum.textContent = isRunning(sport) ? fmtPace(data.average_speed).replace('/km','') : (data.average_speed*3.6).toFixed(1);
  if (spdUnit) spdUnit.textContent = isRunning(sport) ? '/km avg' : 'km/h avg';
}

/* Helper: write KV pairs into a .rl-row-kvs container */
function rlSetKvs(id, pairs) {
  const el = document.getElementById(id);
  if (!el || !pairs.length) return;
  el.innerHTML = pairs.map(([k,v]) =>
    `<div class="rl-row-kv"><span class="rl-row-kv-k">${k}</span><span class="rl-row-kv-v">${v}</span></div>`
  ).join('');
}

  rlPatch(data);


  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('activity-content').classList.remove('hidden');

  if(window._pendingMap) {
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      window._pendingMap(); window._pendingMap=null;
    }));
  }
}

function showError(title, msg) {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('error-state').classList.remove('hidden');
  document.getElementById('error-title').textContent=title;
  document.getElementById('error-msg').textContent=msg;
}

document.addEventListener('DOMContentLoaded', init);
