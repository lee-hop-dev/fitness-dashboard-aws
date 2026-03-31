/* ============================================
   FITNESS DASHBOARD — DATA LOADER
   AWS Phase 4: reads from API Gateway endpoints
   API base URL: update API_BASE if it changes
   ============================================ */

// ── API configuration ────────────────────────────────────────────────────────
const API_BASE = 'https://j2zxz92vd4.execute-api.eu-west-2.amazonaws.com/prod';

const DATA = {
  _cache: {},

  // ── Internal: fetch one API endpoint, cache by key ────────────────────────
  async _fetch(endpoint, params = {}) {
    const cacheKey = endpoint + JSON.stringify(params);
    if (this._cache[cacheKey]) return this._cache[cacheKey];

    const url = new URL(`${API_BASE}${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`API ${endpoint} returned ${res.status}`);

    const data = await res.json();
    this._cache[cacheKey] = data;
    return data;
  },

  // ── Normalise YTD API response into the shape pages expect ───────────────
  // API returns: { ytd: { Ride: {count,tss,moving_time_s,distance_m,elevation_m}, Run:{...}, ... } }
  // Pages expect: { total:{distance,hours,tss}, cycling:{distance,hours,tss}, running:{distance,hours,tss}, rowing:{...} }
  _normaliseYTD(raw) {
    const sports = raw.ytd || {};

    // Sum across all sport-type keys that belong to each category
    const CYCLING = ['Ride','VirtualRide','EBikeRide','EMountainBikeRide','GravelRide','MountainBikeRide','TrackRide','Velomobile'];
    const RUNNING = ['Run','VirtualRun','TrailRun'];
    const ROWING  = ['Rowing','VirtualRow'];

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

    // Round for display
    const round = o => ({
      distance:  Math.round(o.distance / 1000),   // metres → km
      hours:     Math.round(o.hours * 10) / 10,
      tss:       Math.round(o.tss),
      count:     o.count,
      elevation: Math.round(o.elevation),
    });

    const cycling = round(sum(CYCLING));
    const running = round(sum(RUNNING));
    const rowing  = round(sum(ROWING));

    // Other = everything not in the above categories
    const knownKeys = [...CYCLING, ...RUNNING, ...ROWING];
    const otherKeys = Object.keys(sports).filter(k => !knownKeys.includes(k));
    const other = round(sum(otherKeys));

    const total = {
      distance:  cycling.distance  + running.distance  + rowing.distance  + other.distance,
      hours:     Math.round((cycling.hours + running.hours + rowing.hours + other.hours) * 10) / 10,
      tss:       cycling.tss + running.tss + rowing.tss + other.tss,
      count:     cycling.count + running.count + rowing.count + other.count,
      elevation: cycling.elevation + running.elevation + rowing.elevation + other.elevation,
    };

    return { total, cycling, running, rowing, other, raw: sports };
  },

  // ── Normalise weeklyTSS API response into the shape charts.js expects ────
  // API returns: [{ week, sports: { Ride:n, VirtualRide:n, Run:n, ... }, total:n }]
  // charts.js expects: [{ week, ride, run, row, other }]
  _normaliseWeeklyTSS(raw) {
    const CYCLING = ['Ride','VirtualRide','EBikeRide','EMountainBikeRide','GravelRide','MountainBikeRide','TrackRide','Velomobile'];
    const RUNNING = ['Run','VirtualRun','TrailRun'];
    const ROWING  = ['Rowing','VirtualRow'];

    return (raw || []).map(w => {
      const s = w.sports || {};
      const sumKeys = keys => keys.reduce((t, k) => t + (s[k] || 0), 0);
      const knownKeys = [...CYCLING, ...RUNNING, ...ROWING];
      const otherTSS  = Object.keys(s)
        .filter(k => !knownKeys.includes(k))
        .reduce((t, k) => t + (s[k] || 0), 0);

      return {
        week:  w.week,
        ride:  Math.round(sumKeys(CYCLING)),
        run:   Math.round(sumKeys(RUNNING)),
        row:   Math.round(sumKeys(ROWING)),
        other: Math.round(otherTSS),
        total: Math.round(w.total || 0),
      };
    });
  },

  // ── loadAll: mirrors the old static-JSON contract for all pages ──────────
  async loadAll() {
    const [
      activitiesResp,
      wellnessResp,
      weeklyTSSResp,
      ytdResp,
      athleteResp,
      powerCurveResp,
      paceCurveResp,
      hrCurveResp,
      heatmap1yResp,
      heatmap3yResp,
    ] = await Promise.all([
      this._fetch('/activities',  { days: 90,   limit: 500  }),
      this._fetch('/wellness',    { days: 180 }),
      this._fetch('/weekly-tss',  { weeks: 52  }),
      this._fetch('/ytd'),
      this._fetch('/athlete'),
      this._fetch('/power-curve'),
      this._fetch('/pace-curve'),
      this._fetch('/hr-curve'),
      this._fetch('/activities',  { days: 365,  limit: 1000 }),
      this._fetch('/activities',  { days: 1095, limit: 3000 }),
    ]);

    // activities — unwrap envelope
    const activities = activitiesResp.activities || [];

    // wellness — unwrap envelope (chronological from API)
    const wellness = wellnessResp.wellness || [];

    // weeklyTSS — normalise sport keys to { week, ride, run, row, other }
    const weeklyTSS = this._normaliseWeeklyTSS(weeklyTSSResp.weekly_tss);

    // ytd — normalise to { total, cycling, running, rowing, other }
    const ytd = this._normaliseYTD(ytdResp);

    // heatmaps — activity arrays for date/sport colouring
    const heatmap1y = heatmap1yResp.activities || [];
    const heatmap3y = heatmap3yResp.activities || [];

    // athlete — map Intervals.icu field names to expected keys
    const profile = athleteResp.profile || {};
    const athlete = {
      ...profile,
      ftp:     profile.icu_ftp     || profile.ftp     || null,
      w_prime: profile.icu_w_prime || profile.w_prime  || null,
      weight:  profile.icu_weight  || profile.weight   || null,
    };

    // meta — assemble from three curve endpoints
    const meta = {
      ...powerCurveResp,
      power_curve: powerCurveResp.watts
                || powerCurveResp.power_curve
                || powerCurveResp.powerCurve
                || null,
      pace_curve:  paceCurveResp,
      hr_curve:    hrCurveResp,
      power_secs:  powerCurveResp.secs || null,
      pace_secs:   paceCurveResp.secs  || null,
      hr_secs:     hrCurveResp.secs    || null,
    };

    return { activities, wellness, weeklyTSS, ytd, heatmap1y, heatmap3y, athlete, meta };
  },

  // ── Helpers ───────────────────────────────────────────────────────────────

  latestWellness(wellness) {
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
  },

  recentActivities(activities, days = 7) {
    const cutoff = new Date(Date.now() - days * 864e5).toISOString().split('T')[0];
    return activities.filter(a => (a.start_date || a.date) >= cutoff);
  },

  powerBests(activities) {
    const cutoff = new Date(Date.now() - 90 * 864e5).toISOString().split('T')[0];
    const rides  = activities.filter(a =>
      (a.type === 'Ride' || a.type === 'VirtualRide') &&
      (a.start_date || a.date) >= cutoff &&
      (a.icu_average_watts || a.avg_power)
    );
    if (!rides.length) return [];

    const maxPower = Math.max(...rides.map(r => r.icu_average_watts || r.avg_power || 0));
    const cp = Math.round(maxPower * 0.95);

    const labels  = ['5s','10s','15s','30s','1min','2min','3min','5min','6min','8min','10min','12min','15min','20min','30min','40min','60min','90min'];
    const factors = [3.6, 3.3, 3.1, 2.8, 2.3, 1.85, 1.65, 1.45, 1.38, 1.28, 1.18, 1.12, 1.07, 1.02, 0.96, 0.92, 0.87, 0.80];
    const hrs     = [158, 160, 162, 165, 172, 178, 180, 182, 181, 180, 178, 177, 175, 173, 170, 168, 165, 161];

    return labels.map((label, i) => ({
      label,
      value: Math.round(cp * factors[i]),
      hr:    hrs[i]
    }));
  },

  paceBests(activities) {
    const cutoff = new Date(Date.now() - 90 * 864e5).toISOString().split('T')[0];
    const runs   = activities.filter(a =>
      (a.type === 'Run' || a.type === 'VirtualRun') &&
      (a.start_date || a.date) >= cutoff &&
      a.avg_speed && a.avg_speed > 0
    );
    if (!runs.length) return [];

    const bestSpeed = Math.max(...runs.map(r => r.avg_speed));
    const bestSecKm = Math.round(1000 / bestSpeed);

    const distances = [
      { label:'400m',     distM:400   },
      { label:'800m',     distM:800   },
      { label:'1k',       distM:1000  },
      { label:'1500m',    distM:1500  },
      { label:'1600m',    distM:1600  },
      { label:'2k',       distM:2000  },
      { label:'3k',       distM:3000  },
      { label:'5k',       distM:5000  },
      { label:'8k',       distM:8000  },
      { label:'10k',      distM:10000 },
      { label:'15k',      distM:15000 },
      { label:'16.1k',    distM:16100 },
      { label:'20k',      distM:20000 },
      { label:'Marathon', distM:42195 }
    ];

    return distances.map(d => {
      const factor = d.distM <= 400 ? 0.82 : d.distM <= 1000 ? 0.88 : d.distM <= 5000 ? 0.94 : d.distM <= 10000 ? 0.98 : 1.06;
      const secPerKm = Math.round(bestSecKm * factor);
      return {
        label:    d.label,
        distM:    d.distM,
        totalSec: Math.round((secPerKm / 1000) * d.distM),
        hr:       Math.round(185 - (d.distM / 42195) * 25)
      };
    });
  },

  pbMarkers(activities, wellness) {
    const cutoff = new Date(Date.now() - 90 * 864e5).toISOString().split('T')[0];
    const tssOf  = a => a.icu_training_load || a.tss || 0;
    const recent = activities.filter(a =>
      (a.start_date || a.date) >= cutoff && tssOf(a) > 0
    );
    if (!recent.length) return [];

    const maxTSS = Math.max(...recent.map(tssOf));
    return recent
      .filter(a => tssOf(a) >= maxTSS * 0.9)
      .map(a => ({
        date: (a.start_date || a.date),
        type: (a.type === 'Ride' || a.type === 'VirtualRide') ? 'cycling' : 'running',
        tier: tssOf(a) >= maxTSS ? 'gold' : tssOf(a) >= maxTSS * 0.95 ? 'silver' : 'bronze'
      }));
  }
};

// ============================================
// FORMATTERS (shared across pages)
// ============================================
function formatDuration(s) {
  if (!s) return '—';
  if (s >= 3600) return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}

function formatPace(secPerKm) {
  if (!secPerKm) return '—';
  return `${Math.floor(secPerKm/60)}:${String(Math.round(secPerKm%60)).padStart(2,'0')}`;
}

function getTypeInfo(type = '') {
  const t = type.toLowerCase();
  if (t.includes('ride') || t.includes('cycle')) return { label:'Cycling', colorClass:'cycling', dotClass:'dot-cycling', page:'cycling.html' };
  if (t.includes('run'))                          return { label:'Running', colorClass:'running', dotClass:'dot-running', page:'running.html' };
  if (t.includes('row') || t.includes('erg'))     return { label:'Rowing',  colorClass:'rowing',  dotClass:'dot-rowing',  page:'rowing.html'  };
  if (t.includes('strength') || t.includes('cardio') || t.includes('gym')) return { label:'Cardio', colorClass:'cardio', dotClass:'dot-cardio', page:'cardio.html' };
  return { label:'Other', colorClass:'other', dotClass:'dot-other', page:'other.html' };
}

function getISOWeekNum(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}
