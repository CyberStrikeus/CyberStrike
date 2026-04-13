---
name: cis-aws-database-6.2
description: "Ensure Data at Rest and in Transit is Encrypted"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, memorydb, redis, encryption, kms, tls]
cis_id: "6.2"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-6.1, cis-aws-database-6.3, cis-aws-database-6.5]
prerequisites: []
severity_boost: {}
---

# 6.2 Ensure Data at Rest and in Transit is Encrypted (Manual)

## Description

Ensure that encryption at rest and encryption in transit are both enabled for Amazon MemoryDB for Redis clusters to protect data confidentiality.

## Rationale

Encrypting data at rest and in transit protects sensitive information from unauthorized access. Encryption at rest ensures stored data cannot be read even if underlying storage is compromised. Encryption in transit (TLS) protects data as it moves between clients and the MemoryDB cluster.

## Impact

Enabling encryption may have a minor performance impact due to cryptographic operations. Applications must support TLS connections when encryption in transit is enabled.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console
   - Sign in to the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon MemoryDB Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/memorydb/.

3. Select the Cluster
   - Choose the MemoryDB cluster for which you want to enable encryption at rest and in transit.
   - Click on the cluster name to access its details page.

4. Enable Encryption at Rest
   - In the cluster details page, navigate to the `Encryption at Rest` section.
   - Click on `Modify` to edit the encryption settings.
   - Select the desired encryption option:
     - AWS Managed Key (Default): Choose this option to use the default AWS managed key for encryption at rest. Amazon MemoryDB automatically encrypts your data using this key.
     - Customer Managed Key (CMK): Choose this option if you want to use your own AWS Key Management Service (KMS) customer-managed key for encryption. Select the appropriate CMK from the dropdown menu.
   - Click "Apply Changes" to enable encryption at rest for the MemoryDB cluster.

5. Enable Encryption in Transit
   - In the cluster details page, navigate to the `Encryption in Transit` section.
   - Click on `Modify` to edit the encryption settings.
   - Select the desired encryption option:
     - Encryption in Transit Enabled: Choose this option to enable encryption in transit for data transmitted between your client applications and MemoryDB. MemoryDB uses SSL/TLS encryption to secure the communication channel.
     - Encryption in Transit Disabled: Choose this option if you do not require encryption in transit.
   - Click `Apply Changes` to enable encryption in transit for the MemoryDB cluster.

6. Verify Encryption Status
   - Wait a few minutes for the changes to propagate and the encryption settings to take effect.
   - Refresh the cluster details page to see the updated encryption status.
   - Verify that encryption at rest and in transit are enabled for the MemoryDB cluster.

## Expected Result

Both encryption at rest and encryption in transit are enabled for all MemoryDB clusters.

## Remediation

### Using AWS Console

Follow the audit procedure steps to enable encryption at rest and in transit for each MemoryDB cluster.

## Default Value

Amazon MemoryDB for Redis encrypts data at rest by default using AWS managed keys. Encryption in transit (TLS) is enabled by default.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit | | X | X |
| v8 | 3.11 Encrypt Sensitive Data at Rest | | X | X |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | | X | X |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | X |

## Profile

Level 1 | Manual
