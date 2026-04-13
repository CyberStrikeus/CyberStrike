---
name: cis-aws-database-2.2
description: "Ensure Data at Rest is Encrypted"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, aurora, encryption, kms, data-at-rest]
cis_id: "2.2"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-2.3]
prerequisites: []
severity_boost: {}
---

# 2.2 Ensure Data at Rest is Encrypted (Manual)

## Description

Amazon Aurora allows you to encrypt your databases using keys you manage through AWS Key Management Service (KMS).

## Rationale

Databases are likely to hold sensitive and critical data; therefore, it is highly recommended to implement encryption to protect your data from unauthorized access or disclosure.

## Impact

Unauthorized users cannot access the data because it is protected by an encryption key that only authorized users can use.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console where the Aurora database cluster you are auditing resides.
2. Navigate to the Amazon Aurora and RDS Dashboard:
   - You can find this under the Database category.
3. Select the DB cluster name you wish to audit:
   - This opens the details page for your specific Aurora cluster.
4. Check the encryption status under the Configuration section.
   - Confirm that the field Encryption is marked as Enabled.
5. Verify KMS key usage (if your organization's standards require a customer-managed key):
   - In the Encryption section, identify the AWS KMS key associated with the cluster. Click the key link to open its details page. Confirm that it is a customer-managed KMS key, not an AWS-managed key.
   - Review additional key attributes to ensure compliance, including Key policy, Key rotation status, etc.

## Expected Result

The Encryption field should be marked as "Enabled" under the Configuration section of the Aurora cluster. If organization standards require it, a customer-managed KMS key should be in use rather than an AWS-managed key.

## Remediation

### Using AWS Console

For existing Aurora databases: In order to encrypt an existing Aurora instance that was not initially created with encryption enabled, you will need to create a snapshot of the instance, make a copy of the snapshot with encryption enabled, and then restore the DB instance from the copied snapshot.

For creating new Aurora databases with encryption at rest enabled:

1. **Sign in to AWS Management Console**
   - If you do not already have an AWS account, you'll need to create one at https://aws.amazon.com

2. **Navigate to the Amazon Aurora and RDS Dashboard:**
   - You can find this under the Database category.

3. Click on `Create Database` and choose Aurora as your engine option.

4. In the `Additional Configuration` section, you will see an option labeled `Enable encryption`. Check this box to enable encryption for data at rest.
   - You will also need to select a master key to use for encryption. You can choose the default AWS managed key for RDS or a pre-created customer-managed AWS Key Management Service (KMS) that aligns with your organization's key management policies.

5. **Launch the DB Instance**
   - After you have selected the appropriate encryption settings, click `Create database`.
   - Review your settings on the following page, and if everything looks correct, click `Launch DB Instance`.

## Default Value

Encryption at rest can be enabled when creating a new Aurora DB cluster. Once created, encryption cannot be changed. By default, encryption is not enabled unless specified during creation.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest - Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. Storage-layer encryption, also known as server-side encryption, meets the minimum requirement of this Safeguard. Additional encryption methods may include application-layer encryption, also known as client-side encryption, where access to the data storage device(s) does not permit access to the plain-text data. | | x | x |
| v7 | 14.8 Encrypt Sensitive Information at Rest - Encrypt all sensitive information at rest using a tool that requires a secondary authentication mechanism not integrated into the operating system, in order to access the information. | | | x |

## Profile

Level 1 | Manual
