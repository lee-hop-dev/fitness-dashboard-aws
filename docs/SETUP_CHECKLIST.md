# Setup Checklist

Use this checklist to ensure everything is configured correctly before your first sync.

## ✅ Prerequisites

- [ ] Python 3.11+ installed
- [ ] Git installed
- [ ] GitHub account
- [ ] Google account with Drive
- [ ] Intervals.icu account
- [ ] Concept2 Logbook account

## ✅ Local Setup

### 1. Repository Setup
- [ ] Clone repository
- [ ] Install Python dependencies: `pip install -r requirements.txt`
- [ ] Verify .gitignore exists (protects sensitive files)

### 2. Google Drive Setup
- [ ] Create Google Cloud project "Fitness Dashboard"
- [ ] Enable Google Drive API
- [ ] Create service account
- [ ] Download credentials.json
- [ ] Save to `config/credentials.json`
- [ ] Share Drive folder with service account email
- [ ] Verify folder structure exists:
  - [ ] `Github/Fitness/Raw/`
  - [ ] `Github/Fitness/Processed/`

### 3. API Keys - Intervals.icu
- [ ] Log in to intervals.icu
- [ ] Get API key from Settings → Developer
- [ ] Note your Athlete ID from URL

### 4. API Keys - Concept2
- [ ] Verify login works at log.concept2.com
- [ ] Note username
- [ ] Note password (will be encrypted in GitHub)

### 5. Configuration File
- [ ] Copy `config/config.yaml.template` → `config/config.yaml`
- [ ] Fill in Intervals.icu API key
- [ ] Fill in Intervals.icu Athlete ID
- [ ] Fill in Concept2 username
- [ ] Fill in Concept2 password
- [ ] Verify timezone is correct
- [ ] Update power zones (optional)
- [ ] Update HR zones (optional)

### 6. Test Connectors
Run each test individually:
- [ ] `python connectors/intervals_icu.py` - No errors, shows activities
- [ ] `python connectors/concept2.py` - Authenticates, shows workouts
- [ ] `python connectors/google_drive.py` - Uploads test.json successfully

### 7. Initial Sync
- [ ] Run test sync: `python scripts/sync_data.py --days 7`
- [ ] Check Google Drive for new JSON files
- [ ] Verify data looks correct

## ✅ GitHub Setup

### 8. Repository Secrets
Add these secrets in Settings → Secrets and variables → Actions:

**Required for Phase 1:**
- [ ] `INTERVALS_API_KEY`
- [ ] `INTERVALS_ATHLETE_ID`
- [ ] `CONCEPT2_USERNAME`
- [ ] `CONCEPT2_PASSWORD`
- [ ] `GOOGLE_DRIVE_CREDENTIALS` (entire JSON contents)

**Required for Phase 2 (later):**
- [ ] `STRAVA_CLIENT_ID`
- [ ] `STRAVA_CLIENT_SECRET`
- [ ] `STRAVA_REFRESH_TOKEN`
- [ ] `ZWIFT_ID`

**Required for Phase 3 (later):**
- [ ] `YOUTUBE_API_KEY`
- [ ] `YOUTUBE_CHANNEL_ID`

### 9. GitHub Actions
- [ ] Push code to GitHub
- [ ] Go to Actions tab
- [ ] Enable workflows
- [ ] Trigger manual workflow run
- [ ] Check workflow completes successfully
- [ ] Verify new data appears in Google Drive

### 10. GitHub Pages (Optional for now)
- [ ] Settings → Pages
- [ ] Set source to main branch
- [ ] Note your GitHub Pages URL
- [ ] (Dashboard pages will be added in Phase 3)

## ✅ Verification

### Final Tests
- [ ] Workflow runs daily at 6 AM UTC automatically
- [ ] Manual workflow trigger works
- [ ] Data appears in Google Drive after each sync
- [ ] No errors in workflow logs
- [ ] Activity counts match expected values

### Data Quality Checks
- [ ] Activities from Intervals.icu are captured
- [ ] Rowing workouts from Concept2 appear
- [ ] Wellness data (HRV, sleep) is populated
- [ ] Fitness trends (CTL, ATL, TSB) are captured
- [ ] No duplicate activities
- [ ] Date ranges are correct

## 🎉 You're Ready!

Once all checkboxes are ticked, your fitness dashboard is fully automated:

✅ **Data Collection:** 6 sources when complete
✅ **Storage:** Secure Google Drive with daily backups
✅ **Automation:** GitHub Actions runs daily at 6 AM UTC
✅ **Scalable:** Add new connectors easily

## 📝 Next Steps

### Phase 2: Enhanced Data
1. Add Strava connector for segments
2. Add ZwiftRacing.app connector
3. Implement data aggregation scripts
4. Create weekly/monthly summaries

### Phase 3: Dashboard
1. Build overview page with charts
2. Create sport-specific pages
3. Add YouTube video embeds
4. Deploy to GitHub Pages

## ❓ Troubleshooting

If any checkbox fails, see:
- `README.md` - Full documentation
- `docs/GOOGLE_DRIVE_SETUP.md` - Detailed Drive setup
- GitHub Issues - Ask for help

## 🔄 Maintenance

### Weekly
- [ ] Check GitHub Actions logs for errors
- [ ] Verify data is syncing daily

### Monthly
- [ ] Review data quality
- [ ] Update power/HR zones if changed
- [ ] Check for API updates

### Quarterly
- [ ] Rotate Google service account keys
- [ ] Update dependencies: `pip install -r requirements.txt --upgrade`
- [ ] Review and clean old data in Drive

---

**Version:** Phase 1 - Core Infrastructure
**Last Updated:** February 2024
