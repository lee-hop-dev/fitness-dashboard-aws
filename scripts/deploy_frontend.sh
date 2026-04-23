#!/bin/bash
# Deploy frontend to S3 and invalidate CloudFront cache.
#
# IMPORTANT: Lambda-managed files (written by fitness-dashboard-data-collector):
#   - data/segments.json
#   - data/power_curves_90d.json
#   - data/pace_curves_90d.json
#   - data/hr_curves_90d.json
#   - data/streams/*
#   - data/youtube_videos.json
# These files must NEVER be overwritten by this sync or they will revert
# to empty/stale repo versions.

set -e

BUCKET="fitness-dashboard-frontend-656370357696"
DISTRIBUTION_ID="E2A1SYDA1ZW3KS"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCS_DIR="$(dirname "$SCRIPT_DIR")/docs"

echo "Syncing frontend to s3://$BUCKET/ ..."

aws s3 sync "$DOCS_DIR/" "s3://$BUCKET/" \
  --delete \
  --exclude "data/segments.json" \
  --exclude "data/power_curves_90d.json" \
  --exclude "data/pace_curves_90d.json" \
  --exclude "data/hr_curves_90d.json" \
  --exclude "data/streams/*" \
  --exclude "data/youtube_videos.json"

echo "Invalidating CloudFront cache ..."
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*"

echo "Done."
