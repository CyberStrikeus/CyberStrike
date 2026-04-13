---
name: cis-aws-compute-8.1
description: "Ensure AWS Batch is configured with AWS CloudWatch Logs"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, batch, cloudwatch, logging, monitoring]
cis_id: "8.1"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-8.2]
prerequisites: []
severity_boost: {}
---

# 8.1 Ensure AWS Batch is configured with AWS CloudWatch Logs (Manual)

## Description
You can configure Batch jobs to send log information to CloudWatch Logs.

## Rationale
This enables you to view different logs from all your jobs in one convenient location.

## Impact
N/A

## Audit Procedure

### Using AWS Console
1. Login to the AWS Console using https://console.aws.amazon.com/batch/
2. On the left hand side under `Console settings`, Click on `Permissions`
3. Under `Job logs` section
4. Confirm that `Authorize Batch to use Cloudwatch` is set with a green check.
5. If it is showing a red X refer to the remediation below.

### Using AWS CLI
N/A - This control is manual and console-based.

## Expected Result
`Authorize Batch to use Cloudwatch` is enabled (green check) in the Batch Console settings under Permissions > Job logs.

## Remediation

### Using AWS Console
1. Login to the AWS Console using https://console.aws.amazon.com/batch/.
2. In the left column under Console settings, Click on `Permissions`
3. In the Job logs section click on `Edit`
4. Click the `Authorize Batch to use CloudWatch`
5. Click Save

### Using AWS CLI
N/A - This control is manual and console-based.

## Default Value
AWS Batch is not configured with CloudWatch Logs by default.

## References
- https://docs.aws.amazon.com/batch/latest/userguide/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 8.2 Collect Audit Logs | X | X | X |
| v7 | 6.2 Activate audit logging | X | X | X |

## Profile
Level 1 | Manual
