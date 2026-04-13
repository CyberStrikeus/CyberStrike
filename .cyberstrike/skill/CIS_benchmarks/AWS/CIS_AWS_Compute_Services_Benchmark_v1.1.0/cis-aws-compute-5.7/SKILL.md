---
name: cis-aws-compute-5.7
description: "Ensure you are using an IAM policy to manage access to buckets in Lightsail"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lightsail, iam, buckets, policy, access-control, s3]
cis_id: "5.7"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-5.8, cis-aws-compute-5.9]
prerequisites: []
severity_boost: {}
---

# 5.7 Ensure you are using an IAM policy to manage access to buckets in Lightsail (Manual)

## Description

The following policy grants a user access to manage a specific bucket in the Amazon Lightsail object storage service.

## Rationale

This policy grants access to buckets through the Lightsail console, the AWS Command Line Interface (AWS CLI), AWS API, and AWS SDKs.

## Impact

Users who don't have this policy will experience errors when viewing the Objects tab of the bucket management page in the Lightsail console.

## Audit Procedure

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `IAM` under Security, Identity, & Compliance.
3. Click `Policies`
4. Click in the `Filter policies by property or policy name and press enter`
5. Type `Lightsail` and press enter
6. Click on the policy that contains lightsail in the name
7. Make sure the `Permissions` tab is selected.
8. Confirm the policy looks like this

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LightsailAccess",
      "Effect": "Allow",
      "Action": "lightsail:*",
      "Resource": "*"
    },
    {
      "Sid": "S3BucketAccess",
      "Effect": "Allow",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::<BucketName>/*",
        "arn:aws:s3:::<BucketName>"
      ]
    }
  ]
}
```

9. If this policy is in place move to the next step. If it is not in any of the policies listed for `lightsail` refer to the remediation below.
10. Click on the `Policy usage` tab
11. Confirm that the correct Group and/or User is listed under Permissions. If there is no one listed here refer to the remediation below.

### Using AWS CLI

N/A - This is managed through the AWS Console IAM Policies.

## Expected Result

An IAM policy should exist that grants Lightsail and S3 bucket access, and it should be attached to the appropriate users or groups.

## Remediation

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `IAM` under Security, Identity, & Compliance.
3. Click `Policies`
4. Click `Create policy`
5. Click on the `JSON` tab
6. Copy and paste the policy below into the JSON editor replacing the text in there and filling in the Lightsail bucket names.
   **You can find the Lightsail bucket name in the Lightsail console, Storage, Under buckets.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LightsailAccess",
      "Effect": "Allow",
      "Action": "lightsail:*",
      "Resource": "*"
    },
    {
      "Sid": "S3BucketAccess",
      "Effect": "Allow",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::<BucketName>/*",
        "arn:aws:s3:::<BucketName>"
      ]
    }
  ]
}
```

7. Click `Next tags`
8. Add tags based on your companies outlined Tagging policy that should be in place based on the AWS Foundations Benchmark.
9. Click `Next review`
10. Click in `Name*` and give it a name that contains "Lightsail"
11. Review the summary.
12. Click `Create policy`
13. Click in the `Filter policies by property or policy name and press enter`
14. Type `Lightsail` and press enter
15. Click on the Policy name that you just created.
16. Click on the `Policy usage` tab
17. Click `Attach`
18. Add in the Users or Group that should have this permission.
19. Click `Attach policy`

### Using AWS CLI

N/A - This is managed through the AWS Console IAM Policies.

## Default Value

No IAM policy for Lightsail bucket access exists by default. Access must be explicitly configured.

## References

1. https://lightsail.aws.amazon.com/ls/docs/en_us/articles/amazon-lightsail-bucket-management-policies

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | x | x | x |

## Profile

Level 1 | Manual
