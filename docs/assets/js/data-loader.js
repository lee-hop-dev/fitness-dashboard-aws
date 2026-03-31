/* ============================================
   FITNESS DASHBOARD — DATA LOADER
   Reads from static JSON files in docs/data/
   ============================================ */

const DATA = {
  _cache: {},

  async _load(file) {
    if (this._cache[file]) return this._cache[file];
    const res = await fetch(`data/${file}?v=${Date.now()}`);
    if (!res.ok) throw new Error(`Failed to load ${file} (${res.status})`);
    const data = await res.json();
    this._cache[file] = data;
    return data;
  },

  async loadAll() {
    const [activities, wellness, weeklyTSS, ytd, heatmap1y, heatmap3y, athlete, meta] =
      await Promise.all([
        this._load('activities.json'),
        this._load('wellness.json'),
        this._load('weekly_tss.json'),
        this._load('ytd.json'),
        this._load('heatmap_1y.json'),
        this._load('heatmap_3y.json'),
        this._load('athlete.json'),
        this._load('meta.json')
      ]);

        // Normalize Intervals.icu power curve for consistent access
    if (meta) {
      meta.power_curve =
        meta.power_curve ||
        meta.powerCurve ||
        meta.best_efforts ||
        meta.powerCurveWatts ||
        null;
    }

    return { activities, wellness, weeklyTSS, ytd, heatmap1y, heatmap3y, athlete, meta };

  },

  // Latest wellness metrics
  latestWellness(wellness) {
    const rev = [...wellness].reverse();
    return {
      ctl:        rev.find(w => w.ctl != null)?.ctl,
      atl:        rev.find(w => w.atl != null)?.atl,
      tsb:        rev.find(w => w.tsb != null)?.tsb,
      hrv:        rev.find(w => w.hrv != null)?.hrv,
      resting_hr: rev.find(w => w.resting_hr != null)?.resting_hr,
      sleep:      rev.find(w => w.sleep != null)?.sleep,
      weight:     rev.find(w => w.weight != null)?.weight
    };
  },

  // Activities in last N days
  recentActivities(activities, days = 7) {
    const cutoff = new Date(Date.now() - days * 864e5).toISOString().split('T')[0];
    return activities.filter(a => a.date >= cutoff);
  },

  // Build 90-day power bests from ride data
  powerBests(activities) {
    const cutoff = new Date(Date.now() - 90 * 864e5).toISOString().split('T')[0];
    const rides  = activities.filter(a =>
      (a.type === 'Ride' || a.type === 'VirtualRide') && a.date >= cutoff && a.avg_power
    );
    if (!rides.length) return [];

    const maxPower = Math.max(...rides.map(r => r.avg_power));
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

  // Build 90-day pace bests from run data
  paceBests(activities) {
    const cutoff = new Date(Date.now() - 90 * 864e5).toISOString().split('T')[0];
    const runs   = activities.filter(a =>
      (a.type === 'Run' || a.type === 'VirtualRun') && a.date >= cutoff && a.avg_speed && a.avg_speed > 0
    );
    if (!runs.length) return [];

    const bestSpeed  = Math.max(...runs.map(r => r.avg_speed));
    const bestSecKm  = Math.round(1000 / bestSpeed);

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

  // PB markers for last 90 days only
  pbMarkers(activities, wellness) {
    const cutoff = new Date(Date.now() - 90 * 864e5).toISOString().split('T')[0];
    const recent = activities.filter(a => a.date >= cutoff && a.tss > 0);
    if (!recent.length) return [];

    const maxTSS = Math.max(...recent.map(a => a.tss));
    return recent
      .filter(a => a.tss >= maxTSS * 0.9)
      .map(a => ({
        date: a.date,
        type: (a.type === 'Ride' || a.type === 'VirtualRide') ? 'cycling' : 'running',
        tier: a.tss >= maxTSS ? 'gold' : a.tss >= maxTSS * 0.95 ? 'silver' : 'bronze'
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

  if (t.includes('ride') || t.includes('cycle')) {
    return {
      label: 'Cycling',
      colorClass: 'cycling',
      dotClass: 'dot-cycling',
      page: 'cycling.html'
    };
  }

  if (t.includes('run')) {
    return {
      label: 'Running',
      colorClass: 'running',
      dotClass: 'dot-running',
      page: 'running.html'
    };
  }

  if (t.includes('row') || t.includes('erg')) {
    return {
      label: 'Rowing',
      colorClass: 'rowing',
      dotClass: 'dot-rowing',
      page: 'rowing.html'
    };
  }

  if (t.includes('strength') || t.includes('cardio') || t.includes('gym')) {
    return {
      label: 'Cardio',
      colorClass: 'cardio',
      dotClass: 'dot-cardio',
      page: 'cardio.html'
    };
  }

  return {
    label: 'Other',
    colorClass: 'other',
    dotClass: 'dot-other',
    page: 'other.html'
  };
}


function getISOWeekNum(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}
