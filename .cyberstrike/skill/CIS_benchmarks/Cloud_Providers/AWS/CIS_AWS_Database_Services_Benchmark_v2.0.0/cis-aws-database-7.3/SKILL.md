---
name: cis-aws-database-7.3
description: "Ensure Encryption at Rest is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, documentdb, encryption, kms, at-rest]
cis_id: "7.3"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-7.4, cis-aws-database-7.11]
prerequisites: []
severity_boost: {}
---

# 7.3 Ensure Encryption at Rest is Enabled (Manual)

## Description

Ensure that encryption at rest is enabled for Amazon DocumentDB clusters to protect stored data from unauthorized access.

## Rationale

This helps ensure that the data is kept secure and protected when at rest. The user must choose from two key options which then determine when the data is encrypted at rest.

## Impact

If an unauthorized user steals the data, it would be unreadable for them because a key would be required to decrypt the message into plaintext.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console
   - Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon DocumentDB Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/docdb/.

3. Select the DocumentDB Cluster
   - Choose the Amazon DocumentDB cluster for which you want to enable encryption at rest.
   - Click on the cluster name to access its details page.
   - In the cluster details page, navigate to the "Configuration" section.

4. Enable Encryption at Rest
   - Under the `Storage` section.
   - Click on the "Edit" button or "Modify" option to configure the encryption settings.
   - Choose the option to enable encryption at rest for the cluster.

5. Choose the Encryption Key
   - Select the AWS Key Management Service (KMS) key that you want to use for encrypting your DocumentDB data.
   - You can choose an existing KMS key or create a new one.
   - Ensure that the KMS key you select has appropriate permissions for DocumentDB to use it.

6. Save the Configuration
   - Click the `Save` button to apply the encryption at rest configuration.
   - DocumentDB will start the process of encrypting the existing data and all new data written to the cluster.

7. Verify Encryption Status
   - Monitor the cluster status to ensure that the encryption process is completed successfully.
   - Once the encryption is enabled, the cluster status will reflect the updated encryption status.

8. Test Connectivity
   - Validate that you can still connect to the DocumentDB cluster after enabling encryption at rest.
   - Ensure that your applications and authorized users can access the encrypted data.

9. Monitor and Manage Encryption
   - Regularly monitor the encryption status of your DocumentDB cluster.
   - Ensure that the encryption remains enabled and that no unauthorized modifications are made.

## Expected Result

Encryption at rest is enabled for all DocumentDB clusters using either AWS managed keys or customer-managed KMS keys.

## Remediation

### Using AWS Console

Follow the audit procedure steps to enable encryption at rest for each DocumentDB cluster. Note that encryption at rest can only be enabled when creating a new cluster. Existing unencrypted clusters must be migrated to new encrypted clusters.

## Default Value

Amazon DocumentDB encrypts data at rest by default using AWS managed keys.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest        |      | X    | X    |
| v7               | 14.8 Encrypt Sensitive Information at Rest |      |      | X    |

## Profile

Level 1 | Manual
