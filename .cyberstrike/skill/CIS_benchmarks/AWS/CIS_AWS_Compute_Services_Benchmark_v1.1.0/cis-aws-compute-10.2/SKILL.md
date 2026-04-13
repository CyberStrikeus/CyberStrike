---
name: cis-aws-compute-10.2
description: "Ensure Persistent logs is setup and configured to S3"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, elastic-beanstalk, logging, cloudwatch, s3, monitoring]
cis_id: "10.2"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-10.1, cis-aws-compute-10.3, cis-aws-compute-10.4]
prerequisites: []
severity_boost: {}
---

# 10.2 Ensure Persistent logs is setup and configured to S3 (Manual)

## Description

Elastic Beanstalk can be configured to automatically stream logs to the CloudWatch service.

## Rationale

With CloudWatch Logs, you can monitor and archive your Elastic Beanstalk application, system, and custom log files from Amazon EC2 instances of your environments.

## Impact

N/A

## Audit Procedure

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com/elasticbeanstalk
2. On the left hand side click `Environments`
3. Click on the `Environment name` that you want to review
4. Under the `environment_name-env` in the left column click `Configuration`
5. Scroll down under Configurations
6. Under category look for `Softwares`
7. Confirm `Log streaming: enabled`
8. If status options reads `Log streaming: disabled` refer to the remediation below.
9. Repeat steps 3-8 for each environment within the current region.
10. Then repeat the Audit process for all other regions.

### Using AWS CLI

N/A - This control is manual and console-based.

## Expected Result

`Log streaming: enabled` is displayed under the Softwares category in the environment Configuration.

## Remediation

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com/elasticbeanstalk
2. On the left hand side click `Environments`
3. Click on the `Environment name` that you want to update
4. Under the `environment_name-env` in the left column click `Configuration`
5. Scroll down under Configurations
6. Under category look for `Software`
7. Click on Edit
8. On the Modify software page:

```
Instance log streaming to CloudWatch Logs
Log streaming - click the Enabled checkbox
Set the required retention based on Organization requirements
Lifecycle - Keep logs after terminating environment
```

9. Click Apply
10. Repeat steps 3-8 for each environment within the current region that needs Managed updates set.

### Using AWS CLI

N/A - This control is manual and console-based.

## Default Value

Log streaming to CloudWatch is not enabled by default.

## References

1. https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/AWSHowTo.cloudwatchlogs.html

## CIS Controls

| Controls Version | Control                    | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs     | X    | X    | X    |
| v7               | 6.2 Activate audit logging | X    | X    | X    |

## Profile

Level 1 | Manual
