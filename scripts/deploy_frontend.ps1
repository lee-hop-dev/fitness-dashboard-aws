# Deploy frontend to S3 and invalidate CloudFront cache.
#
# IMPORTANT: These files are written by the Lambda collector and must
# NEVER be overwritten by this sync:
#   data/segments.json
#   data/power_curves_90d.json
#   data/pace_curves_90d.json
#   data/hr_curves_90d.json
#   data/streams/*  (Phase 8 — per-activity stream JSON files)
#   data/youtube_videos.json

$BUCKET = "fitness-dashboard-frontend-656370357696"
$DISTRIBUTION_ID = "E2A1SYDA1ZW3KS"
$DOCS_DIR = "$PSScriptRoot\..\docs"

Write-Host "Syncing frontend to s3://$BUCKET/ ..."

aws s3 sync $DOCS_DIR "s3://$BUCKET/" `
  --delete `
  --exclude "data/segments.json" `
  --exclude "data/power_curves_90d.json" `
  --exclude "data/pace_curves_90d.json" `
  --exclude "data/hr_curves_90d.json" `
  --exclude "data/streams/*" `
  --exclude "data/youtube_videos.json"

Write-Host "Invalidating CloudFront cache ..."
aws cloudfront create-invalidation `
  --distribution-id $DISTRIBUTION_ID `
  --paths "/*"

Write-Host "Done."
