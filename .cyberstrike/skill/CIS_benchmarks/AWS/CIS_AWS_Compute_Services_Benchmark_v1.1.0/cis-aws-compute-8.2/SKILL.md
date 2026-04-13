---
name: cis-aws-compute-8.2
description: "Ensure Batch roles are configured for cross-service confused deputy prevention"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, batch, iam, confused-deputy, cross-service, access-control]
cis_id: "8.2"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-8.1]
prerequisites: []
severity_boost: {}
---

# 8.2 Ensure Batch roles are configured for cross-service confused deputy prevention (Manual)

## Description
The Cross-service confused deputy problem is a security issue where an entity that doesn't have permission to perform an action can coerce a more-privileged entity to perform the action.

## Rationale
Cross-service impersonation can result in the confused deputy problem. Cross-service impersonation can occur when one service (the calling service) calls another service (the called service). The calling service can be manipulated to use its permissions to act on another customer's resources in a way it should not otherwise have permission to access.

## Impact
An IAM role is an identity you can create that has specific permissions with credentials that are valid for short durations. Roles can be assumed by entities that you trust. IAM Roles are often organization named and organization based. Searching for and reviewing the roles for this recommendation is a manual process.

## Audit Procedure

### Using AWS Console
1. Login to the AWS Console using https://console.aws.amazon.com/iam/
2. On the left hand side under Access management, Click on `Roles`
3. Search for any roles related to `Batch`
4. Click on the role and the Assume Role Policy Document and confirm that the AssumeRole Action has a `aws:SourceArn` key that contains the full ARN of the Batch resource

Example of a compliant policy with `aws:SourceArn` condition:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "batch.amazonaws.com"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "ArnLike": {
          "aws:SourceArn": [
            "arn:aws:batch:us-east-1:123456789012:compute-environment/testCE",
          ]
        }
      }
    }
  ]
}
```

5. If it is showing an `*` within the ARN or does not have this condition key specified, then the Batch process has access to all of the resources defined in that environment.

Example of a non-compliant policy (missing `aws:SourceArn` condition):
```json
"arn:aws:batch:us-east-1:123456789012:compute-environment/*",
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "batch.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

6. Repeat for any roles assigned to Batch that have AssumeRole
7. Refer to the remediation below

### Using AWS CLI
N/A - This control is manual and console-based.

## Expected Result
All IAM roles associated with AWS Batch have an `aws:SourceArn` condition key in the AssumeRole policy document that contains the full ARN of the specific Batch resource (not a wildcard `*`).

## Remediation

### Using AWS Console
1. Login to the AWS Console using https://console.aws.amazon.com/iam/
2. On the left hand side under Access management, Click on `Roles`
3. Search for any roles identified above in the audit.
4. Click on the role and update the Action AssumeRole, `aws:SourceArn` to contain the full ARN of the resource

```json
"aws:SourceArn": [
            "arn:aws:batch:us-east-1:123456789012:compute-environment/testCE",
```

5. Repeat for any roles defined in the Audit.

### Using AWS CLI
N/A - This control is manual and console-based.

## Additional Information
Note: Usage of the `aws:SourceAccount` condition key can be used to prevent cross service confused deputy impersonation from external accounts. This condition key is not as specific as using `aws:SourceArn` which can be used to limit access of the IAM Role for specific resources or a group of specific resources.

Example using `aws:SourceAccount`:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "batch.amazonaws.com"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "aws:SourceAccount": "123456789012"
        }
      }
    }
  ]
}
```

## Default Value
By default, IAM roles for Batch do not include the `aws:SourceArn` condition key.

## References
1. https://docs.aws.amazon.com/batch/latest/userguide/cross-service-confused-deputy-prevention.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | X |

## Profile
Level 1 | Manual
