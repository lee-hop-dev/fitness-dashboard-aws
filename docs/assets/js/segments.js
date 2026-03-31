// ============================================================================
// SEGMENT DISPLAY - Achievement-focused segment tracking
// Shows only PR and top-3 performances from last activity
// ============================================================================

/**
 * Renders segment list with achievement badges and PR comparisons
 */
async function renderSegments(sport) {
  try {
    const response = await fetch('data/segments.json');
    if (!response.ok) {
      console.log('No segments data available');
      return;
    }
    
    const data = await response.json();
    const segments = data[sport] || [];
    
    const containerId = sport === 'cycling' ? 'cy-segments' : 'ru-segments';
    const container = document.getElementById(containerId);
    
    if (!segments.length) {
      container.innerHTML = '<p class="no-data">No PR or top-3 performances in your last activity</p>';
      return;
    }
    
    // Get the activity name (should be same for all segments)
    const activityName = segments[0]?.activity_name || 'Latest Activity';
    const activityDate = segments[0]?.date || '';
    
    // Add activity header
    let html = `
      <div class="segment-header">
        <h3>${activityName}</h3>
        <span class="segment-date">${formatDate(activityDate)}</span>
      </div>
      <div class="segment-grid">
    `;
    
    // Render each segment
    segments.forEach(seg => {
      const achievementBadge = getAchievementBadge(seg);
      const prComparison = getPRComparison(seg);
      const climbBadge = getClimbBadge(seg);
      const komBadge = seg.kom_rank ? `<span class="kom-badge">KOM #${seg.kom_rank}</span>` : '';
      
      html += `
        <div class="segment-card ${seg.achievement ? 'achievement-' + seg.achievement : ''}">
          <div class="segment-card-header">
            <div class="segment-name">${seg.name}</div>
            <div class="segment-badges">
              ${achievementBadge}
              ${climbBadge}
              ${komBadge}
            </div>
          </div>
          
          <div class="segment-stats">
            <div class="segment-stat">
              <span class="stat-label">Distance</span>
              <span class="stat-value">${(seg.distance / 1000).toFixed(2)} km</span>
            </div>
            
            <div class="segment-stat">
              <span class="stat-label">Time</span>
              <span class="stat-value">${formatDuration(seg.time)}</span>
            </div>
            
            ${sport === 'cycling' && seg.avg_power ? `
              <div class="segment-stat">
                <span class="stat-label">Avg Power</span>
                <span class="stat-value">${Math.round(seg.avg_power)}W</span>
              </div>
            ` : ''}
            
            ${seg.avg_hr ? `
              <div class="segment-stat">
                <span class="stat-label">Avg HR</span>
                <span class="stat-value">${Math.round(seg.avg_hr)} bpm</span>
              </div>
            ` : ''}
            
            ${seg.avg_grade ? `
              <div class="segment-stat">
                <span class="stat-label">Avg Grade</span>
                <span class="stat-value">${seg.avg_grade.toFixed(1)}%</span>
              </div>
            ` : ''}
            
            ${seg.avg_cadence ? `
              <div class="segment-stat">
                <span class="stat-label">Cadence</span>
                <span class="stat-value">${Math.round(seg.avg_cadence)} rpm</span>
              </div>
            ` : ''}
          </div>
          
          ${prComparison ? `
            <div class="pr-comparison ${prComparison.className}">
              ${prComparison.html}
            </div>
          ` : ''}
          
          ${seg.effort_count ? `
            <div class="effort-count">
              <span>Attempt #${seg.effort_count}</span>
            </div>
          ` : ''}
        </div>
      `;
    });
    
    html += '</div>';
    container.innerHTML = html;
    
  } catch (err) {
    console.error('Error loading segments:', err);
  }
}

/**
 * Get achievement badge HTML
 */
function getAchievementBadge(seg) {
  if (!seg.achievement) return '';
  
  const badges = {
    gold: {
      icon: '🏆',
      text: 'NEW PR!',
      className: 'badge-gold'
    },
    silver: {
      icon: '🥈',
      text: '2nd Best',
      className: 'badge-silver'
    },
    bronze: {
      icon: '🥉',
      text: '3rd Best',
      className: 'badge-bronze'
    }
  };
  
  const badge = badges[seg.achievement];
  return `<span class="achievement-badge ${badge.className}">${badge.icon} ${badge.text}</span>`;
}

/**
 * Get PR comparison data
 */
function getPRComparison(seg) {
  if (!seg.pr_time || seg.is_pr) return null;
  
  const diff = seg.time - seg.pr_time;
  const diffAbs = Math.abs(diff);
  const diffText = formatDuration(diffAbs);
  
  if (diff < 0) {
    // Faster than PR (shouldn't happen unless pr_time is outdated)
    return {
      className: 'pr-faster',
      html: `<span class="pr-icon">⚡</span> ${diffText} faster than PR (${formatDuration(seg.pr_time)})`
    };
  } else {
    // Slower than PR
    return {
      className: 'pr-slower',
      html: `<span class="pr-icon">⏱️</span> ${diffText} off PR (${formatDuration(seg.pr_time)})`
    };
  }
}

/**
 * Get climb category badge
 */
function getClimbBadge(seg) {
  if (!seg.climb_category || seg.climb_category === 0) return '';
  
  const categories = {
    5: { text: 'Cat 4', className: 'climb-cat4' },
    4: { text: 'Cat 3', className: 'climb-cat3' },
    3: { text: 'Cat 2', className: 'climb-cat2' },
    2: { text: 'Cat 1', className: 'climb-cat1' },
    1: { text: 'HC', className: 'climb-hc' }
  };
  
  const cat = categories[seg.climb_category];
  return cat ? `<span class="climb-badge ${cat.className}">🏔️ ${cat.text}</span>` : '';
}

/**
 * Format date nicely
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString('en-GB', { 
      weekday: 'short', 
      day: 'numeric', 
      month: 'short' 
    });
  }
}
