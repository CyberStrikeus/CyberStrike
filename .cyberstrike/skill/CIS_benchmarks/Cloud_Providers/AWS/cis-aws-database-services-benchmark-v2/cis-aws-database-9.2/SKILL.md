---
name: cis-aws-database-9.2
description: "Ensure Data at Rest is Encrypted"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, neptune, graph-database, encryption, kms]
cis_id: "9.2"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-9.1, cis-aws-database-9.3, cis-aws-database-9.4]
prerequisites: []
severity_boost: {}
---

# 9.2 Ensure Data at Rest is Encrypted (Manual)

## Description

This helps ensure that the data is kept secure and protected when at rest. The user must choose from two key options which then determine when the data is encrypted at rest.

## Rationale

Encryption at rest protects data stored in Neptune from unauthorized access even if the underlying storage media is compromised.

## Impact

If an unauthorized user steals the data, it would be unreadable for them because a key would be required to decrypt the message into plaintext.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.
2. Open the Amazon Neptune Console - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/neptune/.
3. Select the Neptune Cluster:
   - Choose the Amazon Neptune cluster for which you want to enable encryption at rest.
   - Click on the cluster name to access its details page.
4. Enable Encryption at Rest:
   - In the cluster details page, navigate to the `Configuration` or `Encryption at Rest` section.
   - Under `Encryption at Rest`, click on `Modify`.
   - In the `Encryption at Rest` dialog box, select the encryption option you prefer:
     - AWS managed key (default): Choose this option to use the default AWS managed key for encryption.
     - Customer-managed key (CMK): Choose this option if you want to use your own AWS Key Management Service (KMS) customer-managed key for encryption. Select the appropriate CMK from the dropdown menu.
   - Click `Apply Changes` to enable encryption at rest for the Neptune cluster.
5. Verify Encryption Status:
   - Wait a few minutes for the changes and configuration to take effect.
   - Refresh the cluster details page to see the updated encryption status.
   - Verify that encryption at rest is enabled for the Neptune cluster.

## Expected Result

Encryption at rest should be enabled for the Neptune cluster, using either AWS-managed key or a customer-managed KMS key.

## Remediation

### Using AWS Console

Follow the audit steps above to enable encryption at rest for your Neptune cluster. Note that encryption at rest can only be enabled when creating a new Neptune cluster; existing unencrypted clusters must be migrated to new encrypted clusters.

## Default Value

Encryption at rest is not enabled by default for Neptune clusters. It must be configured during cluster creation.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest        |      | x    | x    |
| v7               | 14.8 Encrypt Sensitive Information at Rest |      |      | x    |

## Profile

Level 1 | Manual
