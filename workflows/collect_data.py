"""
FITNESS DASHBOARD — DATA COLLECTOR v4.4
Fetches from Intervals.icu + Strava + Concept2 and saves to docs/data/
Includes all-time PB tracking for running distances
"""

import os, json, time, logging, argparse, requests
from datetime import datetime, timedelta
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

ATHLETE_ID           = os.getenv('INTERVALS_ATHLETE_ID', '5718022')
API_KEY              = os.getenv('INTERVALS_API_KEY', '')
STRAVA_CLIENT_ID     = os.getenv('STRAVA_CLIENT_ID', '')
STRAVA_CLIENT_SECRET = os.getenv('STRAVA_CLIENT_SECRET', '')
STRAVA_REFRESH_TOKEN = os.getenv('STRAVA_REFRESH_TOKEN', '')
CONCEPT2_USERNAME    = os.getenv('CONCEPT2_USERNAME', '')
CONCEPT2_PASSWORD    = os.getenv('CONCEPT2_PASSWORD', '')
BASE_URL             = 'https://intervals.icu/api/v1'
HISTORY_START        = '2020-01-01'  # Go back further for all-time PBs
OUTPUT_DIR           = Path(__file__).parent.parent / 'docs' / 'data'


class IntervalsClient:
    def __init__(self, athlete_id, api_key):
        self.athlete_id = athlete_id
        self.session = requests.Session()
        self.session.auth = ('API_KEY', api_key)
        self.session.headers['Content-Type'] = 'application/json'

    def _get(self, endpoint, params=None, retries=3):
        url = f'{BASE_URL}/{endpoint}'
        for attempt in range(retries):
            try:
                time.sleep(0.5)
                r = self.session.get(url, params=params or {})
                r.raise_for_status()
                return r.json()
            except requests.HTTPError as e:
                if e.response.status_code == 429:
                    log.warning('Rate limited, waiting 60s...')
                    time.sleep(60)
                else:
                    raise
            except Exception as e:
                if attempt == retries - 1:
                    raise
                time.sleep(5 * (attempt + 1))

    def get_athlete(self):
        return self._get(f'athlete/{self.athlete_id}')

    def get_activities(self, oldest=HISTORY_START):
        log.info(f'Fetching Intervals activities from {oldest}')
        data = self._get(f'athlete/{self.athlete_id}/activities', {'oldest': oldest})
        log.info(f'Got {len(data)} raw activities from Intervals')
        return data

    def get_wellness(self, oldest=HISTORY_START):
        today = datetime.now().strftime('%Y-%m-%d')
        data = self._get(f'athlete/{self.athlete_id}/wellness', {'oldest': oldest, 'newest': today})
        log.info(f'Got {len(data)} wellness entries')
        return data

    def get_power_curves(self, period='90d'):
        """Fetch power curves from Intervals.icu"""
        log.info(f'Fetching power curves ({period}) from Intervals.icu')
        try:
            # Power curves requires 'type' parameter (sport type)
            params = {
                'curves': [period],
                'type': 'Ride'  # Required parameter for power curves
            }
            data = self._get(f'athlete/{self.athlete_id}/power-curves', params)
            if data:
                log.info(f'Got power curves: {len(data.get("list", []))} curves')
            return data
        except Exception as e:
            log.error(f'Could not fetch power curves: {e}')
            return None

    def get_pace_curves(self, period='90d'):
        """Fetch pace curves from Intervals.icu for Running only"""
        log.info(f'Fetching pace curves ({period}) for Running from Intervals.icu')
        try:
            # Pace curves requires 'type' parameter to filter by sport
            params = {
                'curves': [period],
                'type': 'Run'  # Only fetch running pace curves
            }
            data = self._get(f'athlete/{self.athlete_id}/pace-curves', params)
            if data:
                log.info(f'Got pace curves: {len(data.get("list", []))} curves')
            return data
        except Exception as e:
            log.error(f'Could not fetch pace curves: {e}')
            return None

    def get_hr_curves(self, period='90d'):
        """Fetch HR curves from Intervals.icu for Running only"""
        log.info(f'Fetching HR curves ({period}) for Running from Intervals.icu')
        try:
            # HR curves requires 'type' parameter to filter by sport
            params = {
                'curves': [period],
                'type': 'Run'  # Only fetch running HR curves
            }
            data = self._get(f'athlete/{self.athlete_id}/hr-curves', params)
            if data:
                log.info(f'Got HR curves: {len(data.get("list", []))} curves')
            return data
        except Exception as e:
            log.error(f'Could not fetch HR curves: {e}')
            return None

    def get_events(self, oldest=None, newest=None):
        """Fetch all upcoming events from athlete's calendar (workouts, notes, races, etc.)"""
        today = datetime.now().strftime('%Y-%m-%d')
        if not oldest:
            oldest = today
        if not newest:
            # Default to 14 days ahead to show upcoming week's activities
            newest = (datetime.now() + timedelta(days=14)).strftime('%Y-%m-%d')
        
        log.info(f'Fetching calendar events from {oldest} to {newest}')
        params = {
            'oldest': oldest,
            'newest': newest
        }
        
        try:
            data = self._get(f'athlete/{self.athlete_id}/events', params)
            log.info(f'Got {len(data)} calendar events')
            return data
        except Exception as e:
            log.error(f'Could not fetch calendar events: {e}')
            return []


class StravaClient:
    def __init__(self, client_id, client_secret, refresh_token):
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token
        self.access_token = None
        self.session = requests.Session()

    def authenticate(self):
        log.info('Authenticating with Strava...')
        r = requests.post('https://www.strava.com/oauth/token', data={
            'client_id':     self.client_id,
            'client_secret': self.client_secret,
            'refresh_token': self.refresh_token,
            'grant_type':    'refresh_token'
        })
        r.raise_for_status()
        self.access_token = r.json()['access_token']
        self.session.headers['Authorization'] = f'Bearer {self.access_token}'
        log.info('Strava authentication successful')

    def _get(self, endpoint, params=None):
        url = f'https://www.strava.com/api/v3/{endpoint}'
        for attempt in range(3):
            try:
                time.sleep(0.3)
                r = self.session.get(url, params=params or {})
                if r.status_code == 429:
                    log.warning('Strava rate limited, waiting 60s...')
                    time.sleep(60)
                    continue
                r.raise_for_status()
                return r.json()
            except Exception as e:
                if attempt == 2:
                    log.error(f'Strava request failed: {e}')
                    return None
                time.sleep(5 * (attempt + 1))

    def get_activities(self, after_timestamp):
        log.info('Fetching Strava activities...')
        all_acts = []
        page = 1
        while True:
            data = self._get('athlete/activities', {'after': after_timestamp, 'per_page': 100, 'page': page})
            if not data:
                break
            all_acts.extend(data)
            if len(data) < 100:
                break
            page += 1
        log.info(f'Got {len(all_acts)} activities from Strava')
        return all_acts

    def get_activity_segments(self, activity_id):
        data = self._get(f'activities/{activity_id}', {'include_all_efforts': True})
        return data.get('segment_efforts', []) if data else []


class Concept2Client:
    def __init__(self, username, password):
        self.username = username
        self.password = password
        self.session = requests.Session()
        self.access_token = None
        self.token_expiry = None

    def authenticate(self):
        log.info('Authenticating with Concept2...')
        try:
            r = requests.post('https://log.concept2.com/api/auth/token', data={
                'username': self.username,
                'password': self.password,
                'grant_type': 'password'
            })
            r.raise_for_status()
            data = r.json()
            self.access_token = data.get('access_token')
            expires_in = data.get('expires_in', 3600)
            self.token_expiry = datetime.now() + timedelta(seconds=expires_in)
            self.session.headers['Authorization'] = f'Bearer {self.access_token}'
            log.info('Concept2 authentication successful')
            return True
        except Exception as e:
            log.error(f'Concept2 authentication failed: {e}')
            return False

    def _get(self, endpoint, params=None):
        if not self.access_token or datetime.now() >= self.token_expiry:
            if not self.authenticate():
                return None
        
        url = f'https://log.concept2.com/api/{endpoint}'
        try:
            time.sleep(0.5)
            r = self.session.get(url, params=params or {})
            r.raise_for_status()
            return r.json()
        except Exception as e:
            log.error(f'Concept2 request failed: {e}')
            return None

    def get_workouts(self, start_date):
        log.info('Fetching Concept2 workouts...')
        end_date = datetime.now().strftime('%Y-%m-%d')
        data = self._get('users/me/results', {'from': start_date, 'to': end_date})
        
        if data and 'data' in data:
            workouts = data['data']
            log.info(f'Got {len(workouts)} workouts from Concept2')
            return workouts
        else:
            log.warning('No Concept2 workout data returned')
            return []


def process_intervals_activity(a):
    raw_if = a.get('icu_intensity')
    if_val = round(raw_if / 100, 2) if raw_if else None
    
    tss_value = round(a.get('icu_training_load') or 0)
    
    # Log warning if TSS is 0 for activities that should have TSS
    if tss_value == 0 and a.get('moving_time', 0) > 600:  # Activities > 10 minutes
        activity_name = a.get('name', 'Unnamed')
        activity_type = a.get('type', 'Unknown')
        source = a.get('source', 'UNKNOWN')
        log.warning(f"⚠️  Missing TSS: {activity_type} - {activity_name} (source: {source})")
    
    return {
        'id':          str(a.get('id', '')),
        'strava_id':   str(a.get('strava_id', '')) if a.get('strava_id') else None,
        'source':      a.get('source', 'INTERVALS'),
        'name':        a.get('name') or 'Activity',
        'type':        a.get('type') or 'Unknown',
        'date':        (a.get('start_date_local') or '')[:10],
        'duration':    a.get('moving_time') or 0,
        'distance':    a.get('distance') or 0,
        'elevation':   a.get('total_elevation_gain') or 0,
        'avg_power':   a.get('icu_average_watts'),
        'norm_power':  a.get('icu_weighted_avg_watts'),
        'avg_hr':      a.get('average_heartrate'),
        'max_hr':      a.get('max_heartrate'),
        'avg_speed':   a.get('average_speed'),
        'avg_cadence': a.get('average_cadence'),
        'calories':    a.get('calories'),
        'tss':         tss_value,
        'if_val':      if_val,
        'ftp':         a.get('icu_ftp'),
        'w_prime':     a.get('icu_w_prime'),
        'weight':      a.get('icu_weight'),
        'device':      a.get('device_name') or '',
        'is_garmin':   'garmin' in (a.get('device_name') or '').lower()
    }


def process_strava_activity(a):
    type_map = {
        'Ride':'Ride','VirtualRide':'VirtualRide','Run':'Run','VirtualRun':'VirtualRun',
        'Rowing':'Rowing','Kayaking':'Kayaking','WeightTraining':'WeightTraining',
        'Workout':'Workout','Yoga':'Yoga','Walk':'Walk','Hike':'Hike','Swim':'Swim',
        'Crossfit':'Crossfit','Elliptical':'Cardio','StairStepper':'Cardio'
    }
    act_type = type_map.get(a.get('sport_type') or a.get('type',''), a.get('sport_type','Other'))
    return {
        'id':          f"strava_{a.get('id','')}",
        'strava_id':   str(a.get('id','')),
        'source':      'STRAVA',
        'name':        a.get('name') or 'Activity',
        'type':        act_type,
        'date':        (a.get('start_date_local') or '')[:10],
        'duration':    a.get('moving_time') or 0,
        'distance':    a.get('distance') or 0,
        'elevation':   a.get('total_elevation_gain') or 0,
        'avg_power':   a.get('average_watts'),
        'norm_power':  a.get('weighted_average_watts'),
        'avg_hr':      a.get('average_heartrate'),
        'max_hr':      a.get('max_heartrate'),
        'avg_speed':   a.get('average_speed'),
        'avg_cadence': a.get('average_cadence'),
        'calories':    a.get('calories'),
        'tss':         0,
        'if_val':      None,
        'ftp':         None,
        'w_prime':     None,
        'weight':      None,
        'device':      a.get('device_name') or '',
        'is_garmin':   False
    }


def process_concept2_activity(w):
    try:
        # Enhanced time handling for Concept2's centisecond format
        duration_raw = w.get('time', 0)
        if duration_raw == 0:
            print(f"⚠️ Concept2 workout missing time: {w.get('id')}")
            return None
            
        # Concept2 time is in centiseconds (1/100 second)
        duration_seconds = duration_raw / 100
        distance = w.get('distance', 0)
        
        # Enhanced heart rate processing
        hr_data = w.get('heart_rate', {})
        avg_hr = None
        max_hr = None
        
        if isinstance(hr_data, dict):
            avg_hr = hr_data.get('average')
            max_hr = hr_data.get('max')
        elif isinstance(hr_data, (int, float)):
            avg_hr = hr_data
            
        # Calculate average pace (seconds per 500m)
        avg_pace = (duration_seconds / distance * 500) if distance > 0 else None
        
        # Enhanced workout naming
        workout_date = w.get('date', '')[:10] if w.get('date') else 'Unknown'
        if distance > 0:
            workout_name = f"Concept2 Rowing - {distance}m"
        elif duration_seconds > 0:
            minutes = int(duration_seconds // 60)
            seconds = int(duration_seconds % 60)
            workout_name = f"Concept2 Rowing - {minutes}:{seconds:02d}"
        else:
            workout_name = "Concept2 Rowing"
            
        activity = {
            'id':          f"concept2_{w.get('id', '')}",
            'strava_id':   None,
            'source':      'CONCEPT2',  # This is key!
            'name':        workout_name,
            'type':        'Rowing',    # This is key!
            'date':        workout_date,
            'duration':    duration_seconds,
            'distance':    distance,
            'elevation':   0,
            'avg_power':   None,
            'norm_power':  None,
            'avg_hr':      avg_hr,
            'max_hr':      max_hr,
            'avg_speed':   distance / duration_seconds if duration_seconds > 0 else None,
            'avg_cadence': w.get('stroke_rate'),  # Stroke rate in strokes per minute
            'calories':    w.get('calories'),
            'tss':         0,
            'if_val':      None,
            'ftp':         None,
            'w_prime':     None,
            'weight':      None,
            'device':      'Concept2 RowErg',
            'is_garmin':   False
        }
        
        print(f"✅ Processed Concept2: {workout_name} on {workout_date}")
        return activity
        
    except Exception as e:
        print(f"❌ Error processing Concept2 workout {w.get('id', 'unknown')}: {e}")
        print(f"Raw workout data: {w}")
        return None


def merge_activities(intervals_raw, strava_acts, concept2_acts):
    processed = []
    strava_ids_covered = set()
    skipped = 0

    for a in intervals_raw:
        if a.get('_note') or not a.get('type'):
            if a.get('strava_id'):
                strava_ids_covered.add(str(a.get('strava_id')))
            skipped += 1
            continue
        act = process_intervals_activity(a)
        if act['strava_id']:
            strava_ids_covered.add(act['strava_id'])
        processed.append(act)

    log.info(f'Intervals: {len(processed)} real activities, {skipped} stubs')

    added_strava = 0
    for a in strava_acts:
        if str(a.get('id','')) not in strava_ids_covered:
            processed.append(process_strava_activity(a))
            added_strava += 1

    log.info(f'Strava: added {added_strava} additional activities')

    added_concept2 = 0
    for w in concept2_acts:
        processed.append(process_concept2_activity(w))
        added_concept2 += 1

    log.info(f'Concept2: added {added_concept2} rowing workouts')

    return sorted(processed, key=lambda x: x['date'], reverse=True)


def build_segments(strava, activities):
    """
    Build segment data from the MOST RECENT activity for each sport.
    Only includes segments where you achieved a PR or top-3 personal performance.
    """
    segments = {'cycling': [], 'running': []}
    
    # Find the most recent activity for each sport type
    cycling_types = ('Ride', 'VirtualRide')
    running_types = ('Run', 'VirtualRun')
    
    # Get activities with Strava IDs only
    strava_activities = [a for a in activities if a.get('strava_id')]
    
    # Find last cycling activity (try multiple if needed)
    last_cycling = None
    cycling_candidates = [a for a in strava_activities if a['type'] in cycling_types]
    
    # Find last running activity (try multiple if needed)
    last_running = None
    running_candidates = [a for a in strava_activities if a['type'] in running_types]
    
    log.info(f"Found {len(cycling_candidates)} cycling candidates, {len(running_candidates)} running candidates")
    
    # Process cycling segments - try up to 5 recent activities
    cycling_efforts = []
    for act in cycling_candidates[:5]:
        efforts = strava.get_activity_segments(act['strava_id'])
        if efforts:  # Found segments in this activity
            last_cycling = act
            cycling_efforts = efforts
            log.info(f"Found {len(efforts)} cycling segments in {act['name']} ({act['date']})")
            break
        else:
            log.info(f"No segments in {act['name']} ({act['date']}), trying next activity")
    
    if not cycling_efforts and cycling_candidates:
        log.info(f"No segments found in any of the last {min(5, len(cycling_candidates))} cycling activities")
    
    # Process cycling segment data
    if last_cycling and cycling_efforts:
        for e in cycling_efforts:
            # Only include PR or top-3 performances
            pr_rank = e.get('pr_rank')
            if pr_rank is None or pr_rank > 3:
                continue
            
            seg = e.get('segment', {})
            athlete_stats = e.get('athlete_segment_stats', {})
            
            # Calculate achievement level (gold/silver/bronze)
            achievement = None
            if pr_rank == 1:
                achievement = 'gold'
            elif pr_rank == 2:
                achievement = 'silver'
            elif pr_rank == 3:
                achievement = 'bronze'
            
            entry = {
                'id': seg.get('id'),
                'name': seg.get('name', ''),
                'distance': seg.get('distance', 0),
                'avg_grade': seg.get('average_grade', 0),
                'max_grade': seg.get('maximum_grade', 0),
                'climb_category': seg.get('climb_category', 0),
                'elevation_gain': seg.get('elevation_high', 0) - seg.get('elevation_low', 0),
                
                'time': e.get('elapsed_time', 0),
                'moving_time': e.get('moving_time', 0),
                'date': last_cycling['date'],
                'activity_name': last_cycling['name'],
                
                'pr_rank': pr_rank,
                'kom_rank': e.get('kom_rank'),
                
                'pr_time': athlete_stats.get('pr_elapsed_time'),
                'pr_date': athlete_stats.get('pr_date'),
                'effort_count': athlete_stats.get('effort_count'),
                
                'avg_power': e.get('average_watts'),
                'avg_hr': e.get('average_heartrate'),
                'max_hr': e.get('max_heartrate'),
                'avg_cadence': e.get('average_cadence'),
                
                'achievement': achievement,
                'is_pr': pr_rank == 1
            }
            
            segments['cycling'].append(entry)
    
    # Process running segments - try up to 5 recent activities
    running_efforts = []
    for act in running_candidates[:5]:
        efforts = strava.get_activity_segments(act['strava_id'])
        if efforts:  # Found segments in this activity
            last_running = act
            running_efforts = efforts
            log.info(f"Found {len(efforts)} running segments in {act['name']} ({act['date']})")
            break
        else:
            log.info(f"No segments in {act['name']} ({act['date']}), trying next activity")
    
    if not running_efforts and running_candidates:
        log.info(f"No segments found in any of the last {min(5, len(running_candidates))} running activities")
    
    # Process running segment data
    if last_running and running_efforts:
        for e in running_efforts:
            # Only include PR or top-3 performances
            pr_rank = e.get('pr_rank')
            if pr_rank is None or pr_rank > 3:
                continue
            
            seg = e.get('segment', {})
            athlete_stats = e.get('athlete_segment_stats', {})
            
            achievement = None
            if pr_rank == 1:
                achievement = 'gold'
            elif pr_rank == 2:
                achievement = 'silver'
            elif pr_rank == 3:
                achievement = 'bronze'
            
            entry = {
                'id': seg.get('id'),
                'name': seg.get('name', ''),
                'distance': seg.get('distance', 0),
                'avg_grade': seg.get('average_grade', 0),
                'max_grade': seg.get('maximum_grade', 0),
                'climb_category': seg.get('climb_category', 0),
                'elevation_gain': seg.get('elevation_high', 0) - seg.get('elevation_low', 0),
                
                'time': e.get('elapsed_time', 0),
                'moving_time': e.get('moving_time', 0),
                'date': last_running['date'],
                'activity_name': last_running['name'],
                
                'pr_rank': pr_rank,
                'kom_rank': e.get('kom_rank'),
                
                'pr_time': athlete_stats.get('pr_elapsed_time'),
                'pr_date': athlete_stats.get('pr_date'),
                'effort_count': athlete_stats.get('effort_count'),
                
                'avg_hr': e.get('average_heartrate'),
                'max_hr': e.get('max_heartrate'),
                'avg_cadence': e.get('average_cadence'),
                
                'achievement': achievement,
                'is_pr': pr_rank == 1
            }
            
            segments['running'].append(entry)
    
    log.info(f'Segments: {len(segments["cycling"])} cycling, {len(segments["running"])} running')
    log.info(f'PRs: {sum(1 for s in segments["cycling"] if s["is_pr"])} cycling, {sum(1 for s in segments["running"] if s["is_pr"])} running')
    
    return segments


def process_wellness(raw):
    processed = []
    for w in raw:
        processed.append({
            'date':       w.get('id') or '',
            'ctl':        w.get('ctl'),
            'atl':        w.get('atl'),
            'tsb':        w.get('tsb'),
            'tss':        w.get('trainingLoad') or 0,
            'hrv':        w.get('hrv'),
            'resting_hr': w.get('restingHR'),
            'sleep':      round(w['sleepSecs'] / 3600, 1) if w.get('sleepSecs') else None,
            'weight':     w.get('weight'),
            'fatigue':    w.get('fatigue'),
            'mood':       w.get('mood')
        })
    return sorted(processed, key=lambda x: x['date'])


def deduplicate(items, key='id'):
    seen = set()
    result = []
    for item in items:
        k = str(item.get(key, ''))
        if k not in seen:
            seen.add(k)
            result.append(item)
    return result


def aggregate_weekly_tss(activities):
    weeks = {}
    for a in activities:
        if not a['date']:
            continue
        d = datetime.strptime(a['date'], '%Y-%m-%d')
        iso = d.isocalendar()
        key = f'{iso[0]}-W{iso[1]:02d}'
        if key not in weeks:
            weeks[key] = {'week': f'W{iso[1]}', 'year': iso[0], 'ride': 0, 'run': 0, 'row': 0, 'other': 0}
        tss = a['tss'] or 0
        t = a['type']
        if t in ('Ride','VirtualRide'):   weeks[key]['ride'] += tss
        elif t in ('Run','VirtualRun'):   weeks[key]['run'] += tss
        elif t in ('Rowing','Kayaking'):  weeks[key]['row'] += tss
        else:                              weeks[key]['other'] += tss
    return sorted(weeks.values(), key=lambda x: (x['year'], x['week']))


def calc_ytd(activities):
    year = str(datetime.now().year)
    ytd     = [a for a in activities if a['date'].startswith(year)]
    cycling = [a for a in ytd if a['type'] in ('Ride','VirtualRide')]
    running = [a for a in ytd if a['type'] in ('Run','VirtualRun')]
    rowing  = [a for a in ytd if a['type'] in ('Rowing',)]
    def s(arr):
        return {
            'distance': round(sum(a['distance'] or 0 for a in arr)/1000),
            'hours':    round(sum(a['duration'] or 0 for a in arr)/3600, 1),
            'tss':      sum(a['tss'] or 0 for a in arr),
            'count':    len(arr)
        }
    return {'total': s(ytd), 'cycling': s(cycling), 'running': s(running), 'rowing': s(rowing)}


def build_heatmap(activities, days=365):
    act_by_date = {}
    for a in activities:
        if not a['date']:
            continue
        act_by_date[a['date']] = act_by_date.get(a['date'], 0) + (a['tss'] or 0)
    cells = []
    end = datetime.now()
    for i in range(days - 1, -1, -1):
        d = end - timedelta(days=i)
        ds = d.strftime('%Y-%m-%d')
        tss = act_by_date.get(ds, 0)
        level = 0
        if tss > 0:   level = 1
        if tss > 40:  level = 2
        if tss > 80:  level = 3
        if tss > 120: level = 4
        if tss > 180: level = 5
        cells.append({'date': ds, 'level': level, 'tss': tss})
    return cells


def calculate_pb(activities, target_distance, tolerance=0.15):
    """
    Calculate personal best time for a target distance.
    
    Args:
        activities: List of activity dictionaries
        target_distance: Target distance in meters (e.g., 5000 for 5K)
        tolerance: Distance tolerance as percentage (default 15%)
    
    Returns:
        Best time in seconds, or None if no qualifying activities found
    """
    runs = [a for a in activities if a['type'] in ('Run', 'VirtualRun')]
    margin = target_distance * tolerance
    
    candidates = [
        a for a in runs 
        if a.get('distance') and 
        abs(a['distance'] - target_distance) < margin and
        a.get('avg_speed') and
        a['avg_speed'] > 0
    ]
    
    if not candidates:
        return None
    
    best_time = None
    for a in candidates:
        # Estimate time based on average speed
        estimated_time = target_distance / a['avg_speed']
        if best_time is None or estimated_time < best_time:
            best_time = estimated_time
    
    log.info(f'PB for {target_distance}m: {best_time:.1f}s from {len(candidates)} candidates')
    return round(best_time, 1) if best_time else None


def calculate_pb(activities, target_distance, tolerance=0.15):
    """
    Calculate personal best time for a target distance.
    
    Args:
        activities: List of activity dictionaries
        target_distance: Target distance in meters (e.g., 5000 for 5K)
        tolerance: Distance tolerance as percentage (default 15%)
    
    Returns:
        Best time in seconds, or None if no qualifying activities found
    """
    runs = [a for a in activities if a['type'] in ('Run', 'VirtualRun')]
    margin = target_distance * tolerance
    
    candidates = [
        a for a in runs 
        if a.get('distance') and 
        abs(a['distance'] - target_distance) < margin and
        a.get('avg_speed') and
        a['avg_speed'] > 0
    ]
    
    if not candidates:
        return None
    
    best_time = None
    for a in candidates:
        # Estimate time based on average speed
        estimated_time = target_distance / a['avg_speed']
        if best_time is None or estimated_time < best_time:
            best_time = estimated_time
    
    log.info(f'PB for {target_distance}m: {best_time:.1f}s from {len(candidates)} candidates')
    return round(best_time, 1) if best_time else None


def calculate_running_bests_90d(activities):
    """Calculate 90-day running bests for standard distances"""
    from datetime import datetime, timedelta
    
    cutoff = (datetime.now() - timedelta(days=90)).strftime('%Y-%m-%d')
    recent = [a for a in activities if a['date'] >= cutoff and a['type'] in ('Run', 'VirtualRun')]
    
    distances = {
        '400': 400,
        '800': 800,
        '1000': 1000,
        '1500': 1500,
        '1609': 1609,  # mile
        '3000': 3000,
        '5000': 5000,
        '8000': 8000,  # 5 mile
        '10000': 10000,
        '16093': 16093,  # 10 mile
        '21097': 21097,  # half marathon
        '42195': 42195   # marathon
    }
    
    bests = {}
    for key, dist in distances.items():
        margin = dist * 0.15
        candidates = [
            a for a in recent
            if a.get('distance') and abs(a['distance'] - dist) < margin and
            a.get('duration') and a.get('distance') > 0
        ]
        
        if candidates:
            # Find best by scaling duration to exact distance
            best = min(candidates, key=lambda a: (a['duration'] / a['distance']) * dist)
            scaled_time = (best['duration'] / best['distance']) * dist
            bests[key] = {
                'secs': round(scaled_time, 1),
                'date': best['date'],
                'name': best['name'],
                'distM': dist
            }
            log.info(f'  {key}m: {scaled_time:.1f}s from {best["date"]}')
    
    return bests


def calculate_power_bests_90d(activities):
    """Calculate 90-day power bests for standard durations"""
    from datetime import datetime, timedelta
    
    cutoff = (datetime.now() - timedelta(days=90)).strftime('%Y-%m-%d')
    recent = [a for a in activities if a['date'] >= cutoff and a['type'] in ('Ride', 'VirtualRide') and a.get('avg_power')]
    
    # Standard power durations in seconds
    durations = {
        '5': 5,
        '10': 10,
        '30': 30,
        '60': 60,
        '300': 300,      # 5min
        '600': 600,      # 10min
        '1200': 1200,    # 20min
        '3600': 3600     # 1hr
    }
    
    bests = {}
    for key, duration in durations.items():
        # For now, use avg_power from activities of similar length
        # This is a simplification - ideally we'd analyze power streams
        candidates = [
            a for a in recent
            if a.get('duration') and abs(a['duration'] - duration) < duration * 0.3 and
            a.get('avg_power')
        ]
        
        if candidates:
            best = max(candidates, key=lambda a: a['avg_power'])
            bests[key] = {
                'watts': round(best['avg_power']),
                'date': best['date'],
                'name': best['name'],
                'durationSecs': duration
            }
            log.info(f'  {key}s: {best["avg_power"]:.0f}W from {best["date"]}')
    
    return bests


def save_json(data, filename):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / filename
    with open(path, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    log.info(f'Saved {path} ({len(json.dumps(data))//1024}kb)')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--oldest', default=HISTORY_START)
    args = parser.parse_args()

    if not API_KEY:
        raise ValueError('INTERVALS_API_KEY environment variable not set')

    client = IntervalsClient(ATHLETE_ID, API_KEY)
    athlete = client.get_athlete()
    raw_intervals = deduplicate(client.get_activities(args.oldest))

    strava_acts = []
    strava = None
    if STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET and STRAVA_REFRESH_TOKEN:
        try:
            strava = StravaClient(STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN)
            strava.authenticate()
            oldest_ts = int(datetime.strptime(args.oldest, '%Y-%m-%d').timestamp())
            strava_acts = strava.get_activities(oldest_ts)
        except Exception as e:
            log.error(f'Strava fetch failed: {e}')
    else:
        log.warning('Strava credentials not configured')

    concept2_acts = []
    if CONCEPT2_USERNAME and CONCEPT2_PASSWORD:
        try:
            concept2 = Concept2Client(CONCEPT2_USERNAME, CONCEPT2_PASSWORD)
            if concept2.authenticate():
                concept2_acts = concept2.get_workouts(args.oldest)
        except Exception as e:
            log.error(f'Concept2 fetch failed: {e}')
    else:
        log.warning('Concept2 credentials not configured')

    activities = merge_activities(raw_intervals, strava_acts, concept2_acts)
    save_json(activities, 'activities.json')

    wellness = process_wellness(client.get_wellness(args.oldest))
    save_json(wellness, 'wellness.json')

    # Fetch 90-day power curves from Intervals.icu
    log.info('=== Fetching 90-day Power Curves ===')
    power_curves_90d = client.get_power_curves('90d')
    if power_curves_90d:
        save_json(power_curves_90d, 'power_curves_90d.json')
        log.info(f'✓ Saved 90-day power curves')
    else:
        log.warning('✗ Power curves not available')
        save_json([], 'power_curves_90d.json')

    # Fetch 90-day pace curves from Intervals.icu
    log.info('=== Fetching 90-day Pace Curves ===')
    pace_curves_90d = client.get_pace_curves('90d')
    if pace_curves_90d:
        save_json(pace_curves_90d, 'pace_curves_90d.json')
        log.info(f'✓ Saved 90-day pace curves')
    else:
        log.warning('✗ Pace curves not available')
        save_json([], 'pace_curves_90d.json')

    # Fetch 90-day HR curves from Intervals.icu
    log.info('=== Fetching 90-day HR Curves ===')
    hr_curves_90d = client.get_hr_curves('90d')
    if hr_curves_90d:
        save_json(hr_curves_90d, 'hr_curves_90d.json')
        log.info(f'✓ Saved 90-day HR curves')
    else:
        log.warning('✗ HR curves not available')
        save_json([], 'hr_curves_90d.json')

    # Fetch upcoming events (next 14 days) from calendar
    log.info('=== Fetching Upcoming Calendar Events ===')
    upcoming_events = client.get_events()
    if upcoming_events:
        save_json(upcoming_events, 'upcoming_events.json')
        log.info(f'✓ Saved {len(upcoming_events)} upcoming events')
    else:
        log.warning('✗ No upcoming events found')
        save_json([], 'upcoming_events.json')


    weight  = next((a['weight']  for a in activities if a.get('weight')),  None)
    ftp     = next((a['ftp']     for a in activities if a.get('ftp')),     None)
    w_prime = next((a['w_prime'] for a in activities if a.get('w_prime')), None)
    if weight is None:
        weight = next((w['weight'] for w in reversed(wellness) if w.get('weight')), None)

    # Calculate all-time PBs for running distances
    log.info('Calculating running PBs...')
    pb_5k = calculate_pb(activities, 5000)
    pb_10k = calculate_pb(activities, 10000)
    pb_half_marathon = calculate_pb(activities, 21097.5)
    pb_marathon = calculate_pb(activities, 42195)

    save_json({
        'id': ATHLETE_ID, 
        'name': athlete.get('name',''), 
        'weight': weight, 
        'ftp': ftp, 
        'w_prime': w_prime,
        'pb_5k': pb_5k,
        'pb_10k': pb_10k,
        'pb_half_marathon': pb_half_marathon,
        'pb_marathon': pb_marathon
    }, 'athlete.json')
    
    save_json(aggregate_weekly_tss(activities), 'weekly_tss.json')
    save_json(calc_ytd(activities), 'ytd.json')
    save_json(build_heatmap(activities, 365), 'heatmap_1y.json')

    if strava:
        try:
            save_json(build_segments(strava, activities), 'segments.json')
        except Exception as e:
            log.error(f'Segment fetch failed: {e}')
            save_json({'cycling':[], 'running':[]}, 'segments.json')
    else:
        save_json({'cycling':[], 'running':[]}, 'segments.json')

    save_json({
        'last_updated': datetime.now().isoformat(),
        'activity_count': len(activities),
        'oldest_date': args.oldest,
        'weight': weight, 'ftp': ftp, 'w_prime': w_prime
    }, 'meta.json')

    log.info(f'Done. {len(activities)} total activities')


if __name__ == '__main__':
    main()
