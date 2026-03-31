"""
Google Drive Sync Script
Uploads collected data to Google Drive for storage and GitHub Actions access
"""

import os
import sys
import json
import logging
from pathlib import Path
from typing import Optional

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from googleapiclient.errors import HttpError
from dotenv import load_dotenv

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Google Drive API scopes
SCOPES = ['https://www.googleapis.com/auth/drive.file']


class GoogleDriveSync:
    """Sync local data to Google Drive"""
    
    def __init__(self):
        """Initialize Google Drive sync"""
        load_dotenv()
        
        self.folder_id = os.getenv("GOOGLE_DRIVE_FOLDER_ID")
        if not self.folder_id:
            raise ValueError("GOOGLE_DRIVE_FOLDER_ID not found in environment")
        
        self.service = self._authenticate()
        self.subfolder_ids = self._get_or_create_subfolders()
    
    def _authenticate(self):
        """Authenticate using service account JSON from environment"""
        logger.info("Authenticating with Google Drive (Service Account)...")
        service_account_info = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
        if not service_account_info:
            raise ValueError("GOOGLE_SERVICE_ACCOUNT_JSON not found in environment")

        credentials = service_account.Credentials.from_service_account_info(
            json.loads(service_account_info),
            scopes=SCOPES
        )

        logger.info("Successfully authenticated with Google Drive")
        return build('drive', 'v3', credentials=credentials)

    def _get_or_create_subfolders(self) -> dict:
        """Get or create raw/processed/cache subfolders"""
        logger.info("Setting up folder structure...")
        subfolder_names = ["raw", "processed", "cache"]
        subfolder_ids = {}
        for name in subfolder_names:
            folder_id = self._find_or_create_folder(name, self.folder_id)
            subfolder_ids[name] = folder_id
            logger.info(f"  {name}: {folder_id}")
        return subfolder_ids
    
    def _find_or_create_folder(self, name: str, parent_id: str) -> str:
        """Find existing folder or create new one"""
        try:
            query = f"name='{name}' and '{parent_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
            results = self.service.files().list(
                q=query,
                spaces='drive',
                fields='files(id, name)'
            ).execute()
            files = results.get('files', [])
            if files:
                return files[0]['id']

            # Create new folder
            folder_metadata = {
                'name': name,
                'mimeType': 'application/vnd.google-apps.folder',
                'parents': [parent_id]
            }
            folder = self.service.files().create(
                body=folder_metadata,
                fields='id'
            ).execute()
            return folder['id']

        except HttpError as error:
            logger.error(f"Error with folder {name}: {error}")
            raise

    def _find_file(self, filename: str, parent_id: str) -> Optional[str]:
        """Find a file in Google Drive folder"""
        try:
            query = f"name='{filename}' and '{parent_id}' in parents and trashed=false"
            results = self.service.files().list(
                q=query,
                spaces='drive',
                fields='files(id, name)'
            ).execute()
            files = results.get('files', [])
            return files[0]['id'] if files else None
        except HttpError:
            return None

    def upload_file(self, filepath: Path, subfolder: str = "processed") -> Optional[str]:
        """Upload a single file to Google Drive"""
        if not filepath.exists():
            logger.error(f"File not found: {filepath}")
            return None

        try:
            parent_id = self.subfolder_ids.get(subfolder, self.folder_id)
            existing_id = self._find_file(filepath.name, parent_id)

            media = MediaFileUpload(str(filepath), mimetype='application/json', resumable=True)
            file_metadata = {'name': filepath.name, 'parents': [parent_id]}

            if existing_id:
                logger.info(f"Updating existing file: {filepath.name}")
                file = self.service.files().update(
                    fileId=existing_id,
                    media_body=media,
                    fields='id'
                ).execute()
            else:
                logger.info(f"Uploading new file: {filepath.name}")
                file = self.service.files().create(
                    body=file_metadata,
                    media_body=media,
                    fields='id'
                ).execute()

            logger.info(f"  File ID: {file['id']}")
            return file['id']

        except HttpError as error:
            logger.error(f"Upload failed for {filepath.name}: {error}")
            return None

    def sync_directory(self, local_dir: Path, subfolder: str = "processed") -> int:
        """Sync all JSON files in a local directory"""
        logger.info(f"Syncing directory: {local_dir} → {subfolder}")
        if not local_dir.exists():
            logger.warning(f"Directory not found: {local_dir}")
            return 0

        uploaded = 0
        for filepath in local_dir.glob("*.json"):
            if self.upload_file(filepath, subfolder):
                uploaded += 1

        logger.info(f"Uploaded {uploaded} files from {local_dir}")
        return uploaded


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Sync data to Google Drive")
    parser.add_argument("--upload-raw", action="store_true", help="Upload raw data files")
    parser.add_argument("--upload-processed", action="store_true", help="Upload processed data files")
    parser.add_argument("--all", action="store_true", help="Upload all data files")
    args = parser.parse_args()

    try:
        sync = GoogleDriveSync()
        total_uploaded = 0

        if args.upload_raw or args.all:
            total_uploaded += sync.sync_directory(Path("data/raw"), "raw")
        if args.upload_processed or args.all:
            total_uploaded += sync.sync_directory(Path("data/processed"), "processed")
        if not (args.upload_raw or args.upload_processed or args.all):
            total_uploaded += sync.sync_directory(Path("data/processed"), "processed")

        logger.info("=" * 60)
        logger.info(f"✅ Sync complete! Total files uploaded: {total_uploaded}")
        logger.info("=" * 60)

    except Exception as e:
        logger.error(f"❌ Sync failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
