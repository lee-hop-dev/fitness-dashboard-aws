/* ============================================================
   STRAVA AUTH — Phase 7
   Client-side Strava OAuth token management + data fetching.

   Tokens are stored in sessionStorage (cleared on browser close).
   The client_secret never touches the browser — all token exchange
   happens via the /strava/token and /strava/refresh Lambda endpoints.

   Usage:
     StravaAuth.isConnected()              → bool
     StravaAuth.connect()                  → redirects to Strava OAuth
     StravaAuth.disconnect()               → clears tokens
     await StravaAuth.getAccessToken()     → valid token (auto-refreshes)
     await StravaAuth.getActivities(page)  → array of Strava activities
     await StravaAuth.getActivity(id)      → single activity detail
   ============================================================ */

const StravaAuth = (() => {

  const API_BASE      = 'https://j2zxz92vd4.execute-api.eu-west-2.amazonaws.com/prod';
  const STRAVA_BASE   = 'https://www.strava.com/api/v3';
  const CLIENT_ID     = '201642';
  const CALLBACK_URL  = 'https://d3mtfyb3f9u51j.cloudfront.net/strava-callback.html';
  const SCOPE         = 'activity:read_all';

  // ── Storage keys ───────────────────────────────────────────────────────────
  const K = {
    ACCESS_TOKEN:  'strava_access_token',
    REFRESH_TOKEN: 'strava_refresh_token',
    EXPIRES_AT:    'strava_expires_at',
    ATHLETE_ID:    'strava_athlete_id',
    CONNECTED:     'strava_connected',
    RETURN_TO:     'strava_return_to',
  };

  // ── Token helpers ──────────────────────────────────────────────────────────

  function isConnected() {
    return sessionStorage.getItem(K.CONNECTED) === 'true' &&
           !!sessionStorage.getItem(K.ACCESS_TOKEN);
  }

  function isExpired() {
    const exp = parseInt(sessionStorage.getItem(K.EXPIRES_AT) || '0', 10);
    // Treat as expired 5 minutes early to avoid edge cases
    return Date.now() / 1000 >= (exp - 300);
  }

  function disconnect() {
    Object.values(K).forEach(k => sessionStorage.removeItem(k));
  }

  // ── OAuth flow ─────────────────────────────────────────────────────────────

  function connect(returnTo = window.location.href) {
    sessionStorage.setItem(K.RETURN_TO, returnTo);
    const url = new URL('https://www.strava.com/oauth/authorize');
    url.searchParams.set('client_id',     CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri',  CALLBACK_URL);
    url.searchParams.set('approval_prompt', 'auto');   // skip if already authorised
    url.searchParams.set('scope',         SCOPE);
    window.location.href = url.toString();
  }

  // ── Token refresh ──────────────────────────────────────────────────────────

  async function refreshAccessToken() {
    const refreshToken = sessionStorage.getItem(K.REFRESH_TOKEN);
    if (!refreshToken) throw new Error('No refresh token — please reconnect Strava');

    const resp = await fetch(`${API_BASE}/strava/refresh`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ refresh_token: refreshToken }),
    });

    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || `Refresh failed: HTTP ${resp.status}`);

    sessionStorage.setItem(K.ACCESS_TOKEN,  data.access_token);
    sessionStorage.setItem(K.REFRESH_TOKEN, data.refresh_token);
    sessionStorage.setItem(K.EXPIRES_AT,    String(data.expires_at));

    return data.access_token;
  }

  async function getAccessToken() {
    if (!isConnected()) throw new Error('Not connected to Strava');
    if (isExpired()) return refreshAccessToken();
    return sessionStorage.getItem(K.ACCESS_TOKEN);
  }

  // ── Strava API calls ───────────────────────────────────────────────────────

  async function stravaFetch(endpoint, params = {}) {
    const token = await getAccessToken();
    const url   = new URL(`${STRAVA_BASE}${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (resp.status === 401) {
      // Token rejected — clear and ask user to reconnect
      disconnect();
      throw new Error('Strava token rejected — please reconnect');
    }

    if (!resp.ok) throw new Error(`Strava API error: HTTP ${resp.status}`);
    return resp.json();
  }

  /**
   * Fetch a page of the athlete's activities from Strava.
   * Returns Strava activity objects (richer than Intervals stubs).
   *
   * @param {number} page      - Page number (1-indexed)
   * @param {number} perPage   - Activities per page (max 200)
   * @param {number} after     - Unix timestamp — only activities after this date
   */
  async function getActivities({ page = 1, perPage = 100, after = null } = {}) {
    const params = { page, per_page: perPage };
    if (after) params.after = after;
    return stravaFetch('/athlete/activities', params);
  }

  /**
   * Fetch detailed data for a single activity by its Strava ID.
   * Includes segment_efforts, splits, laps, and gear.
   */
  async function getActivity(stravaId) {
    return stravaFetch(`/activities/${stravaId}`, { include_all_efforts: true });
  }

  /**
   * Merge Strava detail into an activity object from DynamoDB.
   * Called when displaying a single activity that has a strava_id.
   * Returns null if Strava is not connected.
   */
  async function enrichActivity(activity) {
    if (!isConnected() || !activity.strava_id) return null;
    try {
      return await getActivity(activity.strava_id);
    } catch (ex) {
      console.warn('StravaAuth.enrichActivity failed:', ex.message);
      return null;
    }
  }

  // ── Connect button helper ──────────────────────────────────────────────────

  /**
   * Render a "Connect Strava" or "Disconnect" button into the given element.
   * @param {HTMLElement} container
   */
  function renderConnectButton(container) {
    if (!container) return;

    container.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'strava-connect-btn';

    if (isConnected()) {
      btn.textContent = '✓ Strava Connected';
      btn.classList.add('connected');
      btn.title = 'Click to disconnect';
      btn.addEventListener('click', () => {
        disconnect();
        renderConnectButton(container);
      });
    } else {
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-right:6px">
          <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/>
        </svg>
        Connect Strava`;
      btn.classList.add('disconnected');
      btn.addEventListener('click', () => connect(window.location.href));
    }

    container.appendChild(btn);
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    isConnected,
    connect,
    disconnect,
    getAccessToken,
    getActivities,
    getActivity,
    enrichActivity,
    renderConnectButton,
  };

})();
