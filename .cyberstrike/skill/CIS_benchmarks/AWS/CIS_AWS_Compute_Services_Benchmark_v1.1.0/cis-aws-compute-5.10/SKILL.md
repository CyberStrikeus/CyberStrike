---
name: cis-aws-compute-5.10
description: "Enable storage bucket access logging"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lightsail, buckets, logging, access-logs, monitoring]
cis_id: "5.10"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-5.8, cis-aws-compute-5.9]
prerequisites: []
severity_boost: {}
---

# 5.10 Enable storage bucket access logging (Manual)

## Description

Access logging provides detailed records for the requests that are made to this bucket. This information can include the request type, the resources that are specified in the request, and the time and date that the request was processed. Access logs are useful for many applications.

## Rationale

Access log information is useful in security and access audits.

## Impact

N/A

## Audit Procedure

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select `Storage`.
5. All Lightsail buckets are listed here.
6. Click on a bucket name
7. Click `Logging`.
8. Confirm that Access logging is set to active. If it is set to inactive refer to the remediation below.

### Using AWS CLI

N/A - Bucket access logging status is managed through the AWS Console.

## Expected Result

Access logging should be set to active for all Lightsail storage buckets.

## Remediation

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select `Storage`.
5. All Lightsail buckets are listed here.
6. Click on a bucket name
7. Click `Logging`.
8. Click on the X next to `Access logging is inactive`
9. Select a different bucket specific to store the logging information.
10. Note the path or create a path that matches your organization style.
11. Click save
12. Click OK
13. Repeat steps 6-12 for all Lightsail buckets.

### Using AWS CLI

N/A - Bucket access logging is managed through the AWS Console.

## Default Value

Access logging is inactive by default for Lightsail storage buckets.

## References

1. https://lightsail.aws.amazon.com/ls/docs/en_us/articles/amazon-lightsail-enabling-bucket-access-logs

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. | x | x | x |
| v7 | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices. | x | x | x |

## Profile

Level 1 | Manual
