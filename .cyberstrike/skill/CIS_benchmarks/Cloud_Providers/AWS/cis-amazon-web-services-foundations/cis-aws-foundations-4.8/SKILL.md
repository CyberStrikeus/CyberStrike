---
name: cis-aws-foundations-4.8
description: "Ensure that object-level logging for write events is enabled for S3 buckets"
category: cis-logging
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, logging, s3, object-level, cloudtrail, data-events, write]
cis_id: "4.8"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-4.1, cis-aws-foundations-4.9]
prerequisites: []
severity_boost: {}
---

# Ensure that object-level logging for write events is enabled for S3 buckets

## Description

S3 object-level API operations, such as GetObject, DeleteObject, and PutObject, are referred to as data events. By default, CloudTrail trails do not log data events, so it is recommended to enable object-level logging for S3 buckets.

## Rationale

Enabling object-level logging will help you meet data compliance requirements within your organization, perform comprehensive security analyses, monitor specific patterns of user behavior in your AWS account, or take immediate actions on any object-level API activity within your S3 buckets using Amazon CloudWatch Events.

## Impact

Enabling logging for these object-level events may significantly increase the number of events logged and may incur additional costs.

## Audit Procedure

### Using AWS Console

1. Login to the AWS Management Console and navigate to the CloudTrail dashboard at `https://console.aws.amazon.com/cloudtrail/`.
2. In the left panel, click `Trails`, and then click the name of the trail that you want to examine.
3. Review `General details`.
4. Confirm that `Multi-region trail` is set to `Yes`.
5. Scroll down to `Data events` and confirm the configuration:

- If `advanced event selectors` is being used, it should read:

```
Data Events: S3
Log selector template
Log all events
```

- If `basic event selectors` is being used, it should read:

```
Data events: S3
Bucket Name: All current and future S3 buckets
Write: Enabled
```

6. Repeat steps 2-5 to verify that each trail has multi-region enabled and is configured to log data events. If a trail does not have multi-region enabled and data event logging configured, refer to the remediation steps.

### Using AWS CLI

1. Run the `list-trails` command to list all trails:

```bash
aws cloudtrail list-trails
```

2. The command output will be a list of trails:

```
"TrailARN": "arn:aws:cloudtrail:<region>:<account#>:trail/<trail-name>",
"Name": "<trail-name>",
"HomeRegion": "<region>"
```

3. Run the `get-trail` command to determine whether a trail is a multi-region trail:

```bash
aws cloudtrail get-trail --name <trail-name> --region <region-name>
```

4. The command output should include: `"IsMultiRegionTrail": true`.

5. Run the `get-event-selectors` command, using the `Name` of the trail and the `region` returned in step 2, to determine if data event logging is configured:

```bash
aws cloudtrail get-event-selectors --region <home-region> --trail-name <trail-name> --query EventSelectors[*].DataResources[]
```

6. The command output should be an array that includes the S3 bucket defined for data event logging:

```
"Type": "AWS::S3::Object",
        "Values": [
            "arn:aws:s3"
```

7. If the `get-event-selectors` command returns an empty array, data events are not included in the trail's logging configuration; therefore, object-level API operations performed on S3 buckets within your AWS account are not being recorded.

8. Repeat steps 1-7 to verify that each trail has multi-region enabled and is configured to log data events. If a trail does not have multi-region enabled and data event logging configured, refer to the remediation steps.

## Expected Result

At least one multi-region trail has S3 object-level write event logging enabled for all buckets.

## Remediation

### Using AWS Console

1. Login to the AWS Management Console and navigate to the S3 dashboard at `https://console.aws.amazon.com/s3/`.
2. In the left navigation panel, click `buckets`, and then click the name of the S3 bucket you want to examine.
3. Click the `Properties` tab to see the bucket configuration in detail.
4. In the `AWS CloudTrail data events` section, select the trail name for recording activity. You can choose an existing trail or create a new one by clicking the `Configure in CloudTrail` button or navigating to the CloudTrail console.
5. Once the trail is selected, select the `Data Events` check box.
6. Select `S3` from the `Data event type` drop-down.
7. Select `Log all events` from the `Log selector template` drop-down.
8. Repeat steps 2-7 to enable object-level logging of write events for other S3 buckets.

### Using AWS CLI

1. To enable `object-level` data events logging for S3 buckets within your AWS account, run the `put-event-selectors` command using the name of the trail that you want to reconfigure as identifier:

```bash
aws cloudtrail put-event-selectors --region <region-name> --trail-name <trail-name> --event-selectors '[{ "ReadWriteType": "WriteOnly", "IncludeManagementEvents":true, "DataResources": [{ "Type": "AWS::S3::Object", "Values": ["arn:aws:s3:::<s3-bucket-name>/"] }] }]'
```

2. The command output will be `object-level` event trail configuration.
3. If you want to enable it for all buckets at once, change the Values parameter to `["arn:aws:s3"]` in the previous command.
4. Repeat step 1 for each s3 bucket to update `object-level` logging of write events.
5. Change the AWS region by updating the `--region` command parameter, and perform the process for the other regions.

## Default Value

By default, CloudTrail does not log object-level (data event) API operations for S3 buckets. Data event logging must be explicitly enabled per trail and bucket.

## References

1. https://docs.aws.amazon.com/AmazonS3/latest/user-guide/enable-cloudtrail-events.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs - Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. |      | x    | x    |
| v7               | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements.                                                                                |      | x    | x    |

## Profile

Level 2 | Automated
