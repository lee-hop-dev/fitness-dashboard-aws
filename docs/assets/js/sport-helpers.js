// docs/assets/js/sport-helpers.js
/**
 * Sport-specific utilities and formatting helpers
 */

export function getSportGlyph(sport) {
  const glyphs = {
    'Ride': '⬡',
    'VirtualRide': '⬡',
    'Run': '▷',
    'VirtualRun': '▷',
    'Rowing': '⊕',
    'Workout': '◎'
  };
  return glyphs[sport] || '●';
}

export function getSportColor(sport) {
  const colors = {
    'Ride': 'var(--accent)',
    'VirtualRide': 'var(--accent)',
    'Run': 'var(--accent-2)',
    'VirtualRun': 'var(--accent-2)',
    'Rowing': 'var(--accent-3)',
    'Workout': 'var(--accent-4)'
  };
  return colors[sport] || 'var(--fg-3)';
}

export function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatDistance(meters, units = 'metric') {
  if (!meters) return '0 km';
  if (units === 'imperial') {
    const miles = meters / 1609.34;
    return `${miles.toFixed(1)} mi`;
  }
  const km = meters / 1000;
  return `${km.toFixed(1)} km`;
}

export function formatPace(secPerKm, units = 'metric') {
  if (!secPerKm) return '—';
  if (units === 'imperial') {
    const secPerMile = secPerKm * 1.60934;
    const min = Math.floor(secPerMile / 60);
    const sec = Math.floor(secPerMile % 60);
    return `${min}:${sec.toString().padStart(2, '0')} /mi`;
  }
  const min = Math.floor(secPerKm / 60);
  const sec = Math.floor(secPerKm % 60);
  return `${min}:${sec.toString().padStart(2, '0')} /km`;
}

export function formatPower(watts) {
  if (!watts) return '—';
  return `${Math.round(watts)}W`;
}

export function formatHeartRate(bpm) {
  if (!bpm) return '—';
  return `${Math.round(bpm)} bpm`;
}

export function formatElevation(meters, units = 'metric') {
  if (!meters) return '0m';
  if (units === 'imperial') {
    const feet = meters * 3.28084;
    return `${Math.round(feet)}ft`;
  }
  return `${Math.round(meters)}m`;
}

export function formatTSS(tss) {
  if (!tss) return '—';
  return Math.round(tss).toLocaleString();
}

export function formatRelativeTime(isoDate) {
  const date = new Date(isoDate);
  const now = new Date();
  const diff = now - date;
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}
