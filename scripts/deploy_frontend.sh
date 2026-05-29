#!/bin/bash
# Deploy frontend to S3 and invalidate CloudFront cache.
#
# IMPORTANT: The following files are written by the Lambda collector
# on every run. They must NEVER be overwritten by this sync or they
# will revert to the empty/stale repo versions:
#   - data/segments.json
#   - data/power_curves_90d.json
#   - data/pace_curves_90d.json
#   - data/hr_curves_90d.json
#   - data/upcoming_events.json
#   - data/streams/*

set -e

BUCKET="fitness-dashboard-frontend-656370357696"
DISTRIBUTION_ID="E2A1SYDA1ZW3KS"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCS_DIR="$(dirname "$SCRIPT_DIR")/docs"

echo "Syncing frontend to s3://$BUCKET/ ..."

# Step 1: HTML files — force-upload every file with cp (never skipped by ETag)
# no-cache ensures CloudFront and browsers always revalidate
echo "Uploading HTML files..."
find "$DOCS_DIR" -maxdepth 1 -name "*.html" | while read -r f; do
  key=$(basename "$f")
  aws s3 cp "$f" "s3://$BUCKET/$key" \
    --cache-control "no-cache, no-store, must-revalidate" \
    --metadata-directive REPLACE
  echo "  uploaded: $key"
done

# Step 2: JS and CSS — 1 year cache (filenames are stable; invalidation handles updates)
aws s3 sync "$DOCS_DIR/" "s3://$BUCKET/" \
  --exclude "*" \
  --include "assets/js/*.js" \
  --include "assets/css/*.css" \
  --cache-control "public, max-age=31536000" \
  --metadata-directive REPLACE

# Step 3: Everything else (JSON data, images, fonts, etc.) — 5 min cache
# Lambda-managed files are excluded so they are never overwritten
aws s3 sync "$DOCS_DIR/" "s3://$BUCKET/" \
  --delete \
  --exclude "*.html" \
  --exclude "assets/js/*.js" \
  --exclude "assets/css/*.css" \
  --exclude "data/segments.json" \
  --exclude "data/power_curves_90d.json" \
  --exclude "data/pace_curves_90d.json" \
  --exclude "data/hr_curves_90d.json" \
  --exclude "data/upcoming_events.json" \
  --exclude "data/streams/*" \
  --cache-control "public, max-age=300"

echo "Invalidating CloudFront cache ..."
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*"

echo "Done."
