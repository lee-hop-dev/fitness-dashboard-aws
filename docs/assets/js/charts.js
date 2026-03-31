/* ============================================
   FITNESS DASHBOARD — CHARTS v2
   ============================================ */

Chart.defaults.color = '#6b7590';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family = "'DM Mono', monospace";
Chart.defaults.font.size = 11;

const C = {
  accent: '#00e5ff', green: '#00ff87', orange: '#ff6b2b',
  purple: '#a855f7', yellow: '#ffd600', red: '#ff3b5c',
  gold: '#ffd700', silver: '#c0c8d8', bronze: '#cd7f32'
};

function areaGradient(ctx, color, a1 = 0.25, a2 = 0) {
  if (!ctx.chart?.chartArea) return 'transparent';
  const { top, bottom } = ctx.chart.chartArea;
  const g = ctx.chart.ctx.createLinearGradient(0, top, 0, bottom);
  const rgb = hexToRgb(color);
  g.addColorStop(0, `rgba(${rgb},${a1})`);
  g.addColorStop(1, `rgba(${rgb},${a2})`);
  return g;
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

const TOOLTIP_DEFAULTS = {
  backgroundColor: '#161920',
  borderColor: 'rgba(255,255,255,0.1)',
  borderWidth: 1,
  padding: 10,
  titleColor: '#b8c0d0',
  bodyColor: '#f4f6fa',
  cornerRadius: 6
};

// ============================================
// FITNESS TREND — with toggle + PB markers
// ============================================
function buildFitnessChart(canvasId, data, pbMarkers = []) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d => d.date.slice(5)),
      datasets: [
        {
          label: 'CTL', data: data.map(d => d.ctl),
          borderColor: C.accent, borderWidth: 2, fill: true,
          backgroundColor: ctx2 => areaGradient(ctx2, C.accent, 0.12),
          tension: 0.4, pointRadius: 0, pointHoverRadius: 4,
          pointHoverBackgroundColor: C.accent
        },
        {
          label: 'ATL', data: data.map(d => d.atl),
          borderColor: C.orange, borderWidth: 2, fill: false,
          tension: 0.4, pointRadius: 0, pointHoverRadius: 4,
          pointHoverBackgroundColor: C.orange
        },
        {
          label: 'TSB', data: data.map(d => d.tsb),
          borderColor: C.green, borderWidth: 1.5,
          borderDash: [4, 4], fill: false,
          tension: 0.4, pointRadius: 0, pointHoverRadius: 4,
          yAxisID: 'yTSB'
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 600 },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP_DEFAULTS,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}`
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { maxTicksLimit: 8 } },
        y: {
          position: 'left',
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { maxTicksLimit: 5 }
        },
        yTSB: {
          position: 'right', grid: { display: false },
          ticks: { maxTicksLimit: 5, color: C.green }
        }
      }
    },
    plugins: [{
      id: 'pbMarkers',
      afterDraw(chart) {
        if (!pbMarkers.length) return;
        const { ctx: c, chartArea, scales } = chart;
        pbMarkers.forEach(pb => {
          const idx = data.findIndex(d => d.date === pb.date);
          if (idx < 0) return;
          const x = scales.x.getPixelForValue(idx);
          const y = chartArea.bottom + 4;
          const color = pb.tier === 'gold' ? C.gold : pb.tier === 'silver' ? C.silver : C.bronze;
          const emoji = pb.type === 'cycling' ? '⚡' : '🏃';
          c.save();
          c.font = '10px sans-serif';
          c.fillStyle = color;
          c.textAlign = 'center';
          c.shadowColor = color;
          c.shadowBlur = 4;
          c.fillText(emoji, x, y + 12);
          c.restore();
        });
      }
    }]
  });

  return chart;
}

// ============================================
// FITNESS CHART TOGGLE (42d / 365d)
// ============================================
function setupFitnessToggle(canvasId, allData, pbMarkers) {
  let chart = buildFitnessChart(canvasId, allData.slice(-42), pbMarkers.filter(p => {
    const d = new Date(p.date);
    return d >= new Date(allData.slice(-42)[0]?.date);
  }));

  document.querySelectorAll('[data-fitness-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-fitness-toggle]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const days = parseInt(btn.dataset.fitnessToggle);
      const sliced = allData.slice(-days);
      const slicedPBs = pbMarkers.filter(p => p.date >= sliced[0]?.date);
      chart.destroy();
      chart = buildFitnessChart(canvasId, sliced, slicedPBs);
    });
  });
}

// ============================================
// WEEKLY TSS STACKED BAR
// ============================================
function buildTSSChart(canvasId, data) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const recent = data.slice(-24);

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: recent.map(d => d.week),
      datasets: [
        { label:'Ride',   data: recent.map(d => d.ride || 0),  backgroundColor:'rgba(0,229,255,0.75)',  borderRadius:2, borderSkipped:false },
        { label:'Run',    data: recent.map(d => d.run || 0),   backgroundColor:'rgba(0,255,135,0.75)',  borderRadius:2, borderSkipped:false },
        { label:'Row',    data: recent.map(d => d.row || 0),   backgroundColor:'rgba(168,85,247,0.75)', borderRadius:2, borderSkipped:false },
        { label:'Cardio', data: recent.map(d => d.other || 0), backgroundColor:'rgba(236,72,153,0.75)', borderRadius:2, borderSkipped:false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 400 },
      plugins: { legend: { display: false }, tooltip: TOOLTIP_DEFAULTS },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 10 } },
        y: { stacked: true, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { maxTicksLimit: 4 } }
      }
    }
  });
}

// ============================================
// HRV + SLEEP COMBINED CHART (dual axis)
// ============================================
function buildHRVSleepChart(canvasId, wellnessTrend, days = 42) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const sliced = {
    dates: wellnessTrend.dates.slice(-days),
    hrv:   wellnessTrend.hrv.slice(-days),
    sleep: wellnessTrend.sleep.slice(-days)
  };

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sliced.dates.map(d => d.slice(5)),
      datasets: [
        {
          label: 'Sleep (hrs)',
          data: sliced.sleep,
          backgroundColor: 'rgba(255,214,0,0.35)',
          borderColor: 'rgba(255,214,0,0.6)',
          borderWidth: 1,
          borderRadius: 2,
          type: 'bar',
          yAxisID: 'ySleep',
          order: 2
        },
        {
          label: 'HRV (ms)',
          data: sliced.hrv,
          borderColor: C.accent,
          borderWidth: 2,
          fill: true,
          backgroundColor: ctx2 => areaGradient(ctx2, C.accent, 0.15),
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: C.accent,
          type: 'line',
          yAxisID: 'yHRV',
          order: 1
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP_DEFAULTS,
          callbacks: {
            label: ctx => ctx.datasetIndex === 0
              ? ` Sleep: ${ctx.parsed.y}h`
              : ` HRV: ${ctx.parsed.y}ms`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
        yHRV: {
          position: 'left',
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { maxTicksLimit: 4, callback: v => v + 'ms', color: C.accent }
        },
        ySleep: {
          position: 'right',
          grid: { display: false },
          min: 0, max: 10,
          ticks: { maxTicksLimit: 4, callback: v => v + 'h', color: C.yellow }
        }
      }
    }
  });

  return chart;
}

function setupHRVSleepToggle(canvasId, wellnessTrend) {
  let chart = buildHRVSleepChart(canvasId, wellnessTrend, 42);

  document.querySelectorAll('[data-wellness-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-wellness-toggle]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chart.destroy();
      chart = buildHRVSleepChart(canvasId, wellnessTrend, parseInt(btn.dataset.wellnessToggle));
    });
  });
}

// ============================================
// POWER BESTS CHART
// ============================================
function buildPowerBestsChart(canvasId, data) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d => d.label),
      datasets: [
        {
          label: 'Power (W)', data: data.map(d => d.value),
          borderColor: C.accent, borderWidth: 2.5,
          fill: true, backgroundColor: ctx2 => areaGradient(ctx2, C.accent, 0.15),
          tension: 0.4, pointRadius: 4,
          pointBackgroundColor: C.accent, pointBorderColor: '#080a0d', pointBorderWidth: 2,
          yAxisID: 'yPower'
        },
        {
          label: 'HR (bpm)', data: data.map(d => d.hr),
          borderColor: C.red, borderWidth: 1.5, borderDash: [4, 4],
          fill: false, tension: 0.4, pointRadius: 0, pointHoverRadius: 3,
          yAxisID: 'yHR'
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP_DEFAULTS, callbacks: { label: c => c.datasetIndex === 0 ? ` ${c.parsed.y}W` : ` ${c.parsed.y}bpm` } }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' } },
        yPower: { position: 'left', grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => v + 'W', maxTicksLimit: 5 } },
        yHR:    { position: 'right', grid: { display: false }, ticks: { maxTicksLimit: 5, color: C.red } }
      }
    }
  });
}

// ============================================
// PACE BESTS CHART (fixed: sec/km from totalSec/distM)
// ============================================
function buildPaceBestsChart(canvasId, data) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const paceData = data.map(d => Math.round((d.totalSec / d.distM) * 1000));

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d => d.label),
      datasets: [
        {
          label: 'Pace', data: paceData,
          borderColor: C.green, borderWidth: 2.5,
          fill: true, backgroundColor: ctx2 => areaGradient(ctx2, C.green, 0.12),
          tension: 0.4, pointRadius: 4,
          pointBackgroundColor: C.green, pointBorderColor: '#080a0d', pointBorderWidth: 2,
          yAxisID: 'yPace'
        },
        {
          label: 'HR', data: data.map(d => d.hr),
          borderColor: C.red, borderWidth: 1.5, borderDash: [4, 4],
          fill: false, tension: 0.4, pointRadius: 0,
          yAxisID: 'yHR'
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP_DEFAULTS,
          callbacks: {
            label: ctx2 => {
              if (ctx2.datasetIndex === 0) {
                const v = ctx2.parsed.y;
                return ` ${Math.floor(v/60)}:${String(Math.round(v%60)).padStart(2,'0')}/km`;
              }
              return ` ${ctx2.parsed.y}bpm`;
            }
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' } },
        yPace: {
          position: 'left', reverse: true,
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { maxTicksLimit: 5, callback: v => { const m=Math.floor(v/60); const s=Math.floor(v%60); return `${m}:${String(s).padStart(2,'0')}`; } }
        },
        yHR: { position: 'right', grid: { display: false }, ticks: { maxTicksLimit: 5, color: C.red } }
      }
    }
  });
}

// ============================================
// POWER CURVE (Cycling page)
// ============================================
function buildPowerCurveChart(canvasId, current, prev = null, cp = null, p5min = null, p20min = null) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const datasets = [
    {
      label: '90-day bests', data: current.map(d => d.value),
      borderColor: C.accent, borderWidth: 2.5,
      fill: true, backgroundColor: ctx2 => areaGradient(ctx2, C.accent, 0.12),
      tension: 0.4, pointRadius: current.map((d,i) => {
        if (d.label==='5min'||d.label==='20min') return 5;
        return 3;
      }),
      pointBackgroundColor: current.map(d => {
        if (d.label==='5min') return C.green;
        if (d.label==='20min') return C.purple;
        return C.accent;
      }),
      pointBorderColor: '#080a0d', pointBorderWidth: 2
    }
  ];

  if (prev) {
    datasets.push({
      label: 'Previous 90d', data: prev.map(d => d.value),
      borderColor: 'rgba(255,255,255,0.18)', borderWidth: 1.5, borderDash: [4, 4],
      fill: false, tension: 0.4, pointRadius: 0
    });
  }

  // Annotation lines for CP, 5min, 20min
  const annotations = {};
  if (cp) annotations.cpLine = { type:'line', yMin:cp, yMax:cp, borderColor:'rgba(0,229,255,0.4)', borderWidth:1, borderDash:[6,4], label:{content:'CP '+cp+'W', enabled:true, color:C.accent, font:{size:10}} };
  if (p5min) annotations.p5Line = { type:'line', yMin:p5min, yMax:p5min, borderColor:'rgba(0,255,135,0.3)', borderWidth:1, borderDash:[4,4] };
  if (p20min) annotations.p20Line = { type:'line', yMin:p20min, yMax:p20min, borderColor:'rgba(168,85,247,0.3)', borderWidth:1, borderDash:[4,4] };

  return new Chart(ctx, {
    type: 'line',
    data: { labels: current.map(d => d.label), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: !!prev, labels: { color: '#b8c0d0', boxWidth: 12 } },
        tooltip: {
          ...TOOLTIP_DEFAULTS,
          callbacks: {
            label: c => {
              let s = ` ${c.parsed.y}W`;
              if (c.label==='5min') s += ' ← 5min';
              if (c.label==='20min') s += ' ← 20min/CP';
              return s;
            }
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => v + 'W', maxTicksLimit: 6 } }
      }
    }
  });
}

// ============================================
// PACE TREND LINE (Running page)
// ============================================
function buildPaceTrendChart(canvasId, dates, paceData) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates.map(d => d.slice(5)),
      datasets: [{
        label: 'Avg Pace', data: paceData,
        borderColor: C.green, borderWidth: 2,
        fill: true, backgroundColor: ctx2 => areaGradient(ctx2, C.green, 0.12),
        tension: 0.4, pointRadius: 3,
        pointBackgroundColor: C.green, pointBorderColor: '#080a0d', pointBorderWidth: 2,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP_DEFAULTS,
          callbacks: { label: c => { const v=c.parsed.y; return ` ${Math.floor(v/60)}:${String(Math.round(v%60)).padStart(2,'0')}/km`; } }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { maxTicksLimit: 8 } },
        y: {
          reverse: true,
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { maxTicksLimit: 5, callback: v => { const m=Math.floor(v/60); const s=Math.floor(v%60); return `${m}:${String(s).padStart(2,'0')}`; } }
        }
      }
    }
  });
}
