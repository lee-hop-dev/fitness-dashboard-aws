// docs/assets/js/readiness.js
/**
 * Training readiness score calculation and rendering
 * Uses renderRing from charts-new.js
 */

export function calculateReadiness(wellness) {
  if (!wellness?.latest?.tsb) return 50; // fallback
  
  // TSB component: 50 + (TSB * 2), clamped 0-100
  const tsbScore = Math.max(0, Math.min(100, 50 + (wellness.latest.tsb * 2)));
  
  // Sleep component: (avgSleep / 8) * 100
  const last3 = wellness.recent.slice(0, 3);
  const avgSleep = last3.reduce((sum, d) => sum + (d.sleep || 0), 0) / last3.length;
  const sleepScore = Math.min(100, (avgSleep / 8) * 100);
  
  // HRV component: trend direction (up=good, down=bad)
  const hrvTrend = wellness.recent.length >= 7
    ? (wellness.recent[0].hrv || 0) - (wellness.recent[6].hrv || 0)
    : 0;
  const hrvScore = 50 + (hrvTrend * 0.5); // scaled
  
  // Weighted average: TSB 50%, Sleep 30%, HRV 20%
  return Math.round(tsbScore * 0.5 + sleepScore * 0.3 + hrvScore * 0.2);
}

export function getReadinessMessage(score) {
  if (score >= 85) return "Primed for hard efforts";
  if (score >= 70) return "Ready for solid training";
  if (score >= 55) return "Moderate intensity advised";
  if (score >= 40) return "Recovery focus recommended";
  return "Rest day strongly advised";
}

export function getReadinessColor(score) {
  if (score >= 70) return "var(--accent)";
  if (score >= 55) return "var(--accent-2)";
  if (score >= 40) return "var(--accent-3)";
  return "var(--accent-4)";
}
