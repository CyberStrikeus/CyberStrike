---
name: cis-aws-storage-3.11
description: "Ensure accessing Points and IAM Policies for EFS"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, efs, iam, access-points, elasticfilesystem, access-control]
cis_id: "3.11"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-3.10]
prerequisites: []
severity_boost: {}
---

# 3.11 Ensure accessing Points and IAM Policies (Manual)

## Profile Applicability

- Level 2

## Description

You can use IAM policies to control access to your EFS access points. To achieve this, utilize the `elasticfilesystem:AccessPointArn` IAM condition key. The `AccessPointArn` represents the Amazon Resource Name (ARN) of the access point that the file system is mounted with.

## Rationale

The rationale for using IAM policies with the `elasticfilesystem:AccessPointArn` condition key is to ensure precise and secure access control to EFS access points. By specifying the access point's ARN, you can restrict interactions to authorized users and resources only, thereby enhancing data security and preventing unauthorized access. This approach maintains the integrity and confidentiality of your data within the AWS environment.

## Impact

Without using IAM policies with the `elasticfilesystem:AccessPointArn` condition key, access control to EFS access points becomes less precise, increasing the risk of unauthorized access. This lack of granular control can lead to potential security breaches, data exposure, and compliance violations. Consequently, your organization may face data integrity issues, financial losses, and damage to its reputation.

## Audit Procedure

### Console

Below is a sample IAM policy copied from the AWS documentation:

```json
{
  "Version": "2012-10-17",
  "Id": "MyFileSystemPolicy",
  "Statement": [
    {
      "Sid": "App1Access",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:role/app1" },
      "Action": ["elasticfilesystem:ClientMount", "elasticfilesystem:ClientWrite"],
      "Condition": {
        "StringEquals": {
          "elasticfilesystem:AccessPointArn": "arn:aws:elasticfilesystem:us-east-1:222233334444:access-point/fsap-01234567"
        }
      }
    },
    {
      "Sid": "App2Access",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:role/app2" },
      "Action": ["elasticfilesystem:ClientMount", "elasticfilesystem:ClientWrite"],
      "Condition": {
        "StringEquals": {
          "elasticfilesystem:AccessPointArn": "arn:aws:elasticfilesystem:us-east-1:222233334444:access-point/fsap-89abcdef"
        }
      }
    }
  ]
}
```

This policy demonstrates:

- Using the `elasticfilesystem:AccessPointArn` condition to restrict access to specific access points
- Granting `ClientMount` and `ClientWrite` permissions to specific IAM roles
- Associating different roles with different access points

## Expected Result

- IAM policies should use the `elasticfilesystem:AccessPointArn` condition key
- Policies should restrict access to specific access points via their ARN
- Only authorized principals should have ClientMount and ClientWrite permissions
- Each access point should have appropriate IAM policy restrictions

## Remediation

### Console

Implement IAM policies that use the `elasticfilesystem:AccessPointArn` condition key:

1. Create or update IAM policies for EFS access
2. Include the `elasticfilesystem:AccessPointArn` condition key
3. Specify the ARN of the access point in the condition
4. Grant only necessary permissions (ClientMount, ClientWrite, etc.)
5. Assign policies to appropriate IAM roles/users
6. Review and test access control regularly

Example policy structure:

```json
{
  "Effect": "Allow",
  "Principal": { "AWS": "arn:aws:iam::ACCOUNT:role/ROLE" },
  "Action": ["elasticfilesystem:ClientMount", "elasticfilesystem:ClientWrite"],
  "Condition": {
    "StringEquals": {
      "elasticfilesystem:AccessPointArn": "arn:aws:elasticfilesystem:REGION:ACCOUNT:access-point/ACCESS_POINT_ID"
    }
  }
}
```

## Default Value

By default, no IAM policies are automatically created for EFS access points. Users must explicitly create and configure IAM policies with appropriate condition keys to control access.

## References

1. https://docs.aws.amazon.com/efs/latest/ug/efs-access-points.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                                              | ●    | ●    | ●    |
| v8               | 6.8 Define and Maintain Role-Based Access Control<br/>Define and maintain role-based access control, through determining and documenting the access rights necessary for each role within the enterprise to successfully carry out its assigned duties. Perform access control reviews of enterprise assets to validate that all privileges are authorized, on a recurring schedule at a minimum annually, or more frequently. |      |      | ●    |
| v7               | 1.7 Deploy Port Level Access Control<br/>Utilize port level access control, following 802.1x standards, to control which devices can authenticate to the network. The authentication system shall be tied into the hardware asset inventory data to ensure only authorized devices can connect to the network.                                                                                                                 |      | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.                       | ●    | ●    | ●    |

## Profile

Level 2
