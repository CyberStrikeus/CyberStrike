---
name: cis-aws-foundations-4.4
description: "Ensure that server access logging is enabled on the CloudTrail S3 bucket"
category: cis-logging
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, logging, cloudtrail, s3, server-access-logging]
cis_id: "4.4"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-4.1, cis-aws-foundations-4.5]
prerequisites: []
severity_boost: {}
---

# Ensure that server access logging is enabled on the CloudTrail S3 bucket

## Description

Server access logging generates a log that contains access records for each request made to your S3 bucket. An access log record contains details about the request, such as the request type, the resources specified in the request worked, and the time and date the request was processed. It is recommended that server access logging be enabled on the CloudTrail S3 bucket.

## Rationale

By enabling server access logging on target S3 buckets, it is possible to capture all events that may affect objects within any target bucket. Configuring the logs to be placed in a separate bucket allows access to log information that can be useful in security and incident response workflows. In some environments (e.g., AWS Control Tower), logs may be delivered to the same bucket with appropriate prefixes, which is also an acceptable configuration.

## Impact

N/A

## Audit Procedure

### Using AWS Console

1. Go to the Amazon CloudTrail console at https://console.aws.amazon.com/cloudtrail/home.
2. In the API activity history pane on the left, click `Trails`.
3. In the Trails pane, note the bucket names in the S3 bucket column.
4. Sign in to the AWS Management Console and open the S3 console at https://console.aws.amazon.com/s3.
5. Under `All Buckets` click on a target S3 bucket.
6. Click on `Properties` in the top right of the console.
7. Scroll down to `Server access logging`.
8. Ensure `Server access logging` is `Enabled`.
9. Verify the `Target bucket` where logs are delivered.

### Using AWS CLI

1. Get the name of the S3 bucket that CloudTrail is logging to:

```bash
aws cloudtrail describe-trails --query 'trailList[*].S3BucketName'
```

2. Ensure logging is enabled on the bucket:

```bash
aws s3api get-bucket-logging --bucket <s3-bucket-for-cloudtrail>
```

Ensure the command does not return an empty output.

Sample output for a bucket with logging enabled:

```json
{
  "LoggingEnabled": {
    "TargetPrefix": "<log-file-prefix>",
    "TargetBucket": "<logging-bucket>"
  }
}
```

## Expected Result

The CloudTrail S3 bucket has server access logging enabled with a valid `TargetBucket` and `TargetPrefix` configured.

## Remediation

### Using AWS Console

1. Sign in to the AWS Management Console and open the S3 console at https://console.aws.amazon.com/s3.
2. Under `All Buckets` click on the target S3 bucket.
3. Click on `Properties` in the top right of the console.
4. Under `Server access logging`, click `Edit`.
5. Configure bucket logging:
   - Check the `Enabled` box.
   - Select a Target Bucket from the list.
   - Enter a Target Prefix.
6. Click `Save`.

### Using AWS CLI

1. Get the name of the S3 bucket that CloudTrail is logging to:

```bash
aws cloudtrail describe-trails --region <region-name> --query trailList[*].S3BucketName
```

2. Create a logging configuration file and populate the following values:

```json
{
  "LoggingEnabled": {
    "TargetBucket": "<TargetBucket>",
    "TargetPrefix": "<TargetPrefix>",
    "TargetGrants": [
      {
        "Grantee": {
          "Type": "AmazonCustomerByEmail",
          "EmailAddress": ""
        },
        "Permission": "FULL_CONTROL"
      }
    ]
  }
}
```

3. Save the file as `<file>.json`
4. Apply the logging configuration:

```bash
aws s3api put-bucket-logging --bucket <bucket-name> --bucket-logging-status file://<file>.json
```

## Default Value

By default, server access logging is disabled on S3 buckets, including those used for CloudTrail. Without enabling this setting, no record of access requests to the CloudTrail bucket is captured, leaving organizations without visibility into who accessed log files or how they were used.

## References

1. CCE-78918-0
2. https://docs.aws.amazon.com/AmazonS3/latest/dev/ServerLogs.html
3. https://docs.aws.amazon.com/AmazonS3/latest/userguide/enable-server-access-logging.html

## CIS Controls

| Controls Version | Control                                                                                                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.14 Log Sensitive Data Access - Log sensitive data access, including modification and disposal.                                                                |      |      | x    |
| v8               | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. | x    | x    | x    |
| v7               | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices.                                                  | x    | x    | x    |
| v7               | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data - Enforce detailed audit logging for access to sensitive data or changes to sensitive data. |      |      | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
|                             | TA0005, TA0009 | M1047       |

## Profile

Level 1 | Manual
