// docs/assets/js/stream-helpers.js
/**
 * Stream data transformation utilities for StreamChart widget
 */

/**
 * Maps API stream field names to StreamChart expected names
 * API: watts, heartrate, etc.
 * Widget: power, heartRate, etc.
 */
export function mapStreamsForWidget(apiStreams) {
  return {
    time: apiStreams.time || [],
    power: apiStreams.watts || [],
    heartRate: apiStreams.heartrate || [],
    cadence: apiStreams.cadence || [],
    speed: apiStreams.velocity_smooth || apiStreams.speed || [],
    elevation: apiStreams.altitude || []
  };
}

/**
 * Extracts activity summary for use in activity detail page
 */
export function extractActivitySummary(activity) {
  return {
    name: activity.name || 'Untitled Activity',
    type: activity.type || activity.sport_type || 'Workout',
    startTime: activity.start_date_local || activity.start_time,
    distance: activity.distance || 0,
    duration: activity.moving_time || activity.elapsed_time || 0,
    elevationGain: activity.total_elevation_gain || 0,
    avgPower: activity.average_watts || activity.avg_power,
    avgHeartRate: activity.average_heartrate || activity.avg_hr,
    avgCadence: activity.average_cadence || activity.avg_cadence,
    avgSpeed: activity.average_speed,
    tss: activity.icu_training_load || activity.tss,
    normalizedPower: activity.icu_np || activity.normalized_power,
    intensityFactor: activity.icu_intensity || activity.intensity_factor
  };
}

/**
 * Calculates time labels for stream chart ticks
 */
export function generateTimeLabels(durationSec, numTicks = 8) {
  const labels = [];
  const interval = durationSec / (numTicks - 1);
  
  for (let i = 0; i < numTicks; i++) {
    const seconds = Math.round(i * interval);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    
    if (h > 0) {
      labels.push(`${h}h${m > 0 ? m : ''}`);
    } else if (m > 0) {
      labels.push(`${m}m`);
    } else {
      labels.push('0m');
    }
  }
  
  return labels;
}

/**
 * Calculates peak values for each stream channel
 */
export function calculateStreamPeaks(streams) {
  return {
    power: Math.max(...(streams.power || []).filter(v => v != null)),
    heartRate: Math.max(...(streams.heartRate || []).filter(v => v != null)),
    cadence: Math.max(...(streams.cadence || []).filter(v => v != null)),
    speed: Math.max(...(streams.speed || []).filter(v => v != null)),
    elevation: Math.max(...(streams.elevation || []).filter(v => v != null))
  };
}
