---
name: cis-aws-foundations-4.1
description: "Ensure CloudTrail is enabled in all regions"
category: cis-logging
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, logging, cloudtrail, multi-region, management-events]
cis_id: "4.1"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-4.2, cis-aws-foundations-4.3, cis-aws-foundations-4.4, cis-aws-foundations-4.5]
prerequisites: []
severity_boost: {}
---

# Ensure CloudTrail is enabled in all regions

## Description

AWS CloudTrail is a web service that records AWS API calls for your account and delivers log files to you. The recorded information includes the identity of the API caller, the time of the API call, the source IP address of the API caller, the request parameters, and the response elements returned by the AWS service. CloudTrail provides a history of AWS API calls for an account, including API calls made via the Management Console, SDKs, command line tools, and higher-level AWS services (such as CloudFormation).

## Rationale

The AWS API call history produced by CloudTrail enables security analysis, resource change tracking, and compliance auditing. Additionally,

- ensuring that a multi-region trail exists will help detect unexpected activity occurring in otherwise unused regions
- ensuring that a multi-region trail exists will ensure that Global Service Logging is enabled for a trail by default to capture recordings of events generated on AWS global services
- for a multi-region trail, ensuring that management events are configured for all types of Read/Writes ensures the recording of management operations that are performed on all resources in an AWS account

## Impact

S3 lifecycle features can be used to manage the accumulation and management of logs over time. See the following AWS resource for more information on these features:

1. https://docs.aws.amazon.com/AmazonS3/latest/dev/object-lifecycle-mgmt.html

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console and open the CloudTrail console at https://console.aws.amazon.com/cloudtrail
2. Click on `Trails` in the left navigation pane
3. You will be presented with a list of trails across all regions
4. Ensure that at least one Trail has `Yes` specified in the `Multi-region trail` column
5. Click on a trail via the link in the `Name` column
6. Ensure `Logging` is set to `ON`
7. Ensure `Multi-region trail` is set to `Yes`
8. In the section `Management Events`, ensure that `API activity` set to `ALL`

### Using AWS CLI

1. List all trails:

```bash
aws cloudtrail describe-trails
```

2. Ensure `IsMultiRegionTrail` is set to `true`:

```bash
aws cloudtrail get-trail-status --name <trail-name>
```

3. Ensure `IsLogging` is set to `true`:

```bash
aws cloudtrail get-event-selectors --trail-name <trail-name>
```

4. Ensure there is at least one `fieldSelector` for a trail that equals `Management`:

- This should NOT output any results for Field: "readOnly". If either `true` or `false` is returned, one of the checkboxes (`read` or `write`) is not selected.

Example of correct output:

```json
"TrailARN": "<your_trail_ARN>",
    "AdvancedEventSelectors": [
        {
            "Name": "Management events selector",
            "FieldSelectors": [
                {
                    "Field": "eventCategory",
                    "Equals": [
                        "Management"
                    ]
                }
            ]
        }
    ]
```

## Expected Result

At least one multi-region trail exists with `IsMultiRegionTrail` set to `true`, `IsLogging` set to `true`, and management events configured for all read/write types.

## Remediation

### Using AWS Console

1. Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/cloudtrail.
2. Click on `Trails` in the left navigation pane.
3. Click `Get Started Now` if it is presented, then:
   - Click `Add new trail`.
   - Enter a trail name in the `Trail name` box.
     - A trail created in the console is a multi-region trail by default.
   - Specify an S3 bucket name in the `S3 bucket` box.
   - Specify the AWS KMS alias under the `Log file SSE-KMS encryption` section, or create a new key.
   - Click `Next`.
4. Ensure the `Management events` check box is selected.
5. Ensure both `Read` and `Write` are checked under API activity.
6. Click `Next`.
7. Review your trail settings and click `Create trail`.

### Using AWS CLI

Create a multi-region trail:

```bash
aws cloudtrail create-trail --name <trail-name> --bucket-name <s3-bucket-for-cloudtrail> --is-multi-region-trail
```

Enable multi-region on an existing trail:

```bash
aws cloudtrail update-trail --name <trail-name> --is-multi-region-trail
```

**Note:** Creating a CloudTrail trail via the CLI without providing any overriding options configures all `read` and `write` `Management Events` to be logged by default.

## Default Value

By default, CloudTrail is not enabled in any region.

## References

1. CCE-78913-1
2. https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html#cloudtrail-concepts-management-events
3. https://docs.aws.amazon.com/awscloudtrail/latest/userguide/logging-management-and-data-events-with-cloudtrail.html?icmpid=docs_cloudtrail_console#logging-management-events
4. https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-supported-services.html#cloud-trail-supported-services-data-events

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs - Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. |      | x    | x    |
| v7               | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices.                                                                                                                                                                         | x    | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations  |
| --------------------------- | ------- | ------------ |
| T1535                       | TA0005  | M1047, M1054 |

## Profile

Level 1 | Manual
