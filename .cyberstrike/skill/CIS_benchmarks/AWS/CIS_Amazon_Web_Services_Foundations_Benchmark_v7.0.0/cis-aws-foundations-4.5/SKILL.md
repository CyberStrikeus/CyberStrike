---
name: cis-aws-foundations-4.5
description: "Ensure CloudTrail logs are encrypted at rest using KMS CMKs"
category: cis-logging
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, logging, cloudtrail, kms, encryption, sse-kms, cmk]
cis_id: "4.5"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-4.1, cis-aws-foundations-4.6]
prerequisites: []
severity_boost: {}
---

# Ensure CloudTrail logs are encrypted at rest using KMS CMKs

## Description
AWS CloudTrail is a web service that records AWS API calls for an account and makes those logs available to users and resources in accordance with IAM policies. AWS Key Management Service (KMS) is a managed service that helps create and control the encryption keys used to encrypt account data, and uses Hardware Security Modules (HSMs) to protect the security of encryption keys. CloudTrail logs can be configured to leverage server side encryption (SSE) and KMS customer-created master keys (CMK) to further protect CloudTrail logs. It is recommended that CloudTrail be configured to use SSE-KMS.

## Rationale
Configuring CloudTrail to use SSE-KMS provides additional confidentiality controls on log data, as a given user must have S3 read permission on the corresponding log bucket and must be granted decrypt permission by the CMK policy.

## Impact
Customer-created keys incur an additional cost. See https://aws.amazon.com/kms/pricing/ for more information.

## Audit Procedure

### Using AWS Console
1. Sign in to the AWS Management Console and open the CloudTrail console at https://console.aws.amazon.com/cloudtrail.
2. In the left navigation pane, choose `Trails`.
3. Select a trail.
4. In the `General details` section, select `Edit` to edit the trail configuration.
5. Ensure the box at `Log file SSE-KMS encryption` is checked and that a valid `AWS KMS alias` of a KMS key is entered in the respective text box.

### Using AWS CLI
1. Run the following command:

```bash
aws cloudtrail describe-trails
```

2. For each trail listed, SSE-KMS is enabled if the trail has a `KmsKeyId` property defined.

## Expected Result
All CloudTrail trails have a `KmsKeyId` property defined, indicating SSE-KMS encryption is enabled.

## Remediation

### Using AWS Console
1. Sign in to the AWS Management Console and open the CloudTrail console at https://console.aws.amazon.com/cloudtrail.
2. In the left navigation pane, choose `Trails`.
3. Click on a trail.
4. Under the `S3` section, click the edit button (pencil icon).
5. Click `Advanced`.
6. Select an existing CMK from the `KMS key Id` drop-down menu.
   - **Note:** Ensure the CMK is located in the same region as the S3 bucket.
   - **Note:** You will need to apply a KMS key policy on the selected CMK in order for CloudTrail, as a service, to encrypt and decrypt log files using the CMK provided. View the AWS documentation for editing the selected CMK Key policy.
7. Click `Save`.
8. You will see a notification message stating that you need to have decryption permissions on the specified KMS key to decrypt log files.
9. Click `Yes`.

### Using AWS CLI
Run the following command to specify a KMS key ID to use with a trail:

```bash
aws cloudtrail update-trail --name <trail-name> --kms-key-id <cloudtrail-kms-key>
```

Run the following command to attach a key policy to a specified KMS key:

```bash
aws kms put-key-policy --key-id <cloudtrail-kms-key> --policy <cloudtrail-kms-key-policy>
```

### Additional Information
Three statements that need to be added to the CMK policy:

1. Enable CloudTrail to describe CMK properties:

```json
{
  "Sid": "Allow CloudTrail access",
  "Effect": "Allow",
  "Principal": {
    "Service": "cloudtrail.amazonaws.com"
  },
  "Action": "kms:DescribeKey",
  "Resource": "*"
}
```

2. Granting encrypt permissions:

```json
{
  "Sid": "Allow CloudTrail to encrypt logs",
  "Effect": "Allow",
  "Principal": {
    "Service": "cloudtrail.amazonaws.com"
  },
  "Action": "kms:GenerateDataKey*",
  "Resource": "*",
  "Condition": {
    "StringLike": {
      "kms:EncryptionContext:aws:cloudtrail:arn": [
        "arn:aws:cloudtrail:*:aws-account-id:trail/*"
      ]
    }
  }
}
```

3. Granting decrypt permissions:

```json
{
  "Sid": "Enable CloudTrail log decrypt permissions",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::aws-account-id:user/username"
  },
  "Action": "kms:Decrypt",
  "Resource": "*",
  "Condition": {
    "Null": {
      "kms:EncryptionContext:aws:cloudtrail:arn": "false"
    }
  }
}
```

## Default Value
By default, CloudTrail logs are not encrypted with a KMS CMK. Logs may be encrypted with SSE-S3, but this does not provide the same level of control or auditing as KMS CMKs.

## References
1. https://docs.aws.amazon.com/awscloudtrail/latest/userguide/encrypting-cloudtrail-log-files-with-aws-kms.html
2. https://docs.aws.amazon.com/kms/latest/developerguide/create-keys.html
3. CCE-78919-8
4. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/cloudtrail/update-trail.html
5. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/kms/put-key-policy.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest - Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. | | x | x |
| v8 | 8.1 Establish and Maintain an Audit Log Management Process - Establish and maintain an audit log management process that defines the enterprise's logging requirements. | x | x | x |
| v7 | 14.8 Encrypt Sensitive Information at Rest - Encrypt all sensitive information at rest using a tool that requires a secondary authentication mechanism not integrated into the operating system. | | | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1530 | TA0009 | M1041 |

## Profile
Level 2 | Automated
