"""
Frontend Stack - Phase 4
Creates S3 bucket (static hosting) + CloudFront distribution (CDN).

Architecture:
  S3 bucket (private, OAC access)  ←  CloudFront (HTTPS, global CDN)

Deployment:
  aws s3 sync docs/ s3://<bucket-name>/ --delete
  aws cloudfront create-invalidation --distribution-id <id> --paths "/*"

Both bucket name and CloudFront distribution ID are emitted as
CloudFormation Outputs for use in the Phase 4 runbook.
"""

from aws_cdk import (
    Stack,
    Duration,
    RemovalPolicy,
    CfnOutput,
    aws_s3 as s3,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
)
from constructs import Construct


class FrontendStack(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ── S3 Bucket (private — CloudFront OAC is the only reader) ──────────
        self.bucket = s3.Bucket(
            self,
            "FrontendBucket",
            bucket_name=f"fitness-dashboard-frontend-{self.account}",
            # Block all public access; CloudFront serves via OAC
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            versioned=False,
            # DESTROY + autoDeleteObjects so cdk destroy works cleanly in dev
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
        )

        # ── CloudFront Origin Access Control (OAC) ────────────────────────────
        oac = cloudfront.S3OriginAccessControl(
            self,
            "FrontendOAC",
            description="OAC for fitness-dashboard frontend bucket",
            signing=cloudfront.Signing.SIGV4_NO_OVERRIDE,
        )

        # ── CloudFront Distribution ───────────────────────────────────────────
        self.distribution = cloudfront.Distribution(
            self,
            "FrontendDistribution",
            comment="Fitness Dashboard - AWS frontend",
            default_root_object="index.html",
            # SPA fallback: 403/404 from S3 → serve index.html with 200
            # (handles direct navigation to /cycling.html etc.)
            error_responses=[
                cloudfront.ErrorResponse(
                    http_status=403,
                    response_http_status=200,
                    response_page_path="/index.html",
                    ttl=Duration.seconds(0),
                ),
                cloudfront.ErrorResponse(
                    http_status=404,
                    response_http_status=200,
                    response_page_path="/index.html",
                    ttl=Duration.seconds(0),
                ),
            ],
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3BucketOrigin.with_origin_access_control(
                    self.bucket,
                    origin_access_control=oac,
                ),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                # Cache HTML + JS sparingly — data changes daily
                cache_policy=cloudfront.CachePolicy.CACHING_OPTIMIZED,
                # Compress text assets (HTML, CSS, JS, JSON)
                compress=True,
                allowed_methods=cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                cached_methods=cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
            ),
            # Use all global edge locations (free tier covers 50 GB/mo transfer)
            price_class=cloudfront.PriceClass.PRICE_CLASS_ALL,
            # Enable standard logging (access logs) — optional but useful
            enable_logging=False,  # flip to True when you want access logs
        )

        # ── CloudFormation Outputs ────────────────────────────────────────────
        CfnOutput(
            self,
            "BucketName",
            value=self.bucket.bucket_name,
            description="S3 bucket name for frontend static files",
            export_name="FitnessDashboardFrontendBucket",
        )

        CfnOutput(
            self,
            "CloudFrontDomainName",
            value=self.distribution.distribution_domain_name,
            description="CloudFront domain name (https://<this>/)",
            export_name="FitnessDashboardCloudFrontDomain",
        )

        CfnOutput(
            self,
            "CloudFrontDistributionId",
            value=self.distribution.distribution_id,
            description="CloudFront distribution ID (for cache invalidations)",
            export_name="FitnessDashboardCloudFrontId",
        )

        CfnOutput(
            self,
            "DashboardUrl",
            value=f"https://{self.distribution.distribution_domain_name}",
            description="Public URL for the AWS-hosted fitness dashboard",
            export_name="FitnessDashboardUrl",
        )
