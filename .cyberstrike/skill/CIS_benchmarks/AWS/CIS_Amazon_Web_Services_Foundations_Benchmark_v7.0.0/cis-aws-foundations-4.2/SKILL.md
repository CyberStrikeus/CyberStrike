---
name: cis-aws-foundations-4.2
description: "Ensure CloudTrail log file validation is enabled"
category: cis-logging
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, logging, cloudtrail, log-validation, integrity]
cis_id: "4.2"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-4.1, cis-aws-foundations-4.5]
prerequisites: []
severity_boost: {}
---

# Ensure CloudTrail log file validation is enabled

## Description

CloudTrail log file validation creates a digitally signed digest file containing a hash of each log that CloudTrail writes to S3. These digest files can be used to determine whether a log file was changed, deleted, or remained unchanged after CloudTrail delivered the log. It is recommended that file validation be enabled for all CloudTrails.

## Rationale

Enabling log file validation will provide additional integrity checks for CloudTrail logs.

## Impact

N/A

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/cloudtrail.
2. Click on `Trails` in the left navigation pane.
3. For every trail:
   - Click a trail via the link in the `Name` column.
   - Under the `General details` section, ensure `log file validation` is set to `Enabled`.

### Using AWS CLI

List all trails:

```bash
aws cloudtrail describe-trails
```

Ensure `LogFileValidationEnabled` is set to `true` for each trail.

## Expected Result

All CloudTrail trails have `LogFileValidationEnabled` set to `true`.

## Remediation

### Using AWS Console

1. Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/cloudtrail.
2. Click on `Trails` in the left navigation pane.
3. Click on the target trail.
4. Within the `General details` section, click `edit`.
5. Under `Advanced settings`, check the `enable` box under `Log file validation`.
6. Click `Save changes`.

### Using AWS CLI

Enable log file validation on a trail:

```bash
aws cloudtrail update-trail --name <trail_name> --enable-log-file-validation
```

Note that periodic validation of logs using these digests can be carried out by running the following command:

```bash
aws cloudtrail validate-logs --trail-arn <trail_arn> --start-time <start_time> --end-time <end_time>
```

## Default Value

By default, CloudTrail log file validation is not enabled. This means that while logs are still delivered to the designated S3 bucket, there is no mechanism in place to verify their integrity. Without validation, it is not possible to detect if log files have been altered, deleted, or tampered with after delivery.

## References

1. https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-log-file-validation-enabling.html
2. CCE-78914-9

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.11 Conduct Audit Log Reviews - Conduct reviews of audit logs to detect anomalies or abnormal events that could indicate a potential threat. Conduct reviews on a weekly, or more frequent, basis.                           |      | x    | x    |
| v7               | 6.1 Utilize Three Synchronized Time Sources - Use at least three synchronized time sources from which all servers and network devices retrieve time information on a regular basis so that timestamps in logs are consistent. |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1565                       | TA0040  |             |

## Profile

Level 2 | Automated
