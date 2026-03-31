# Google Drive Setup Guide

This guide walks you through setting up Google Drive API access for automated data storage.

## Prerequisites

- Google account with Drive access
- Folder structure already created: `Github/Fitness/Raw` and `Github/Fitness/Processed`

## Step-by-Step Setup

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click "Select a project" → "New Project"
3. Project name: `Fitness Dashboard`
4. Click "Create"
5. Wait for project creation (notification will appear)

### 2. Enable Google Drive API

1. In your new project, click "☰" menu → "APIs & Services" → "Library"
2. Search for "Google Drive API"
3. Click "Google Drive API"
4. Click "Enable"
5. Wait for API to be enabled

### 3. Create Service Account

1. Click "☰" menu → "APIs & Services" → "Credentials"
2. Click "+ CREATE CREDENTIALS" → "Service account"
3. Fill in details:
   - **Service account name:** `fitness-dashboard-sync`
   - **Service account ID:** (auto-generated)
   - **Description:** `Automated fitness data sync to Google Drive`
4. Click "Create and Continue"
5. Grant access (optional, can skip) → Click "Continue"
6. Click "Done"

### 4. Generate Service Account Key

1. In "Credentials" page, find your service account under "Service Accounts"
2. Click on the service account email (e.g., `fitness-dashboard-sync@...`)
3. Go to "Keys" tab
4. Click "Add Key" → "Create new key"
5. Choose "JSON" format
6. Click "Create"
7. **Important:** JSON file will download automatically - save it securely!

### 5. Rename and Store Credentials

```bash
# Rename the downloaded file
mv ~/Downloads/fitness-dashboard-*.json config/credentials.json

# Verify JSON structure
cat config/credentials.json
```

The JSON should look like:
```json
{
  "type": "service_account",
  "project_id": "fitness-dashboard-...",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...",
  "client_email": "fitness-dashboard-sync@...iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  ...
}
```

### 6. Share Google Drive Folder

**Critical Step:** Grant the service account access to your Drive folder.

1. Copy the `client_email` from credentials.json:
   ```
   fitness-dashboard-sync@fitness-dashboard-....iam.gserviceaccount.com
   ```

2. In Google Drive:
   - Right-click on your **"Github"** folder (parent folder)
   - Click "Share"
   - Paste the service account email
   - Set permission to **"Editor"**
   - Uncheck "Notify people"
   - Click "Share"

3. Verify folder structure:
   ```
   Github/
   └── Fitness/
       ├── Raw/
       └── Processed/
   ```

### 7. Test Connection

```bash
# Test the connection
python connectors/google_drive.py
```

Expected output:
```
Authenticated with Google Drive (service account)
Created folder: Github (ID: ...)
Created folder: Fitness (ID: ...)
Created folder: Raw (ID: ...)
Uploaded: test.json to raw/
Downloaded test data: {'test': True, 'timestamp': '...', 'message': 'Google Drive integration test'}

Files in raw folder: 1
  - test.json
```

### 8. Configure GitHub Secrets (for Actions)

1. Copy the **entire contents** of `credentials.json`
2. Go to GitHub repository → Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Name: `GOOGLE_DRIVE_CREDENTIALS`
5. Value: Paste the entire JSON (including curly braces)
6. Click "Add secret"

**Important:** The JSON must be valid. Test locally first!

## Troubleshooting

### "Permission denied" errors

**Problem:** Service account can't access Drive folder

**Solution:**
- Verify you shared the folder with the service account email
- Check you used "Editor" permission (not "Viewer")
- Make sure you shared the parent folder, not just subfolders

### "Invalid credentials" errors

**Problem:** JSON file is corrupted or incorrect format

**Solution:**
```bash
# Validate JSON
python -m json.tool config/credentials.json

# Re-download from Google Cloud Console if needed
```

### "API not enabled" errors

**Problem:** Google Drive API not enabled for project

**Solution:**
1. Go to [API Library](https://console.cloud.google.com/apis/library)
2. Search "Google Drive API"
3. Click "Enable"

### Files not appearing in Drive

**Problem:** Files uploaded but not visible

**Solution:**
- Check you're looking in the correct folder
- Service account creates files in shared folder, not your root Drive
- Use Drive search: `owner:fitness-dashboard-sync@...`

### GitHub Actions failing

**Problem:** Workflow can't authenticate with Drive

**Solution:**
1. Verify `GOOGLE_DRIVE_CREDENTIALS` secret is set correctly
2. Check secret contains valid JSON (no extra spaces/newlines)
3. Re-create secret if needed:
   ```bash
   # Get JSON as one line (for easier copying)
   cat config/credentials.json | jq -c .
   ```

## Security Best Practices

### Local Development
- **Never commit** `credentials.json` to git (already in .gitignore)
- Store credentials file securely
- Restrict file permissions:
  ```bash
  chmod 600 config/credentials.json
  ```

### Production (GitHub Actions)
- Use GitHub Secrets (encrypted at rest)
- Limit secret access to necessary workflows
- Rotate service account keys periodically (every 90 days recommended)

### Service Account Permissions
- Only grant "Editor" access to specific folder
- Don't give service account access to entire Drive
- Regularly audit service account access:
  - Google Cloud Console → IAM & Admin → Service Accounts
  - Review "Permissions" tab

## Alternative: OAuth2 (User Account)

If you prefer using your personal Google account instead of a service account:

1. Create OAuth 2.0 Client ID in Cloud Console
2. Download client_secrets.json
3. Run interactive authentication flow
4. Store refresh token

**Pros:** Direct access to your Drive, no sharing needed
**Cons:** More complex setup, requires manual token refresh

For automation, **service accounts are recommended**.

## Need Help?

- [Google Drive API Documentation](https://developers.google.com/drive/api/guides/about-sdk)
- [Service Account Guide](https://cloud.google.com/iam/docs/service-accounts)
- [Python Client Library](https://github.com/googleapis/google-api-python-client)

---

**Setup complete!** Your fitness data will now sync to Google Drive automatically.
