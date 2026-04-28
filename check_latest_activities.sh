#!/bin/bash
# Diagnostic: Check if the latest activities are in DynamoDB and accessible via API

echo "=== STEP 1: Check Lambda CloudWatch logs ==="
echo "Run this in CloudShell:"
echo 'aws logs tail /aws/lambda/fitness-dashboard-data-collector --since 4h --format short | grep -E "Synced|activities|error|ERROR"'
echo ""

echo "=== STEP 2: Query DynamoDB directly for today's activities ==="
echo "Run this in CloudShell:"
cat << 'EOF'
TODAY=$(date -u +%Y-%m-%d)
YESTERDAY=$(date -u -d '1 day ago' +%Y-%m-%d)
aws dynamodb query \
  --table-name FitnessDashboard-Activities \
  --index-name DateIndex \
  --key-condition-expression "athlete_id = :aid AND start_date BETWEEN :yesterday AND :today" \
  --expression-attribute-values "{\":aid\":{\"S\":\"5718022\"},\":yesterday\":{\"S\":\"$YESTERDAY\"},\":today\":{\"S\":\"$TODAY\"}}" \
  --projection-expression "activity_id,#n,start_date,#t" \
  --expression-attribute-names "{\"#n\":\"name\",\"#t\":\"type\"}" \
  --region eu-west-2
EOF
echo ""

echo "=== STEP 3: Test API Gateway endpoint directly ==="
echo "Run this in your browser console or curl:"
echo 'fetch("https://j2zxz92vd4.execute-api.eu-west-2.amazonaws.com/prod/activities?days=2").then(r=>r.json()).then(console.log)'
echo ""

echo "=== STEP 4: Invalidate CloudFront cache ==="
echo "Run this in CloudShell if API returns new activities but frontend doesn't:"
echo 'aws cloudfront create-invalidation --distribution-id E2A1SYDA1ZW3KS --paths "/activities*" "/*"'
echo ""

echo "=== STEP 5: Hard refresh your browser ==="
echo "Press Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac) to bypass browser cache"
