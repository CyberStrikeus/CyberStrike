---
name: cis-aws-compute-12.1
description: "Ensure AWS Config is Enabled for Lambda and Serverless"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lambda, serverless, config, compliance, monitoring]
cis_id: "12.1"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-12.2, cis-aws-compute-12.7]
prerequisites: []
severity_boost: {}
---

# Ensure AWS Config is Enabled for Lambda and Serverless

## Description
With AWS Config, you can track configuration changes to the Lambda functions (including deleted functions), runtime environments, tags, handler name, code size, memory allocation, timeout settings, and concurrency settings, along with Lambda IAM execution role, subnet, and security group associations.

## Rationale
This gives you a holistic view of the Lambda function's lifecycle and enables you to surface that data for potential audit and compliance requirements.

## Impact
Enabling AWS Config for Lambda may incur additional AWS Config costs depending on the number of configuration items recorded and the number of active rules.

## Audit Procedure

### Using AWS Console
1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Config` under Management & Governance.
3. This will open up the Config dashboard.
4. Click `Conformance packs`
5. Review the list of conformance packs.
6. If `serverless` is listed or included in the conformance pack you built you meet this recommendation.
7. If `serverless` is not listed refer to the remediation below.
8. If none, see remediation section below.
9. Repeat steps 3-7 for all regions used.

### Using AWS CLI
N/A - This control is Console-based audit only.

## Expected Result
AWS Config conformance packs include `serverless` and Lambda security conformance packs for all regions in use.

## Remediation

### Using AWS Console
1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Config` under Management & Governance.
3. This will open up the Config dashboard.
4. Click `Conformance packs`
5. Click on `Deploy conformance pack`
6. Click on `Use sample template`
7. Click the down arrow under Sample template
8. Scroll down and click on Operational Best Practices for Serverless
9. Click Next
10. Give it a Conformance pack name `Serverless`.
11. Click Next
12. Click `Deploy conformance pack`
13. Click on `Deploy conformance pack`
14. Click on `Use sample template`
15. Click the down arrow under Sample template
16. Scroll down and click on Security Best Practices for Lambda
17. Click Next
18. Give it a Conformance pack name `LambaSecurity`.
19. Click Next
20. Click `Deploy conformance pack`
21. Repeat steps 2-20 for all regions used.

### Using AWS CLI
N/A - This control is Console-based remediation only.

## Default Value
AWS Config is not enabled by default for Lambda and Serverless.

## References
1. https://docs.aws.amazon.com/lambda/latest/dg/welcome.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. | x | x | x |
| v7 | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices. | x | x | x |

## Profile
Level 2 | Manual
