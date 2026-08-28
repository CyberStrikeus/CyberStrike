---
name: cis-aws-database-3.5
description: "Enable Encryption at Rest"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, rds, encryption, encryption-at-rest, kms]
cis_id: "3.5"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-3.6]
prerequisites: []
severity_boost: {}
---

# 3.5 Enable Encryption at Rest (Manual)

## Description

This helps ensure that the data is kept secure and protected when at rest. The user must choose from two key options which then determine when the data is encrypted at rest.

## Rationale

Encryption at rest protects data stored on disk from unauthorized access, ensuring that even if physical storage media is compromised, the data remains unreadable.

## Impact

If an unauthorized user steals the data, it would be unreadable for them because a key would be required to decrypt the message into plaintext.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console
   - Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon RDS Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/rds/.

3. Select the RDS Instance
   - Choose the Amazon RDS instance you want to enable encryption at rest.
   - Click on the instance name to access its details page.
   - In the instance details page, navigate to the `Configuration` or `Encryption & Security` section.

4. Enable Encryption at Rest
   - Under the `Encryption` or `Encryption at Rest` section
   - Click on the `Modify` button or the `Enable` option to enable encryption at rest.
   - Choose the desired encryption option, either `AWS managed keys (default)` or `Customer managed keys using AWS Key Management Service (KMS)`.
   - If selecting `AWS managed keys`, you do not need to perform additional configuration steps.
   - If selecting `Customer managed keys` you will need to specify the KMS key you want to use for encryption.
   - Select the appropriate KMS key or create a new KMS key if necessary.
   - Click `Continue` or `Save` to apply the changes.

5. Monitor the Encryption Status
   - After enabling encryption at rest, monitor the encryption status of your RDS instance.
   - In the RDS console, check the `Encryption` or `Encryption at Rest` section to ensure that encryption is enabled, and the status is `In Progress` or `Enabled`.

6. Verify Encryption at Rest
   - Validate that data at rest is encrypted by accessing the RDS instance and examining the database files.
   - Confirm that the data is stored in an encrypted format.

## Expected Result

All RDS instances should have encryption at rest enabled, using either AWS managed keys or customer managed keys (KMS).

## Remediation

### Using AWS Console

Follow the audit steps above to enable encryption at rest. Note that encryption cannot be enabled on an existing unencrypted RDS instance. You must create an encrypted snapshot and restore from it.

## Default Value

Encryption at rest is not enabled by default for RDS instances. It must be enabled during instance creation or by restoring from an encrypted snapshot.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest        |      | x    | x    |
| v7               | 14.8 Encrypt Sensitive Information at Rest |      |      | x    |

## Profile

Level 1 | Manual
