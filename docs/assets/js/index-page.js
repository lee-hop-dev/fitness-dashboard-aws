import { renderRing, renderLineChart, renderSparkline } from '/assets/js/charts-new.js';
import { calculateReadiness, getReadinessMessage, getReadinessColor } from '/assets/js/readiness.js';
import { getSportGlyph, getSportColor, formatDuration, formatDistance, formatPower, formatHeartRate, formatRelativeTime } from '/assets/js/sport-helpers.js';

// WP5: single memoised fetch for upcoming_events.json (previously fetched 3x per load)
let _upcomingEventsPromise = null;
function getUpcomingEvents() {
  if (!_upcomingEventsPromise) {
    _upcomingEventsPromise = fetch('data/upcoming_events.json', { cache: 'no-cache' })
      .then(r => {
        if (!r.ok) throw new Error(`upcoming_events ${r.status}`);
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('json')) throw new Error(`Expected JSON, got ${ct} for upcoming_events.json`);
        return r.json();
      })
      .catch(err => { _upcomingEventsPromise = null; throw err; });
  }
  return _upcomingEventsPromise;
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('🎨 New design system loading...');
    
    // API configuration (same as original index.html)
    const API_BASE = 'https://j2zxz92vd4.execute-api.eu-west-2.amazonaws.com/prod';
    const API_KEY = 'GCJhJuPjOs8o7pigoB75N8cfvZx78mXL6gj6qQzd';
    
    // Helper functions for activity types (used by recent activities and calendar)
    const normalizeActivityType = (type) => {
      if (!type) return 'Other';
      if (type.includes('Ride') || type.includes('Cycle')) return 'Cycling';
      if (type.includes('Run')) return 'Running';
      if (type.includes('Row')) return 'Rowing';
      if (type === 'Workout' || type === 'WeightTraining' || type === 'HIIT') return 'Cardio';
      return 'Other';
    };
    
    const getTypeInfo = (normalizedType) => {
      const types = {
        'Cycling': { label: 'Cycling', colorClass: 'type-ride', dotClass: 'dot-ride' },
        'Running': { label: 'Running', colorClass: 'type-run', dotClass: 'dot-run' },
        'Rowing': { label: 'Rowing', colorClass: 'type-row', dotClass: 'dot-row' },
        'Cardio': { label: 'Cardio', colorClass: 'type-cardio', dotClass: 'dot-cardio' },
        'Other': { label: 'Other', colorClass: 'type-other', dotClass: 'dot-other' }
      };
      return types[normalizedType] || types['Other'];
    };
    
    const formatDuration = (secs) => {
      if (!secs) return '—';
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      if (h > 0) return `${h}h${m}m`;
      return `${m}m`;
    };
    
    const formatPace = (secPerKm) => {
      if (!secPerKm) return '—';
      const min = Math.floor(secPerKm / 60);
      const sec = Math.floor(secPerKm % 60);
      return `${min}:${sec.toString().padStart(2, '0')}`;
    };
    
    const getTSS = (a) => a.tss || a.icu_training_load || 0;
    
    const getIntervalsActivityUrl = (id) => {
      const idStr = String(id);
      const activityId = idStr.startsWith('i') ? idStr : `i${idStr}`;
      return `https://intervals.icu/activities/${activityId}`;
    };
    
    // Load data from API Gateway (same as original page)
    // WP2: prefer the pre-aggregated static dashboard.json (written daily by
    // the collector Lambda, served via CloudFront with zero Lambda in the hot
    // path). Any problem — non-200, wrong content type, missing key, or
    // generated_at older than 48h — throws, and we fall back to the API path.
    let _dashPromise = null;
    const fetchDashboardStatic = () => {
      if (_dashPromise) return _dashPromise;
      _dashPromise = (async () => {
        const res = await fetch('data/dashboard.json');
        if (!res.ok) throw new Error(`dashboard.json returned ${res.status}`);
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('json')) throw new Error(`Expected JSON, got ${ct || 'no content-type'} for dashboard.json`);
        const dash = await res.json();
        const required = ['generated_at','activities','wellness','weekly_tss','ytd','athlete','power_curve','pace_curve','hr_curve'];
        for (const k of required) {
          if (!(k in dash)) throw new Error(`dashboard.json missing key: ${k}`);
        }
        const ageHours = (Date.now() - new Date(dash.generated_at).getTime()) / 3600000;
        if (!(ageHours >= 0 && ageHours < 48)) {
          throw new Error(`dashboard.json stale (generated_at ${dash.generated_at})`);
        }
        return dash;
      })().catch(err => { _dashPromise = null; throw err; });
      return _dashPromise;
    };

    // Local-calendar cutoff date. NEVER toISOString() — it returns UTC and in
    // BST produces yesterday's date, silently cutting off today's activities.
    const localSince = (days) => {
      const d = new Date();
      d.setDate(d.getDate() - days);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    };

    // Replicates the API's `start_date >= since` window on the 400-day static list
    const sliceActivities = (dashActivities, days) => {
      const since = localSince(days);
      const filtered = (dashActivities.activities || []).filter(a => (a.start_date || '') >= since);
      return { ...dashActivities, activities: filtered, count: filtered.length, since };
    };

    console.log('📡 Fetching data...');
    let activitiesResp, wellnessResp, ytdResp, weeklyTssResp;
    try {
      const dash = await fetchDashboardStatic();
      activitiesResp = sliceActivities(dash.activities, 90);
      wellnessResp   = dash.wellness;
      ytdResp        = dash.ytd;
      weeklyTssResp  = dash.weekly_tss;
      console.log(`✅ Static path: dashboard.json (generated ${dash.generated_at})`);
    } catch (staticErr) {
      console.log(`📡 API fallback path — ${staticErr.message}`);
      [activitiesResp, wellnessResp, ytdResp, weeklyTssResp] = await Promise.all([
        fetch(`${API_BASE}/activities?days=90&limit=1000`, { headers: { 'x-api-key': API_KEY } }).then(r => { if (!r.ok) throw new Error(`Activities: ${r.status}`); return r.json(); }),
        fetch(`${API_BASE}/wellness?days=180`, { headers: { 'x-api-key': API_KEY } }).then(r => { if (!r.ok) throw new Error(`Wellness: ${r.status}`); return r.json(); }),
        fetch(`${API_BASE}/ytd`, { headers: { 'x-api-key': API_KEY } }).then(r => { if (!r.ok) throw new Error(`YTD: ${r.status}`); return r.json(); }),
        fetch(`${API_BASE}/weekly-tss?weeks=52`, { headers: { 'x-api-key': API_KEY } }).then(r => { if (!r.ok) throw new Error(`Weekly TSS: ${r.status}`); return r.json(); })
      ]);
    }
    
    console.log('✅ Data fetched successfully');
    console.log('  Activities:', activitiesResp?.activities?.length || 0);
    console.log('  Wellness:', wellnessResp?.wellness?.length || 0);
    console.log('  YTD:', ytdResp);
    
    // Normalize data (matching original page data-loader.js patterns)
    
    // Normalize wellness: convert sleepSecs to hours, restingHR to resting_hr
    const normalizeWellness = (w) => ({
      ...w,
      resting_hr: w.restingHR != null ? w.restingHR : (w.resting_hr ?? null),
      sleep: w.sleepSecs != null ? Math.round(w.sleepSecs / 3600 * 10) / 10 : (w.sleep ?? null),
    });
    
    // Normalize YTD: aggregate by sport categories
    const normalizeYTD = (raw) => {
      const sports = raw.ytd || {};
      const CYCLING = ['Ride','VirtualRide','EBikeRide','EMountainBikeRide','GravelRide','MountainBikeRide','TrackRide','Velomobile'];
      const RUNNING = ['Run','VirtualRun','TrailRun'];
      const ROWING  = ['Rowing','VirtualRow'];
      const CARDIO  = ['Workout','WeightTraining','HighIntensityIntervalTraining','HIIT','CrossTraining','Yoga','Pilates','Calisthenics'];

      const sum = (keys) => keys.reduce((acc, k) => {
        const s = sports[k];
        if (!s) return acc;
        acc.distance  += s.distance_m    || 0;
        acc.hours     += (s.moving_time_s || 0) / 3600;
        acc.tss       += s.tss           || 0;
        acc.count     += s.count         || 0;
        acc.elevation += s.elevation_m   || 0;
        return acc;
      }, { distance: 0, hours: 0, tss: 0, count: 0, elevation: 0 });

      const round = o => ({
        distance:  Math.round(o.distance / 1000),
        hours:     Math.round(o.hours * 10) / 10,
        tss:       Math.round(o.tss),
        count:     o.count,
        elevation: Math.round(o.elevation),
      });

      const cycling = round(sum(CYCLING));
      const running = round(sum(RUNNING));
      const rowingRaw  = sum(ROWING);
      const cardioRaw  = sum(CARDIO);
      
      // Combine rowing + cardio
      const rowingCardio = round({
        distance: rowingRaw.distance + cardioRaw.distance,
        hours: rowingRaw.hours + cardioRaw.hours,
        tss: rowingRaw.tss + cardioRaw.tss,
        count: rowingRaw.count + cardioRaw.count,
        elevation: rowingRaw.elevation + cardioRaw.elevation
      });
      
      const knownKeys = [...CYCLING, ...RUNNING, ...ROWING, ...CARDIO];
      const other = round(sum(Object.keys(sports).filter(k => !knownKeys.includes(k))));

      const total = {
        distance:  cycling.distance  + running.distance  + rowingCardio.distance + other.distance,
        hours:     Math.round((cycling.hours + running.hours + rowingCardio.hours + other.hours) * 10) / 10,
        tss:       cycling.tss + running.tss + rowingCardio.tss + other.tss,
        count:     cycling.count + running.count + rowingCardio.count + other.count,
        elevation: cycling.elevation + running.elevation + rowingCardio.elevation + other.elevation,
      };
      
      // Log for debugging cardio accuracy
      console.log('📊 YTD Breakdown:', {
        rowing: round(rowingRaw),
        cardio: round(cardioRaw),
        combined: rowingCardio,
        rawSports: Object.keys(sports)
      });

      return { total, cycling, running, rowingCardio, other, raw: sports };
    };
    
    // Validate critical data - API returns {wellness: [...]} not just [...]
    const activities = activitiesResp.activities || [];
    const wellness = (wellnessResp.wellness || []).map(normalizeWellness);
    const ytd = normalizeYTD(ytdResp);
    
    if (!Array.isArray(activities)) throw new Error('Invalid activities data');
    if (!Array.isArray(wellness)) throw new Error('Invalid wellness data');
    
    console.log('✅ Data normalized');
    console.log('  YTD total:', ytd.total);
    console.log('  Wellness array length:', wellness.length);
    console.log('  Latest wellness record FULL:', JSON.stringify(wellness[wellness.length - 1]));
    console.log('  Latest wellness sleep:', wellness[wellness.length - 1]?.sleep);
    console.log('  Latest wellness HRV:', wellness[wellness.length - 1]?.hrv);
    console.log('  Latest wellness RHR:', wellness[wellness.length - 1]?.resting_hr);
    console.log('  Second-to-last wellness:', JSON.stringify(wellness[wellness.length - 2]));
    
    const data = {
      wellness: {
        latest: wellness[wellness.length - 1] || {}, // Last record = latest date
        recent: wellness
      },
      activities: activities,
      recentActivities: activities.slice(0, 20),
      ytdStats: ytd,
      weeklyTSS: weeklyTssResp.weekly_tss || weeklyTssResp
    };
    
    console.log('✅ Data structured successfully');
    console.log('  Latest wellness:', {
      ctl: data.wellness.latest.ctl,
      atl: data.wellness.latest.atl,
      hrv: data.wellness.latest.hrv,
      sleep: data.wellness.latest.sleep,
      rhr: data.wellness.latest.resting_hr
    });
    console.log('  YTD total:', data.ytdStats.total);
    console.log('  YTD rowingCardio:', data.ytdStats.rowingCardio);
    
    // Hide loading, show content
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('dashboard-content').classList.remove('hidden');
    
    // 1. Render Training Readiness Hero with Today's Planned Workout
    if (data.wellness) {
      // Calculate TSB for latest (CTL - ATL)
      if (data.wellness.latest) {
        data.wellness.latest.tsb = (data.wellness.latest.ctl || 0) - (data.wellness.latest.atl || 0);
      }
      
      const score = calculateReadiness(data.wellness);
      const message = getReadinessMessage(score);
      const color = getReadinessColor(score);
      
      // Render ring
      renderRing(document.getElementById('readiness-ring'), {
        value: score,
        max: 100,
        color: color,
        label: score,
        sub: 'Readiness'
      });
      
      // Update inline readiness status
      document.getElementById('readiness-score-inline').textContent = score;
      document.getElementById('readiness-message-inline').textContent = message;
      
      // Update live time
      const updateTime = () => {
        const now = new Date();
        document.getElementById('live-time').textContent = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      };
      updateTime();
      setInterval(updateTime, 1000);
      
      // Update YTD week/day
      const now = new Date();
      const start = new Date(now.getFullYear(), 0, 0);
      const diff = now - start;
      const oneDay = 1000 * 60 * 60 * 24;
      const dayOfYear = Math.floor(diff / oneDay);
      const weekOfYear = Math.ceil(dayOfYear / 7);
      document.getElementById('ytd-week').textContent = weekOfYear;
      document.getElementById('ytd-day').textContent = dayOfYear;
      
      // Today's planned workout - load from upcoming_events.json
      getUpcomingEvents()
        .then(events => {
          if (!events || events.length === 0) {
            return;
          }
          
          const today = now.toISOString().split('T')[0];
          const todayEvent = events.find(e => {
            const eventDate = e.start_date_local ? e.start_date_local.split('T')[0] : e.date;
            return eventDate === today;
          });
          
          if (todayEvent) {
            document.getElementById('today-workout-name').textContent = todayEvent.name || 'Workout';
            const meta = [];
            if (todayEvent.duration) meta.push(`~ ${todayEvent.duration}`);
            const load = todayEvent.icu_training_load || todayEvent.load;
            if (load) meta.push(`${Math.round(load)} TSS`);
            document.getElementById('today-workout-meta').textContent = meta.join(' · ');
            document.getElementById('today-why').textContent = todayEvent.description || 'Planned workout';
          }
        })
        .catch(() => {
          // No events file, leave defaults
        });
      
      // Current metrics (right column)
      const latest = data.wellness.latest || {};
      const ctl = latest.ctl || 0;
      const atl = latest.atl || 0;
      const tsb = latest.tsb || 0;
      
      document.getElementById('current-ctl').textContent = ctl.toFixed(1);
      document.getElementById('current-atl').textContent = atl.toFixed(1);
      document.getElementById('current-tsb').textContent = (tsb > 0 ? '+' : '') + tsb.toFixed(1);
      
      const ctl28d = (data.wellness.recent[data.wellness.recent.length - 1]?.ctl || 0) - (data.wellness.recent[data.wellness.recent.length - 29]?.ctl || 0); // Last vs 28 days ago
      const atl7d = (data.wellness.recent[data.wellness.recent.length - 1]?.atl || 0) - (data.wellness.recent[data.wellness.recent.length - 8]?.atl || 0); // Last vs 7 days ago
      document.getElementById('current-ctl-delta').textContent = (ctl28d > 0 ? '+' : '') + ctl28d.toFixed(1) + ' · 28d';
      document.getElementById('current-atl-delta').textContent = (atl7d > 0 ? '+' : '') + atl7d.toFixed(1) + ' · 7d';
    }
    
    // 2. Populate YTD Stats - TSS-first design with combined rowing+cardio
    if (data.ytdStats) {
      const cy = data.ytdStats.cycling || {};
      const ru = data.ytdStats.running || {};
      const row = data.ytdStats.rowingCardio || {}; // Combined rowing + cardio
      
      // Calculate totals
      const totalTss = (cy.tss || 0) + (ru.tss || 0) + (row.tss || 0);
      const totalHrs = (cy.hours || 0) + (ru.hours || 0) + (row.hours || 0);
      const totalDist = (cy.distance || 0) + (ru.distance || 0) + (row.distance || 0);
      
      // Totals column
      document.getElementById('ytd-total-dist').textContent = totalDist.toLocaleString();
      document.getElementById('ytd-total-hrs').textContent = (totalHrs || 0).toFixed(0) + 'h';
      document.getElementById('ytd-total-tss').textContent = (totalTss/1000 || 0).toFixed(1) + 'k';
      
      // Color bar - use TSS as flex basis
      const colorBar = document.getElementById('ytd-color-bar');
      const cyFlex = cy.tss || 1;
      const ruFlex = ru.tss || 1;
      const rowFlex = row.tss || 1;
      colorBar.innerHTML = `
        <div style="flex: ${cyFlex}; background: var(--accent)"></div>
        <div style="flex: ${ruFlex}; background: var(--accent-2)"></div>
        <div style="flex: ${rowFlex}; background: var(--accent-3)"></div>
      `;
      
      // Cycling - TSS primary
      const cyPrimary = (cy.tss || 0).toLocaleString() + ' TSS';
      document.getElementById('ytd-cy-primary').textContent = cyPrimary;
      document.getElementById('ytd-cy-hrs').textContent = (cy.hours || 0).toFixed(0) + 'h';
      document.getElementById('ytd-cy-tss').textContent = (cy.distance || 0).toLocaleString() + ' km';
      const cyPct = ((cy.tss / (totalTss || 1)) * 100).toFixed(0);
      document.getElementById('ytd-cy-pct').textContent = cyPct + '% of yearly TSS';
      document.getElementById('ytd-cy-progress').style.width = cyPct + '%';
      document.getElementById('ytd-cy-progress').style.background = 'linear-gradient(90deg, var(--accent), color-mix(in oklch, var(--accent) 30%, transparent))';
      
      // Running - TSS primary
      const ruPrimary = (ru.tss || 0).toLocaleString() + ' TSS';
      document.getElementById('ytd-ru-primary').textContent = ruPrimary;
      document.getElementById('ytd-ru-hrs').textContent = (ru.hours || 0).toFixed(0) + 'h';
      document.getElementById('ytd-ru-tss').textContent = (ru.distance || 0).toLocaleString() + ' km';
      const ruPct = ((ru.tss / (totalTss || 1)) * 100).toFixed(0);
      document.getElementById('ytd-ru-pct').textContent = ruPct + '% of yearly TSS';
      document.getElementById('ytd-ru-progress').style.width = ruPct + '%';
      document.getElementById('ytd-ru-progress').style.background = 'linear-gradient(90deg, var(--accent-2), color-mix(in oklch, var(--accent-2) 30%, transparent))';
      
      // Rowing & Cardio combined - TSS primary
      const rowPrimary = (row.tss || 0).toLocaleString() + ' TSS';
      document.getElementById('ytd-row-primary').textContent = rowPrimary;
      document.getElementById('ytd-row-hrs').textContent = (row.hours || 0).toFixed(0) + 'h';
      document.getElementById('ytd-row-tss').textContent = (row.distance || 0).toLocaleString() + ' km';
      const rowPct = ((row.tss / (totalTss || 1)) * 100).toFixed(0);
      document.getElementById('ytd-row-pct').textContent = rowPct + '% of yearly TSS';
      document.getElementById('ytd-row-progress').style.width = rowPct + '%';
      document.getElementById('ytd-row-progress').style.background = 'linear-gradient(90deg, var(--accent-3), color-mix(in oklch, var(--accent-3) 30%, transparent))';
    }
    
    // 2b. Populate Hero Cards Row with Sparklines
    if (data.wellness?.recent && data.wellness.recent.length > 0) {
      // Use latest non-null values (not just last record which might have nulls)
      const latest = getLatestWellness(data.wellness.recent);
      const recent = data.wellness.recent.slice(-28); // Last 28 days for sparklines
      
      // CTL
      const ctl = latest.ctl || 0;
      const ctlWeekAgo = data.wellness.recent[data.wellness.recent.length - 8]?.ctl || 0; // 7 days ago
      const ctlDelta = ctl - ctlWeekAgo;
      document.getElementById('hero-ctl-value').textContent = ctl.toFixed(1);
      document.getElementById('hero-ctl-delta').textContent = (ctlDelta > 0 ? '+' : '') + ctlDelta.toFixed(1) + ' · 7d';
      document.getElementById('hero-ctl-delta').className = 'hero-card-delta ' + (ctlDelta > 0 ? 'positive' : 'negative');
      
      const ctlData = recent.map(d => d.ctl || 0).reverse();
      renderSparkline(document.getElementById('hero-ctl-spark'), {
        data: ctlData,
        color: 'var(--accent)',
        fill: true
      });
      
      // ATL
      const atl = latest.atl || 0;
      const atlWeekAgo = data.wellness.recent[data.wellness.recent.length - 8]?.atl || 0;
      const atlDelta = atl - atlWeekAgo;
      document.getElementById('hero-atl-value').textContent = atl.toFixed(1);
      document.getElementById('hero-atl-delta').textContent = (atlDelta > 0 ? '+' : '') + atlDelta.toFixed(1) + ' · 7d';
      document.getElementById('hero-atl-delta').className = 'hero-card-delta ' + (atlDelta > 0 ? 'positive' : 'negative');
      
      const atlData = recent.map(d => d.atl || 0).reverse();
      renderSparkline(document.getElementById('hero-atl-spark'), {
        data: atlData,
        color: 'var(--accent-2)',
        fill: true
      });
      
      // TSB
      const tsb = latest.tsb || (ctl - atl);
      const tsbWeekAgo = data.wellness.recent[data.wellness.recent.length - 8]?.tsb || ((data.wellness.recent[data.wellness.recent.length - 8]?.ctl || 0) - (data.wellness.recent[data.wellness.recent.length - 8]?.atl || 0));
      const tsbDelta = tsb - tsbWeekAgo;
      document.getElementById('hero-tsb-value').textContent = (tsb > 0 ? '+' : '') + tsb.toFixed(1);
      document.getElementById('hero-tsb-delta').textContent = 'optimal range';
      
      const tsbData = recent.map(d => d.tsb || ((d.ctl || 0) - (d.atl || 0))).reverse();
      renderSparkline(document.getElementById('hero-tsb-spark'), {
        data: tsbData,
        color: 'var(--accent-3)',
        fill: false
      });
      
      // HRV
      const hrv = latest.hrv || 0;
      const hrv7d = recent.slice(-7).reduce((sum, d) => sum + (d.hrv || 0), 0) / 7; // Last 7 days
      document.getElementById('hero-hrv-value').textContent = hrv.toFixed(0);
      document.getElementById('hero-hrv-delta').textContent = hrv7d.toFixed(0) + ' · 7d avg';
      
      const hrvData = recent.map(d => d.hrv || 0).reverse();
      renderSparkline(document.getElementById('hero-hrv-spark'), {
        data: hrvData,
        color: 'var(--accent)',
        fill: true
      });
      
      // Sleep
      const sleep = latest.sleep || 0;
      const sleep7d = recent.slice(-7).reduce((sum, d) => sum + (d.sleep || 0), 0) / 7; // Last 7 days
      document.getElementById('hero-sleep-value').textContent = sleep.toFixed(1) + 'h';
      document.getElementById('hero-sleep-delta').textContent = sleep7d.toFixed(1) + 'h · 7d avg';
      
      const sleepData = recent.map(d => d.sleep || 0).reverse();
      renderSparkline(document.getElementById('hero-sleep-spark'), {
        data: sleepData,
        color: 'var(--accent-3)',
        fill: true
      });
      
      // Resting HR
      const rhr = latest.resting_hr || 0;
      const rhr7d = recent.slice(-7).reduce((sum, d) => sum + (d.resting_hr || 0), 0) / 7; // Last 7 days
      document.getElementById('hero-rhr-value').textContent = rhr > 0 ? rhr.toFixed(0) : '—';
      document.getElementById('hero-rhr-delta').textContent = rhr7d > 0 ? (rhr7d.toFixed(0) + ' · 7d avg') : '—';
      
      const rhrData = recent.map(d => d.resting_hr || 0).reverse();
      renderSparkline(document.getElementById('hero-rhr-spark'), {
        data: rhrData,
        color: 'var(--accent-2)',
        fill: false
      });
    }
    
    // 4. Render Fitness Trend Chart with Legend
    console.log('📈 Rendering fitness trend chart...');
    if (data.wellness?.recent) {
      const chartContainer = document.getElementById('fitness-chart');
      if (!chartContainer) {
        console.error('❌ Fitness chart container not found');
        throw new Error('Fitness chart container not found');
      }
      const chartData = data.wellness.recent.slice(-90); // Last 90 days (already in chronological order)
      
      console.log('  Chart data points:', chartData.length);
      
      // Calculate TSB from CTL and ATL (TSB = CTL - ATL)
      const series = [
        {
          key: 'ctl',
          data: chartData.map(d => d.ctl || 0),
          color: 'var(--accent)',
          strokeWidth: 2,
          fill: true,
          fillOpacity: 0.22
        },
        {
          key: 'atl',
          data: chartData.map(d => d.atl || 0),
          color: 'var(--accent-2)',
          strokeWidth: 1.4,
          fill: false
        },
        {
          key: 'tsb',
          data: chartData.map(d => (d.ctl || 0) - (d.atl || 0)),
          color: 'var(--accent-3)',
          strokeWidth: 1.4,
          dashed: true,
          fill: false
        }
      ];
      
      console.log('  Series prepared:', series.map(s => ({ key: s.key, points: s.data.length })));
      
      try {
        renderLineChart(chartContainer, {
          series,
          zeroLine: true,
          yAxis: {
            suggestedMin: -25,
            suggestedMax: 75,
            ticks: {
              stepSize: 25
            }
          }
        });
        console.log('✅ Chart render call completed');
      } catch (chartErr) {
        console.error('❌ Chart rendering failed:', chartErr);
        throw chartErr;
      }
      
      // Add legend after chart renders
      setTimeout(() => {
        const legendHTML = `
          <div style="display: flex; gap: 24px; justify-content: center; margin-top: 16px; font-family: var(--font-mono); font-size: 11px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="width: 20px; height: 3px; background: var(--accent);"></div>
              <span style="color: var(--fg-2);">CTL (Fitness)</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="width: 20px; height: 3px; background: var(--accent-2);"></div>
              <span style="color: var(--fg-2);">ATL (Fatigue)</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="width: 20px; height: 2px; background: var(--accent-3); border-top: 2px dashed var(--accent-3);"></div>
              <span style="color: var(--fg-2);">TSB (Form)</span>
            </div>
          </div>
        `;
        chartContainer.insertAdjacentHTML('afterend', legendHTML);
        console.log('✅ Fitness trend chart legend added');
      }, 100);
      console.log('✅ Fitness trend chart rendered successfully');
    } else {
      console.warn('⚠️ No wellness data available for fitness chart');
    }
    
    // 5. Populate Recent Activities - Hero Card Layout (from original page)
    console.log('📋 Populating recent activities with hero card layout...');
    if (data.recentActivities && data.recentActivities.length > 0) {
      const container = document.getElementById('recent-activities');
      if (!container) {
        console.error('❌ Recent activities container not found');
      } else {
        const activitiesToShow = data.recentActivities.slice(0, 10);
        console.log('  Activities to render:', activitiesToShow.length);
        
        // Helper functions for activity card rendering (from original page)
        
        // Render hero cards matching original page layout
        container.innerHTML = activitiesToShow.map(a => {
          const normalizedType = normalizeActivityType(a.type);
          const info = getTypeInfo(normalizedType);
          
          // Determine whether to show pace or power based on activity type
          const isRunning = info.label === 'Running';
          const isRowing = info.label === 'Rowing';
          const isCycling = info.label === 'Cycling';
          
          // Use correct field name from Intervals.icu API
          const power = a.power || a.avg_power || null;
          
          const paceSecKm = a.average_speed ? Math.round(1000/a.average_speed) : null;
          const paceSec500m = a.average_speed ? Math.round(500/a.average_speed) : null;
          
          // Debug first cycling activity
          if (isCycling && activitiesToShow.indexOf(a) === 0) {
            console.log('🚴 First cycling activity - checking ALL power fields:', {
              name: a.name,
              type: a.type,
              // Check every possible power field
              power: a.power,
              avg_power: a.avg_power,
              average_power: a.average_power,
              watts: a.watts,
              average_watts: a.average_watts,
              normalized_power: a.normalized_power,
              weighted_average_power: a.weighted_average_power,
              icu_average_watts: a.icu_average_watts,
              icu_weighted_avg_watts: a.icu_weighted_avg_watts
            });
          }
          
          let stat1val, stat1lbl;
          
          // Priority: sport-specific metric first
          if (isCycling && power) {
            // Cycling with power: show watts
            stat1val = `${Math.round(power)}W`;
            stat1lbl = 'Avg Power';
          } else if (isRunning && a.average_speed) {
            // Running: show pace per km
            stat1val = formatPace(paceSecKm);
            stat1lbl = 'Pace/km';
          } else if (isRowing && a.average_speed) {
            // Rowing: show pace per 500m
            stat1val = formatPace(paceSec500m);
            stat1lbl = 'Pace/500m';
          } else if (power) {
            // Any other sport with power
            stat1val = `${Math.round(power)}W`;
            stat1lbl = 'Avg Power';
          } else if (a.average_speed) {
            // Fallback: show pace per km
            stat1val = formatPace(paceSecKm);
            stat1lbl = 'Pace/km';
          } else {
            stat1val = '—';
            stat1lbl = 'Effort';
          }
          
          const activityDate = a.start_date || a.date;
          
          return `
            <div class="activity-card-hero" onclick="window.location='activity.html?id=${a.id}'" role="link" tabindex="0" aria-label="${a.name}">
              <div class="activity-card-wedge" onclick="event.stopPropagation();window.open('${getIntervalsActivityUrl(a.id)}','_blank','noopener,noreferrer')" title="Open in Intervals.icu"></div>
              <div class="activity-card-type ${info.colorClass}">
                <span class="type-dot ${info.dotClass}"></span>${info.label}
              </div>
              <div class="activity-card-name-hero">${a.name}</div>
              <div class="activity-card-stats-grid">
                <div class="activity-stat"><span class="activity-stat-value">${formatDuration(a.duration || a.moving_time)}</span><span class="activity-stat-label">Duration</span></div>
                <div class="activity-stat"><span class="activity-stat-value">${a.distance?(a.distance/1000).toFixed(1):'—'}</span><span class="activity-stat-label">km</span></div>
                <div class="activity-stat"><span class="activity-stat-value">${stat1val}</span><span class="activity-stat-label">${stat1lbl}</span></div>
                <div class="activity-stat"><span class="activity-stat-value">${a.average_heartrate||'—'}</span><span class="activity-stat-label">Avg HR</span></div>
              </div>
              <div class="activity-card-footer-hero">
                <span>${activityDate ? activityDate.split('T')[0] : '—'}</span>
                <span class="tss-val-hero">TSS ${Math.round(getTSS(a))}${a.if_val?' · IF '+a.if_val.toFixed(1):''}</span>
              </div>
            </div>`;
        }).join('');
        
        console.log('✅ Recent activities rendered with hero cards');
      }
    } else {
      console.warn('⚠️ No recent activities data available');
    }
    
    // 6. Render Training Heatmap (deferred 365-day fetch like original page)
    // WP2: the static file holds 400 days, so serve the heatmap from it too;
    // the memoised promise is already resolved by now, so this costs nothing.
    console.log('📅 Loading calendar data (365 days)...');
    fetchDashboardStatic()
      .then(dash => sliceActivities(dash.activities, 365).activities)
      .catch(() =>
        fetch(`${API_BASE}/activities?days=365&limit=1000`, {
          headers: { 'x-api-key': API_KEY }
        })
          .then(r => r.json())
          .then(resp => resp.activities || [])
      )
      .then(activities365 => {
        console.log('  Calendar activities loaded:', activities365.length);
        renderHeatmap(activities365);
      })
      .catch(err => {
        console.warn('⚠️ Calendar failed to load:', err);
      });
    
    // Render heatmap for Section 10
    function renderHeatmap(activities365) {
      const container = document.getElementById('calendar-heatmap');
      if (!container) return;
      
      container.innerHTML = ''; // Clear loading message
      
      const today = new Date();
      const oneYearAgo = new Date(today);
      oneYearAgo.setFullYear(today.getFullYear() - 1);
      
      // Build TSS by date map
      const tssByDate = {};
      activities365.forEach(a => {
        const dateStr = (a.start_date || a.date || '').split('T')[0];
        if (dateStr) {
          tssByDate[dateStr] = (tssByDate[dateStr] || 0) + (a.tss || a.icu_training_load || 0);
        }
      });
      
      // Create 53 weeks of cells (7 days each)
      const weeks = [];
      let currentDate = new Date(oneYearAgo);
      
      // Start from Sunday
      while (currentDate.getDay() !== 0) {
        currentDate.setDate(currentDate.getDate() - 1);
      }
      
      for (let week = 0; week < 53; week++) {
        const weekCells = [];
        for (let day = 0; day < 7; day++) {
          const dateStr = currentDate.toISOString().split('T')[0];
          const tss = tssByDate[dateStr] || 0;
          const intensity = tss === 0 ? 0 : Math.min(5, Math.ceil(tss / 30));
          
          weekCells.push({ date: dateStr, tss, intensity });
          currentDate.setDate(currentDate.getDate() + 1);
        }
        weeks.push(weekCells);
      }
      
      // Render as vertical columns (weeks) with horizontal days
      weeks.forEach(week => {
        const weekCol = document.createElement('div');
        weekCol.style.display = 'flex';
        weekCol.style.flexDirection = 'column';
        weekCol.style.gap = '3px';
        
        week.forEach(cell => {
          const cellEl = document.createElement('div');
          cellEl.className = 'calendar-cell';
          cellEl.setAttribute('data-intensity', cell.intensity);
          cellEl.title = `${cell.date}: ${cell.tss.toFixed(0)} TSS`;
          cellEl.style.width = '12px';
          cellEl.style.height = '12px';
          weekCol.appendChild(cellEl);
        });
        
        container.appendChild(weekCol);
      });
      
      console.log(`✅ Heatmap rendered: ${weeks.length} weeks`);
    }
    
    // Render Section 6: Upcoming Activities/Events
    console.log('📅 Rendering upcoming events from Intervals.icu API...');
    
    // Use static file for now since direct API calls are blocked by CORS
    getUpcomingEvents()
      .then(events => {
        console.log('  Loaded events from static file:', events.length);
        renderWeekPlan(events, data.activities);
        renderUpcomingRaces(events);
      })
      .catch(err => {
        console.warn('⚠️ Failed to load upcoming events:', err);
      });
    
    function renderWeekPlan(events, activities) {
      const container = document.getElementById('week-plan-grid');
      if (!container) return;
      
      const now = new Date();
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      
      // Show next 7 days starting from today
      for (let i = 0; i < 7; i++) {
        const dayDate = new Date(now);
        dayDate.setDate(now.getDate() + i);
        const dateStr = dayDate.toISOString().split('T')[0];
        const dayName = days[dayDate.getDay()];
        const dayNum = dayDate.getDate();
        
        const dayCard = document.createElement('div');
        dayCard.className = 'day-card';
        if (i === 0) { // Today
          dayCard.classList.add('today');
        }
        
        // Find event for this day from Intervals.icu
        const dayEvent = events.find(e => {
          const eventDate = e.start_date_local ? e.start_date_local.split('T')[0] : e.date;
          return eventDate === dateStr;
        });
        
        const completed = activities.some(a => (a.start_date || a.date || '').startsWith(dateStr));
        
        // Use Intervals.icu event data
        const load = dayEvent ? (dayEvent.icu_training_load || dayEvent.load || 50) : 0;
        const eventName = dayEvent ? (dayEvent.name || 'Workout') : null;
        const ifValue = dayEvent ? (dayEvent.if_val || dayEvent.icu_if) : null;
        
        // Determine color based on IF (preferred) or TSS
        let barColor;
        if (ifValue) {
          // Use IF: <0.75=easy (lime), 0.75-0.95=moderate (orange), >0.95=hard (red)
          if (ifValue < 0.75) {
            barColor = '#a8df7d'; // lime - easy
          } else if (ifValue < 0.95) {
            barColor = '#f4a261'; // orange - moderate
          } else {
            barColor = '#ef4444'; // red - hard
          }
        } else {
          // Fallback to TSS: <80=easy, 80-120=moderate, >120=hard
          if (load < 80) {
            barColor = '#a8df7d'; // lime
          } else if (load < 120) {
            barColor = '#f4a261'; // orange
          } else {
            barColor = '#ef4444'; // red
          }
        }
        
        dayCard.innerHTML = `
          <div class="day-card-header">
            <span class="day-label">${dayName} ${dayNum}</span>
            ${dayCard.classList.contains('today') ? '<div class="day-indicator"></div>' : ''}
            ${completed ? '<span style="color: var(--accent)">✓</span>' : ''}
          </div>
          ${eventName ? `
            <div class="workout-name">${eventName}</div>
            <div class="workout-bar">
              <div class="workout-bar-fill" style="height: ${Math.min(100, load / 2)}%; background: ${barColor};"></div>
            </div>
            <div class="workout-tss">${Math.round(load)} TSS${ifValue ? ' · IF ' + ifValue.toFixed(2) : ''}</div>
          ` : '<div class="workout-name" style="color: var(--text-3); font-size: 11px;">Rest day</div>'}
        `;
        
        container.appendChild(dayCard);
      }
    }
    
    function renderUpcomingRaces(events) {
      const container = document.getElementById('races-list');
      if (!container) return;
      
      const now = new Date();
      
      // Filter for:
      // 1. NOTE category events (race weeks, annotations — anything marked as a note in Intervals)
      // 2. RACE category events — A/B only (exclude C races)
      // WORKOUTs are intentionally excluded to preserve their full data in Intervals
      let upcomingEvents = events
        .filter(e => {
          if (!e.start_date_local && !e.date) return false;
          const eventDate = new Date(e.start_date_local || e.date);
          if (eventDate <= now) return false;

          // Include any NOTE category event
          if (e.category === 'NOTE') return true;

          // Include RACE category — exclude C races
          if (e.category === 'RACE') {
            const desc = (e.description || '').toLowerCase();
            if (desc.includes('c-race') || desc.includes('c race')) {
              console.log('  Excluding C-race:', e.name);
              return false;
            }
            return true;
          }

          return false;
        })
        .sort((a, b) => {
          const dateA = new Date(a.start_date_local || a.date);
          const dateB = new Date(b.start_date_local || b.date);
          return dateA - dateB;
        })
        .slice(0, 8); // Show up to 8 events
      
      console.log('  Displaying', upcomingEvents.length, 'upcoming events (A/B races + notes)');
      
      if (upcomingEvents.length === 0) {
        container.innerHTML = '<div style="padding: var(--space-2); color: var(--text-3); font-size: 12px;">No upcoming events</div>';
        return;
      }
      
      upcomingEvents.forEach(event => {
        const eventDate = new Date(event.start_date_local || event.date);
        const daysUntil = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));
        const duration = event.moving_time ? formatDuration(event.moving_time) : null;
        const load = event.icu_training_load || event.load;
        
        // Determine if it's a note vs race
        const isNote = event.show_as_note === true || (event.name || '').toLowerCase().includes('week');
        const eventType = isNote ? 'note' : 'race';
        
        const eventItem = document.createElement('div');
        eventItem.className = `race-item ${eventType}-item`;
        eventItem.innerHTML = `
          <div class="race-name">${event.name}</div>
          <div class="race-date">${eventDate.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}</div>
          <div class="race-meta">
            ${duration ? duration + ' · ' : ''}
            ${load ? Math.round(load) + ' TSS · ' : ''}\n            <span class="days-badge">${daysUntil}d</span>
          </div>
        `;
        container.appendChild(eventItem);
      });
    }
    
    // Render Section 7: Health Metrics
    console.log('💓 Rendering recovery metrics (combined chart)...');
    console.log('  Wellness data available:', data.wellness.recent.length, 'records');
    
    // Render combined HRV/Sleep/RHR chart
    renderCombinedHealthChart(data.wellness.recent);
    
    function renderCombinedHealthChart(wellness) {
      if (!wellness || wellness.length === 0) {
        console.warn('⚠️ No wellness data for combined chart');
        return;
      }
      
      // Get latest non-null values (not just last record)
      const latest = getLatestWellness(wellness);
      const recent7d = wellness.slice(-7);
      
      // Populate stats row
      document.getElementById('health-hrv-current').textContent = latest.hrv ? latest.hrv.toFixed(0) : '—';
      document.getElementById('health-rhr').textContent = latest.resting_hr ? latest.resting_hr.toFixed(0) + ' bpm' : '—';
      document.getElementById('health-sleep').textContent = latest.sleep ? latest.sleep.toFixed(1) + 'h' : '—';
      
      // Render 90d sparklines in stats row
      const recent90d = wellness.slice(-90);
      renderHealthStatSparkline('health-hrv-sparkline', recent90d.map(w => w.hrv || null), '#a8df7d');
      renderHealthStatSparkline('health-rhr-sparkline', recent90d.map(w => w.resting_hr || null), '#f4a261');
      renderHealthStatSparkline('health-sleep-sparkline', recent90d.map(w => w.sleep || null), '#7dd3fc');
      
      // Render chart (42d by default)
      renderHealthChart(wellness.slice(-42));
      
      // Add toggle listeners
      document.querySelectorAll('[data-health-range]').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('[data-health-range]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const days = parseInt(btn.dataset.healthRange);
          renderHealthChart(wellness.slice(-days));
        });
      });
    }
    
    function renderHealthStatSparkline(canvasId, data, color) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      // Filter out nulls
      const validData = data.filter(v => v !== null);
      if (validData.length === 0) return;
      
      const min = Math.min(...validData);
      const max = Math.max(...validData);
      const range = max - min || 1;
      
      // Set canvas size
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.scale(dpr, dpr);
      
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      const padding = 2;
      
      // Draw line
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      
      data.forEach((value, i) => {
        if (value === null) return;
        const x = (i / (data.length - 1)) * width;
        const y = height - padding - ((value - min) / range) * (height - padding * 2);
        if (i === 0 || data[i - 1] === null) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      
      ctx.stroke();
    }
    
    function renderHealthChart(wellness) {
      const canvas = document.getElementById('health-combined-chart');
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      // Destroy existing chart if any
      if (window.healthCombinedChartInstance) {
        window.healthCombinedChartInstance.destroy();
      }
      
      const hrvData = wellness.map(w => w.hrv || null);
      const sleepData = wellness.map(w => w.sleep || null);
      const rhrData = wellness.map(w => w.resting_hr || null);
      const dates = wellness.map(w => {
        if (!w.date) return '';
        const d = new Date(w.date);
        return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
      });
      
      console.log('  Combined chart data:', {
        days: wellness.length,
        hrvRange: [Math.min(...hrvData.filter(v => v !== null)), Math.max(...hrvData.filter(v => v !== null))],
        sleepRange: [Math.min(...sleepData.filter(v => v !== null)), Math.max(...sleepData.filter(v => v !== null))],
        rhrRange: [Math.min(...rhrData.filter(v => v !== null)), Math.max(...rhrData.filter(v => v !== null))]
      });
      
      // Create gradient for Resting HR
      const rhrGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      rhrGradient.addColorStop(0, 'rgba(244, 162, 97, 0.3)');
      rhrGradient.addColorStop(1, 'rgba(244, 162, 97, 0)');
      
      window.healthCombinedChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: dates,
          datasets: [
            {
              type: 'bar',
              label: 'Sleep',
              data: sleepData,
              backgroundColor: 'rgba(125, 211, 252, 0.4)',
              borderColor: '#7dd3fc',
              borderWidth: 1,
              yAxisID: 'y-sleep',
              barPercentage: 0.8,
              categoryPercentage: 0.9,
              order: 3
            },
            {
              type: 'line',
              label: 'HRV',
              data: hrvData,
              borderColor: '#a8df7d',
              backgroundColor: 'transparent',
              borderWidth: 2,
              fill: false,
              tension: 0.4,
              pointRadius: 0,
              pointHoverRadius: 4,
              yAxisID: 'y-hrv',
              spanGaps: true,
              order: 1
            },
            {
              type: 'line',
              label: 'Resting HR',
              data: rhrData,
              borderColor: '#f4a261',
              backgroundColor: rhrGradient,
              borderWidth: 2,
              fill: true,
              tension: 0.4,
              pointRadius: 0,
              pointHoverRadius: 4,
              yAxisID: 'y-rhr',
              spanGaps: true,
              order: 2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#1a1d24',
              borderColor: '#2a2d35',
              borderWidth: 1,
              titleColor: '#e8eaed',
              bodyColor: '#c4c7cc',
              padding: 8,
              displayColors: true,
              callbacks: {
                title: (items) => items[0].label,
                label: (item) => {
                  const value = item.parsed.y;
                  if (value === null) return null;
                  
                  if (item.dataset.label === 'Sleep') return `Sleep: ${value.toFixed(1)}h`;
                  if (item.dataset.label === 'HRV') return `HRV: ${value}ms`;
                  if (item.dataset.label === 'Resting HR') return `Resting HR: ${value}bpm`;
                  return '';
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { 
                color: '#8a8f98',
                font: { size: 10 }, 
                maxRotation: 0,
                autoSkip: true,
                maxTicksLimit: 8
              }
            },
            'y-sleep': {
              position: 'left',
              beginAtZero: true,
              max: 12,
              grid: { color: '#2a2d35' },
              ticks: { 
                color: '#7dd3fc',
                font: { size: 10 },
                callback: (value) => `${value}h`
              },
              title: {
                display: true,
                text: 'Sleep (hours)',
                color: '#7dd3fc',
                font: { size: 11 }
              }
            },
            'y-hrv': {
              position: 'right',
              beginAtZero: false,
              grid: { display: false },
              ticks: { 
                color: '#a8df7d',
                font: { size: 10 }
              },
              title: {
                display: true,
                text: 'HRV (ms)',
                color: '#a8df7d',
                font: { size: 11 }
              }
            },
            'y-rhr': {
              position: 'right',
              beginAtZero: false,
              grid: { display: false },
              ticks: { 
                color: '#f4a261',
                font: { size: 10 }
              },
              title: {
                display: true,
                text: 'RHR (bpm)',
                color: '#f4a261',
                font: { size: 11, weight: 'bold' }
              }
            }
          }
        }
      });
    }
    
    // Helper: Get latest non-null wellness values (matches data-loader.js pattern)
    function getLatestWellness(wellness) {
      const rev = [...wellness].reverse();
      return {
        ctl:        rev.find(w => w.ctl        != null)?.ctl,
        atl:        rev.find(w => w.atl        != null)?.atl,
        tsb:        rev.find(w => w.tsb        != null)?.tsb,
        hrv:        rev.find(w => w.hrv        != null)?.hrv,
        resting_hr: rev.find(w => w.resting_hr != null)?.resting_hr,
        sleep:      rev.find(w => w.sleep      != null)?.sleep,
        weight:     rev.find(w => w.weight     != null)?.weight,
      };
    }
    
    // Render Section 8: Weekly Load
    console.log('📊 Rendering weekly load...');
    console.log('  Weekly TSS data:', data.weeklyTSS);
    console.log('  Weekly TSS type:', typeof data.weeklyTSS, Array.isArray(data.weeklyTSS));
    renderWeeklyLoad(data.weeklyTSS);
    
    function renderWeeklyLoad(weeklyData) {
      const canvas = document.getElementById('weekly-load-chart');
      if (!canvas) {
        console.error('❌ Weekly load chart canvas not found');
        return;
      }
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      if (!weeklyData || weeklyData.length === 0) {
        console.warn('⚠️ No weekly TSS data available');
        return;
      }
      
      // Take last 12 weeks
      const recent12 = weeklyData.slice(-12);
      console.log('  Rendering', recent12.length, 'weeks');
      console.log('  Sample week:', recent12[0]);
      
      const labels = recent12.map(w => `W${w.week || ''}`);
      
      // Map sports object to separate arrays
      const cycling = recent12.map(w => {
        const s = w.sports || {};
        return (s.VirtualRide || 0) + (s.Ride || 0) + (s.GravelRide || 0);
      });
      const running = recent12.map(w => {
        const s = w.sports || {};
        return (s.Run || 0) + (s.VirtualRun || 0) + (s.TrailRun || 0);
      });
      const rowing = recent12.map(w => {
        const s = w.sports || {};
        return (s.Rowing || 0) + (s.VirtualRow || 0);
      });
      const cardio = recent12.map(w => {
        const s = w.sports || {};
        return (s.Workout || 0) + (s.WeightTraining || 0) + (s.HIIT || 0) + (s.CrossTraining || 0) + (s.Yoga || 0) + (s.Pilates || 0) + (s.Calisthenics || 0);
      });
      
      console.log('  Mapped data:');
      console.log('    Cycling:', cycling);
      console.log('    Running:', running);
      console.log('    Rowing:', rowing);
      console.log('    Cardio:', cardio);
      
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Cycling', data: cycling, backgroundColor: '#a8df7d', order: 1 },
            { label: 'Running', data: running, backgroundColor: '#f4a261', order: 2 },
            { label: 'Rowing', data: rowing, backgroundColor: '#9d84b7', order: 3 },
            { label: 'Cardio', data: cardio, backgroundColor: '#7dd3fc', order: 4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#1a1d24',
              borderColor: '#2a2d35',
              borderWidth: 1,
              titleColor: '#e8eaed',
              bodyColor: '#c4c7cc',
              padding: 12,
              displayColors: true,
              callbacks: {
                title: (items) => {
                  // Show week label
                  return items[0].label;
                },
                label: (context) => {
                  // Show each sport's TSS
                  return `${context.dataset.label}: ${context.parsed.y} TSS`;
                },
                footer: (items) => {
                  // Calculate and show total TSS
                  const total = items.reduce((sum, item) => sum + item.parsed.y, 0);
                  return `\nTotal: ${total} TSS`;
                }
              }
            }
          },
          scales: {
            x: {
              stacked: true,
              grid: { display: false },
              ticks: { 
                color: '#8a8f98',
                font: { size: 11, family: 'Geist Mono, monospace' }
              },
              title: {
                display: true,
                text: 'Week',
                color: '#8a8f98',
                font: { size: 12, weight: '600' }
              }
            },
            y: {
              stacked: true,
              beginAtZero: true,
              grid: { 
                color: '#2a2d35',
                lineWidth: 1
              },
              ticks: { 
                color: '#8a8f98',
                font: { size: 11, family: 'Geist Mono, monospace' },
                callback: (value) => value + ' TSS'
              },
              title: {
                display: true,
                text: 'Training Stress Score (TSS)',
                color: '#8a8f98',
                font: { size: 12, weight: '600' }
              }
            }
          }
        }
      });
    }
    
    // Render Section 9: Training Calendar (with week summaries) - LIFTED FROM ORIGINAL
    console.log('📅 Rendering training calendar with week summaries...');
    
    // Helper function for ISO week number calculation
    function getWeekNumber(date) {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    }
    
    renderCalendar(data.activities);
    
    function renderCalendar(activities) {
      const wrap = document.getElementById('training-calendar');
      if (!wrap) {
        console.error('❌ Training calendar container not found');
        return;
      }
      
      const today = new Date();
      const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      const actByDate = {};
      activities.forEach(a => { 
        const dateStr = (a.start_date || a.date || '').split('T')[0];
        if (!actByDate[dateStr]) actByDate[dateStr] = [];
        actByDate[dateStr].push(a);
      });

      // Load upcoming events from Intervals.icu
      const eventsByDate = {};
      getUpcomingEvents()
        .then(events => {
          events.forEach(e => {
            const date = e.start_date_local ? e.start_date_local.split('T')[0] : e.date;
            if (date) {
              if (!eventsByDate[date]) eventsByDate[date] = [];
              eventsByDate[date].push(e);
            }
          });
          renderCalendarWithEvents(actByDate, eventsByDate);
        })
        .catch(err => {
          console.log('No upcoming events data, rendering calendar without planned activities');
          renderCalendarWithEvents(actByDate, {});
        });

      function renderCalendarWithEvents(actByDate, eventsByDate) {
        // Start from beginning of current week (Monday), show current week at top
        const start = new Date(today);
        const dow = start.getDay();
        start.setDate(start.getDate() - (dow===0?6:dow-1)); // back to Monday of current week

        let html = `<div class="calendar-grid-header">
          <div class="cal-week-label-header">Week</div>
          ${dayNames.map(d=>`<div class="cal-day-header-new">${d}</div>`).join('')}
          <div class="cal-summary-header">Summary</div>
        </div>`;

        // Build 4 weeks: current week + 3 previous weeks
        const weeksData = [];
        const cursor = new Date(start);
        cursor.setDate(cursor.getDate() - 21); // Go back 3 weeks (21 days)
        
        for (let w=0; w<4; w++) {
          let weekTSS=0, weekHours=0;
          const days=[];
          for (let d=0; d<7; d++) {
            const ds = cursor.toISOString().split('T')[0];
            const acts = actByDate[ds]||[];
            const events = eventsByDate[ds]||[];
            weekTSS += acts.reduce((s,a)=>s+(a.tss||a.icu_training_load||0),0);
            weekHours += acts.reduce((s,a)=>s+((a.moving_time||a.duration||0)/3600),0);
            days.push({ 
              ds, 
              dayNum: cursor.getDate(), 
              acts, 
              events, 
              isToday: ds === today.toISOString().split('T')[0], 
              inRange: cursor <= today 
            });
            cursor.setDate(cursor.getDate()+1);
          }
          const wkNum = getWeekNumber(new Date(days[0].ds));
          weeksData.push({ wkNum, days, weekTSS, weekHours });
        }
        
        // Reverse the array so current week is first
        weeksData.reverse();
        
        // Render weeks
        weeksData.forEach(weekData => {
          html += `<div class="calendar-week-row">
            <div class="week-number">W${weekData.wkNum}</div>`;
          
          weekData.days.forEach(day => {
            const tss = day.acts.reduce((s,a)=>s+(a.tss||a.icu_training_load||0),0);
            const intensity = tss === 0 ? 0 : Math.min(5, Math.ceil(tss / 30));
            const hasActivity = day.acts.length > 0;
            const hasFutureEvent = day.events.length > 0 && day.ds >= today.toISOString().split('T')[0];
            const isFuture = day.ds > today.toISOString().split('T')[0];
            
            let cellClass = 'calendar-day-cell';
            if (day.isToday) cellClass += ' today';
            if (!hasActivity && !hasFutureEvent) cellClass += ' empty';
            if (isFuture) cellClass += ' future';
            
            let cellContent = '';
            if (hasActivity) {
              // Show completed activity
              const act = day.acts[0]; // Primary activity
              const actType = normalizeActivityType(act.type);
              const actInfo = getTypeInfo(actType);
              const duration = formatDuration(act.moving_time || act.duration);
              const actTSS = Math.round(act.tss || act.icu_training_load || 0);
              
              cellContent = `
                <span class="activity-type-badge activity-type-${actInfo.label.toLowerCase()}">${actInfo.label}</span>
                <div class="activity-name-cell">${act.name || 'Activity'}</div>
                <div class="activity-stats-cell">${duration} · ${actTSS} TSS</div>
              `;
            } else if (hasFutureEvent) {
              // Show planned event
              const event = day.events[0];
              const eventLoad = event.icu_training_load || event.load || 0;
              const eventDuration = event.moving_time ? formatDuration(event.moving_time) : '';
              
              cellContent = `
                <span class="activity-type-badge activity-type-other">Planned</span>
                <div class="activity-name-cell">${event.name || 'Workout'}</div>
                <div class="activity-stats-cell">${eventDuration}${eventDuration ? ' · ' : ''}${Math.round(eventLoad)} TSS</div>
              `;
            } else {
              // Empty day
              cellContent = '<div class="activity-name-cell" style="color: var(--text-3); font-size: 10px; text-align: center;">Rest</div>';
            }
            
            html += `<div class="${cellClass}" 
                         data-intensity="${intensity}" 
                         ${hasActivity ? `onclick="window.location='activity.html?id=${day.acts[0].id}'"` : ''}
                         style="cursor: ${hasActivity ? 'pointer' : 'default'}">
              ${cellContent}
            </div>`;
          });
          
          html += `<div class="week-summary">
            <div class="week-summary-tss">${Math.round(weekData.weekTSS)} TSS</div>
            <div class="week-summary-label">${formatWeekDuration(weekData.weekHours)}</div>
          </div></div>`;
        });
        
        wrap.innerHTML = html;
        console.log('✅ Calendar rendered with', weeksData.length, 'weeks');
      }
      
      function formatWeekDuration(hours) {
        const h = Math.floor(hours);
        const m = Math.round((hours - h) * 60);
        if (h > 0 && m > 0) return `${h}h ${m}m`;
        if (h > 0) return `${h}h`;
        if (m > 0) return `${m}m`;
        return '0m';
      }
    }
    
    // Render Section 11: 90 Day Best (Power & Pace Curves) - FROM ORIGINAL PAGE
    console.log('⚡ Rendering 90d best curves...');
    
    // Load both power and pace curves
    Promise.all([
      fetch('data/power_curves_90d.json').then(r => { if (!r.ok || !(r.headers.get('content-type')||'').includes('json')) throw new Error('power_curves_90d not JSON'); return r.json(); }).catch(() => null),
      fetch('data/pace_curves_90d.json').then(r => { if (!r.ok || !(r.headers.get('content-type')||'').includes('json')) throw new Error('pace_curves_90d not JSON'); return r.json(); }).catch(() => null)
    ]).then(([powerCurves90d, paceCurves90d]) => {
      
      // Helper function for duration labels (from original)
      function formatDurationLabel(secs) {
        if (secs < 60) return secs + 's';
        if (secs === 60) return '1min';
        if (secs < 3600) {
          const m = Math.floor(secs / 60);
          const s = secs % 60;
          return s === 0 ? m + 'min' : m + 'm' + s + 's';
        }
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        return m === 0 ? h + 'h' : h + 'h' + m + 'm';
      }
      
      // Parse power curves from Intervals (from original page logic)
      let powerBestsData = [];
      if (powerCurves90d && powerCurves90d.list && powerCurves90d.list.length > 0) {
        const curve = powerCurves90d.list[0];
        const durations = curve.secs || [];
        const watts = curve.values || [];
        
        powerBestsData = durations.map((sec, idx) => ({
          label: formatDurationLabel(sec),
          value: watts[idx],
          secs: sec
        }));
        console.log('  Power bests:', powerBestsData.length, 'points');
      }
      
      // Parse pace curves from Intervals - Running only (from original page logic)
      let paceBestsData = [];
      if (paceCurves90d && paceCurves90d.list && paceCurves90d.list.length > 0) {
        console.log('  Raw pace curves:', paceCurves90d.list.length, 'curves');
        console.log('  First curve type:', paceCurves90d.list[0].type);
        
        // Try to filter to running activities
        let runningCurves = paceCurves90d.list.filter(curve => {
          if (!curve.type) return false; // Only include if we know it's running
          return curve.type === 'Run' || curve.type === 'VirtualRun' || curve.type === 'TrailRun';
        });
        
        console.log('  Filtered running curves:', runningCurves.length);
        
        // If no running curves found, use first curve (assumes it's pace data)
        if (runningCurves.length === 0) {
          console.log('  No typed running curves, using first curve');
          runningCurves = [paceCurves90d.list[0]];
        }
        
        const curve = runningCurves[0];
        const distances = curve.distance || [];
        const times = curve.values || [];
        
        console.log('  Distances:', distances.length, 'Times:', times.length);
        
        paceBestsData = distances.map((distM, idx) => {
          let label;
          if (distM === 100) label = '100m';
          else if (distM === 200) label = '200m';
          else if (distM === 400) label = '400m';
          else if (distM === 800) label = '800m';
          else if (distM === 1000) label = '1km';
          else if (distM === 1500) label = '1500m';
          else if (distM === 1609) label = '1 mile';
          else if (distM === 3000) label = '3km';
          else if (distM === 5000) label = '5km';
          else if (distM === 8000) label = '5 mile';
          else if (distM === 10000) label = '10km';
          else if (distM === 16093) label = '10 mile';
          else if (distM === 21097) label = 'Half';
          else if (distM === 42195) label = 'Marathon';
          else if (distM < 1000) label = Math.round(distM) + 'm';
          else label = (distM / 1000).toFixed(1) + 'km';
          
          return {
            label: label,
            totalSec: times[idx],
            distM: distM
          };
        }).filter(d => d.distM >= 400); // Start at 400m
        console.log('  Pace bests:', paceBestsData.length, 'points (filtered >=400m)');
      } else {
        console.warn('  No pace curves data available');
      }
      
      // Build charts with design theme colors
      if (powerBestsData.length) buildPowerCurveChart(powerBestsData);
      if (paceBestsData.length) buildPaceCurveChart(paceBestsData);
      
      // Hide pace chart initially (after both have rendered)
      setTimeout(() => {
        document.getElementById('pace-curve-wrapper').style.display = 'none';
      }, 100);
      
      // Setup toggle between power and pace curves
      document.querySelectorAll('.curve-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const chartType = btn.dataset.chart;
          
          // Update button states
          document.querySelectorAll('.curve-toggle-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          
          // Show/hide charts
          if (chartType === 'power') {
            document.getElementById('power-curve-wrapper').style.display = 'block';
            document.getElementById('pace-curve-wrapper').style.display = 'none';
          } else {
            document.getElementById('power-curve-wrapper').style.display = 'none';
            document.getElementById('pace-curve-wrapper').style.display = 'block';
          }
        });
      });
      
      // Power curve chart function (from original, with design theme applied)
      function buildPowerCurveChart(data) {
        const ctx = document.getElementById('power-curve-chart');
        if (!ctx) return;
        
        const labels = data.map(d => d.label);
        const values = data.map(d => d.value);
        
        // Find indices for key durations
        const idx10s = labels.indexOf('10s');
        const idx1min = labels.indexOf('1min');
        const idx5min = labels.indexOf('5min');
        const idx20min = labels.indexOf('20min');
        
        new Chart(ctx, {
          type: 'line',
          data: {
            labels,
            datasets: [{
              label: 'Power',
              data: values,
              borderColor: '#a8df7d',
              backgroundColor: 'rgba(168, 223, 125, 0.15)',
              borderWidth: 2.5,
              pointRadius: function(context) {
                const index = context.dataIndex;
                if (index === idx10s || index === idx1min || index === idx5min || index === idx20min) return 5;
                return 0;
              },
              pointBackgroundColor: function(context) {
                const index = context.dataIndex;
                if (index === idx10s) return '#f97316';
                if (index === idx1min) return '#22c55e';
                if (index === idx5min) return '#6c63ff';
                if (index === idx20min) return '#ff7043';
                return '#a8df7d';
              },
              pointHoverRadius: 6,
              fill: true,
              tension: 0.4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: '#1a1d24',
                borderColor: '#2a2d35',
                borderWidth: 1,
                titleColor: '#e8eaed',
                bodyColor: '#c4c7cc',
                padding: 12,
                displayColors: false,
                callbacks: { label: (ctx) => ctx.parsed.y + 'W' }
              },
              annotation: {
                annotations: {
                  line10s: idx10s >= 0 ? {
                    type: 'line', xMin: idx10s, xMax: idx10s,
                    borderColor: '#f97316', borderWidth: 1, borderDash: [5, 5],
                    label: { display: true, content: '10s: ' + values[idx10s] + 'W', position: 'start',
                      backgroundColor: 'rgba(249, 115, 22, 0.9)', color: '#fff', font: { size: 10 } }
                  } : {},
                  line1min: idx1min >= 0 ? {
                    type: 'line', xMin: idx1min, xMax: idx1min,
                    borderColor: '#22c55e', borderWidth: 1, borderDash: [5, 5],
                    label: { display: true, content: '1min: ' + values[idx1min] + 'W', position: 'start',
                      backgroundColor: 'rgba(34, 197, 94, 0.9)', color: '#fff', font: { size: 10 } }
                  } : {},
                  line5min: idx5min >= 0 ? {
                    type: 'line', xMin: idx5min, xMax: idx5min,
                    borderColor: '#6c63ff', borderWidth: 1, borderDash: [5, 5],
                    label: { display: true, content: '5min: ' + values[idx5min] + 'W', position: 'start',
                      backgroundColor: 'rgba(108, 99, 255, 0.9)', color: '#fff', font: { size: 10 } }
                  } : {},
                  line20min: idx20min >= 0 ? {
                    type: 'line', xMin: idx20min, xMax: idx20min,
                    borderColor: '#ff7043', borderWidth: 1, borderDash: [5, 5],
                    label: { display: true, content: '20min: ' + values[idx20min] + 'W', position: 'start',
                      backgroundColor: 'rgba(255, 112, 67, 0.9)', color: '#fff', font: { size: 10 } }
                  } : {}
                }
              }
            },
            scales: {
              x: {
                grid: { 
                  display: true,
                  color: '#2a2d35',
                  lineWidth: 1
                },
                border: {
                  display: true,
                  color: '#3a3d45',
                  width: 2
                },
                ticks: { 
                  color: '#a0a4b0', 
                  font: { size: 11, family: 'Geist Mono, monospace', weight: '500' },
                  autoSkip: true, 
                  maxTicksLimit: 12,
                  padding: 8,
                  callback: function(value) {
                    const label = this.getLabelForValue(value);
                    const showLabels = ['5s', '30s', '1min', '5min', '20min', '30min', '60min'];
                    return showLabels.includes(label) ? label : '';
                  }
                },
                title: { 
                  display: true, 
                  text: 'Duration', 
                  color: '#e8eaed', 
                  font: { size: 13, weight: '600', family: 'Geist Sans, sans-serif' },
                  padding: { top: 12 }
                }
              },
              y: {
                grid: { 
                  color: '#2a2d35',
                  lineWidth: 1
                },
                border: {
                  display: true,
                  color: '#3a3d45',
                  width: 2
                },
                ticks: { 
                  color: '#a0a4b0', 
                  font: { size: 11, family: 'Geist Mono, monospace', weight: '500' },
                  padding: 8,
                  callback: (value) => value + 'W', 
                  stepSize: 50
                },
                title: { 
                  display: true, 
                  text: 'Power (Watts)', 
                  color: '#e8eaed', 
                  font: { size: 13, weight: '600', family: 'Geist Sans, sans-serif' },
                  padding: { bottom: 12 }
                },
                beginAtZero: false
              }
            }
          }
        });
        console.log('✅ Power curve rendered');
      }
      
      // Pace curve chart function (from original, with design theme applied)
      function buildPaceCurveChart(data) {
        const ctx = document.getElementById('pace-curve-chart');
        if (!ctx) {
          console.error('❌ Pace curve canvas not found');
          return;
        }
        
        console.log('📊 Building pace curve chart with', data.length, 'points');
        
        const labels = data.map(d => d.label);
        const paceValues = data.map(d => {
          const paceSecPerKm = (d.totalSec / d.distM) * 1000;
          return paceSecPerKm / 60; // Convert to minutes
        });
        
        console.log('  Sample labels:', labels.slice(0, 5));
        console.log('  Sample pace values:', paceValues.slice(0, 5));
        
        // Find indices for key distances
        const idx1500 = labels.findIndex(l => l === '1.5km' || l === '1500m');
        const idx5k = labels.findIndex(l => l === '5km' || l === '5.0km');
        const idx10k = labels.findIndex(l => l === '10km' || l === '10.0km');
        
        console.log('  Key indices - 1500m:', idx1500, '5K:', idx5k, '10K:', idx10k);
        
        new Chart(ctx, {
          type: 'line',
          data: {
            labels,
            datasets: [{
              label: 'Pace',
              data: paceValues,
              borderColor: '#f4a261',
              backgroundColor: 'rgba(244, 162, 97, 0.15)',
              borderWidth: 2.5,
              pointRadius: function(context) {
                const index = context.dataIndex;
                if (index === idx1500 || index === idx5k || index === idx10k) return 5;
                return 0;
              },
              pointBackgroundColor: function(context) {
                const index = context.dataIndex;
                if (index === idx1500) return '#f97316';
                if (index === idx5k) return '#22c55e';
                if (index === idx10k) return '#6c63ff';
                return '#f4a261';
              },
              pointHoverRadius: 6,
              fill: true,
              tension: 0.4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: '#1a1d24',
                borderColor: '#2a2d35',
                borderWidth: 1,
                titleColor: '#e8eaed',
                bodyColor: '#c4c7cc',
                padding: 12,
                displayColors: false,
                callbacks: {
                  label: (ctx) => {
                    const mins = Math.floor(ctx.parsed.y);
                    const secs = Math.round((ctx.parsed.y - mins) * 60);
                    return mins + ':' + String(secs).padStart(2, '0') + '/km';
                  }
                }
              },
              annotation: {
                annotations: {
                  line1500: idx1500 >= 0 ? {
                    type: 'line', xMin: idx1500, xMax: idx1500,
                    borderColor: '#f97316', borderWidth: 1, borderDash: [5, 5],
                    label: { display: true, 
                      content: '1500m: ' + Math.floor(paceValues[idx1500]) + ':' + String(Math.round((paceValues[idx1500] - Math.floor(paceValues[idx1500])) * 60)).padStart(2, '0') + '/km',
                      position: 'start', backgroundColor: 'rgba(249, 115, 22, 0.9)', color: '#fff', font: { size: 10 } }
                  } : {},
                  line5k: idx5k >= 0 ? {
                    type: 'line', xMin: idx5k, xMax: idx5k,
                    borderColor: '#22c55e', borderWidth: 1, borderDash: [5, 5],
                    label: { display: true,
                      content: '5K: ' + Math.floor(paceValues[idx5k]) + ':' + String(Math.round((paceValues[idx5k] - Math.floor(paceValues[idx5k])) * 60)).padStart(2, '0') + '/km',
                      position: 'start', backgroundColor: 'rgba(34, 197, 94, 0.9)', color: '#fff', font: { size: 10 } }
                  } : {},
                  line10k: idx10k >= 0 ? {
                    type: 'line', xMin: idx10k, xMax: idx10k,
                    borderColor: '#6c63ff', borderWidth: 1, borderDash: [5, 5],
                    label: { display: true,
                      content: '10K: ' + Math.floor(paceValues[idx10k]) + ':' + String(Math.round((paceValues[idx10k] - Math.floor(paceValues[idx10k])) * 60)).padStart(2, '0') + '/km',
                      position: 'start', backgroundColor: 'rgba(108, 99, 255, 0.9)', color: '#fff', font: { size: 10 } }
                  } : {}
                }
              }
            },
            scales: {
              x: {
                grid: { 
                  display: true,
                  color: '#2a2d35',
                  lineWidth: 1
                },
                border: {
                  display: true,
                  color: '#3a3d45',
                  width: 2
                },
                ticks: { 
                  color: '#a0a4b0', 
                  font: { size: 11, family: 'Geist Mono, monospace', weight: '500' },
                  autoSkip: true, 
                  maxTicksLimit: 10,
                  padding: 8,
                  callback: function(value) {
                    const label = this.getLabelForValue(value);
                    const showLabels = ['400m', '0.4km', '1km', '1.0km', '1.5km', '1500m', '5km', '5.0km', '10km', '10.0km'];
                    return showLabels.includes(label) ? label : '';
                  }
                },
                title: { 
                  display: true, 
                  text: 'Distance', 
                  color: '#e8eaed', 
                  font: { size: 13, weight: '600', family: 'Geist Sans, sans-serif' },
                  padding: { top: 12 }
                }
              },
              y: {
                reverse: true,
                grid: { 
                  color: '#2a2d35',
                  lineWidth: 1
                },
                border: {
                  display: true,
                  color: '#3a3d45',
                  width: 2
                },
                ticks: { 
                  color: '#a0a4b0', 
                  font: { size: 11, family: 'Geist Mono, monospace', weight: '500' },
                  padding: 8,
                  callback: (value) => {
                    const mins = Math.floor(value);
                    const secs = Math.round((value - mins) * 60);
                    return mins + ':' + String(secs).padStart(2, '0');
                  }
                },
                title: { 
                  display: true, 
                  text: 'Pace (min/km)', 
                  color: '#e8eaed', 
                  font: { size: 13, weight: '600', family: 'Geist Sans, sans-serif' },
                  padding: { bottom: 12 }
                }
              }
            }
          }
        });
        console.log('✅ Pace curve rendered');
      }
    });
    
    console.log('✅ Design system page loaded successfully');
    
  } catch (err) {
    console.error('❌ FATAL ERROR loading dashboard:', err);
    console.error('Error message:', err.message);
    console.error('Stack trace:', err.stack);
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('error-state').classList.remove('hidden');
    document.getElementById('error-msg').textContent = err.message;
  }
});
