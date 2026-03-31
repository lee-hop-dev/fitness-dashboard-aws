# Quick Setup Guide

Follow these steps to get your fitness dashboard running.

## Step 1: Get Your API Keys

### Intervals.icu
1. Log into https://intervals.icu
2. Go to Settings (gear icon)
3. Scroll to "Developer Settings"
4. Copy your API key
5. Your athlete ID is in the URL: `intervals.icu/athletes/YOUR_ID`

### Concept2 Logbook
- Use your existing username and password
- No additional setup required

### Strava (Phase 2)
1. Go to https://www.strava.com/settings/api
2. Create an app
3. Note your Client ID and Client Secret
4. You'll need to complete OAuth flow for refresh token

### Zwift (Phase 2)
- No API key needed - uses public ZwiftRacing.app API
- Just need your Zwift username or ID

### YouTube (Phase 3)
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create project
3. Enable YouTube Data API v3
4. Create API key credentials

## Step 2: Google Drive Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or use existing)
3. Enable Google Drive API
4. Create credentials:
   - Type: OAuth 2.0 Client ID
   - Application type: Desktop app
   - Download `credentials.json`

5. Create folder in Google Drive:
   ```
   FitnessData/
   ├── raw/
   ├── processed/
   └── cache/
   ```

6. Get folder ID:
   - Open FitnessData folder
   - ID is in URL: `drive.google.com/drive/folders/YOUR_FOLDER_ID`

## Step 3: Local Setup

```bash
# Clone repository
git clone https://github.com/lee-hop-dev/fitness-dashboard.git
cd fitness-dashboard

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## Step 4: Configure

1. Copy environment template:
   ```bash
   cp .env.template .env
   ```

2. Edit `.env` with your credentials:
   ```bash
   INTERVALS_API_KEY=your_key_here
   CONCEPT2_USERNAME=LH_Hoppy
   CONCEPT2_PASSWORD=your_password
   GOOGLE_DRIVE_FOLDER_ID=your_folder_id
   ```

3. Copy config template:
   ```bash
   cp config/config.yaml.template config/config.yaml
   ```

4. Move Google credentials:
   ```bash
   mv ~/Downloads/credentials.json config/google_credentials.json
   ```

## Step 5: Verify Setup

```bash
python verify_setup.py
```

This will test:
- ✅ Environment variables
- ✅ Config file
- ✅ Intervals.icu connection
- ✅ Concept2 connection
- ✅ Directory structure

## Step 6: First Data Pull

```bash
# Test pulling recent data
python connectors/intervals_icu.py
python connectors/concept2.py

# Run full collection (once workflows are ready)
python workflows/collect_data.py
```

## Step 7: GitHub Setup

1. Create repository on GitHub:
   - Name: `fitness-dashboard`
   - Public or Private (your choice)

2. Push code:
   ```bash
   git remote add origin https://github.com/lee-hop-dev/fitness-dashboard.git
   git branch -M main
   git add .
   git commit -m "Initial commit"
   git push -u origin main
   ```

3. Add secrets (Settings → Secrets and variables → Actions):
   ```
   INTERVALS_API_KEY
   CONCEPT2_USERNAME
   CONCEPT2_PASSWORD
   GOOGLE_DRIVE_FOLDER_ID
   GOOGLE_CREDENTIALS_JSON
   ```

   For `GOOGLE_CREDENTIALS_JSON`, encode as base64:
   ```bash
   cat config/google_credentials.json | base64
   ```

4. Enable GitHub Pages:
   - Settings → Pages
   - Source: Deploy from branch
   - Branch: `gh-pages`

## Step 8: Test GitHub Actions

1. Go to Actions tab
2. Run "Daily Data Sync" workflow manually
3. Check logs for any errors
4. Once successful, your dashboard will be at:
   `https://lee-hop-dev.github.io/fitness-dashboard/`

## Troubleshooting

### "Module not found" errors
```bash
pip install -r requirements.txt
```

### "Authentication failed" for Intervals.icu
- Double-check API key
- Verify athlete ID is correct

### "Authentication failed" for Concept2
- Check username/password
- Verify account has access to logbook

### Google Drive authentication
- Make sure `google_credentials.json` is in `config/`
- First run will open browser for OAuth consent
- Token saved for future use

### GitHub Actions failing
- Check all secrets are set correctly
- Verify secret names match exactly
- Review Actions logs for specific error

## Next Steps

After Phase 1 is working:
1. **Phase 2**: Add Strava segments and Zwift racing
2. **Phase 3**: Add YouTube video integration
3. **Polish**: Improve dashboard design and mobile responsiveness

## Support

Questions or issues?
- Check README.md for detailed documentation
- Review error logs in GitHub Actions
- Open an issue on GitHub

---

**Your Details:**
- Intervals.icu ID: 5718022
- Concept2 Username: LH_Hoppy
- GitHub: lee-hop-dev
