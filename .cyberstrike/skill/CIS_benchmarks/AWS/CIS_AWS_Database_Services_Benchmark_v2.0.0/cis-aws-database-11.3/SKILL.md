---
name: cis-aws-database-11.3
description: "Ensure Data at Rest is Encrypted"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, qldb, ledger, encryption, kms]
cis_id: "11.3"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-11.1, cis-aws-database-11.2, cis-aws-database-11.4]
prerequisites: []
severity_boost: {}
---

# 11.3 Ensure Data at Rest is Encrypted (Manual)

## Description
This helps ensure that the data is kept secure and protected when at rest. The user must choose from two key options which then determine when the data is encrypted at rest.

## Rationale
Encryption at rest protects QLDB ledger data from unauthorized access even if the underlying storage media is compromised.

## Impact
If an unauthorized user steals the data, it would be unreadable for them because a key would be required to decrypt the message into plaintext.

## Audit Procedure

### Using AWS Console
1. Create an AWS Key Management Service (KMS) Key:
   - Sign in to the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.
   - Open the AWS Key Management Service (KMS) console.
   - Create a new KMS key or select an existing one to encrypt your QLDB data at rest.
   - Configure the key policy to grant the appropriate IAM users or role permissions.
2. Enable Encryption for QLDB:
   - Open the Amazon QLDB console.
   - Choose the QLDB ledger for which you want to enable encryption at rest.
   - Click on the `Configuration` tab.
   - Under the `Encryption` section.
   - Click on the `Edit` button or `Modify` option.
   - Enable encryption for the ledger.
   - Select the KMS key you created or chose in the first step for encrypting the QLDB data.
   - Save the changes to enable encryption at rest for the QLDB ledger.
3. Verify Encryption Status:
   - Once the encryption at rest is enabled, the QLDB console will indicate the encryption status as `Enabled` for the selected ledger.
   - Ensure that the KMS key specified for encryption is the correct key you intended to use.
4. Testing and Verification:
   - Perform read and write operations on your QLDB ledger to validate that the data is encrypted at rest.
   - Verify that you can access and query the encrypted data using appropriate authentication and authorization methods.
5. Key Management and Rotation:
   - Follow AWS best practices for key management, including securely storing and managing the KMS key used for QLDB encryption.
   - Implement a key rotation policy, following AWS recommendations and compliance requirements if required.
6. Backup and Disaster Recovery:
   - Ensure you have appropriate backup and disaster recovery mechanisms for your QLDB data.
   - Consider backing up the KMS key used for encryption to prevent data loss in case of a key compromise or accidental deletion.

## Expected Result
Encryption at rest should be enabled for all QLDB ledgers using either AWS-managed or customer-managed KMS keys, with the encryption status showing as `Enabled`.

## Remediation

### Using AWS Console
Follow the audit steps above to enable encryption at rest for your Amazon QLDB ledgers.

## Default Value
QLDB encrypts all data at rest by default using an AWS-owned KMS key. Customer-managed KMS keys can be configured for additional control.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | x | x |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | x |

## Profile
Level 1 | Manual
