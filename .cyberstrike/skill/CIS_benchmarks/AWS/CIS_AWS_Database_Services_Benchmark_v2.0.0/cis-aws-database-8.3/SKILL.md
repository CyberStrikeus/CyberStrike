---
name: cis-aws-database-8.3
description: "Ensure Data at Rest and in Transit is Encrypted"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, keyspaces, cassandra, encryption, kms, tls]
cis_id: "8.3"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-8.1, cis-aws-database-8.2, cis-aws-database-8.4]
prerequisites: []
severity_boost: {}
---

# 8.3 Ensure Data at Rest and in Transit is Encrypted (Manual)

## Description
Once a user is logged in to their AWS account and has access to their Amazon Keyspaces they are encouraged to choose from the following two options to encrypt their data. Depending on which key they select for encryption at rest would store the data according to their preference. For encryption in transit the user is also encouraged to choose from two options depending on if the data needs to be encrypted during transit.

## Rationale
Encryption at rest and in transit protects data from unauthorized access whether stored or being transferred between locations.

## Impact
Prevents any unauthorized user from accessing the database and provides security when transferring the data from one location to another.

## Audit Procedure

### Using AWS Console
1. Sign in to the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.
2. Open the Amazon Keyspaces Console - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/keyspaces/.
3. Select the Keyspace:
   - Choose the Keyspace (database) for which you want to enable encryption at rest and in transit.
   - Click on the Keyspace name to access its details page.
4. Enable Encryption at Rest:
   - In the Keyspace details page, click on the `Configuration` tab.
   - Under the `Encryption` section, locate the "Encryption at Rest" option.
   - Click on `Edit`.
   - Select the desired encryption setting:
     - Default Encryption: Choose this option to use the default AWS-managed key for encryption at rest. Amazon Keyspaces automatically encrypts your data using this default key.
     - Customer Managed Key (CMK): Choose this option if you want to use your own AWS Key Management Service (KMS) customer-managed key for encryption. Select the appropriate CMK from the dropdown menu.
   - Click "Save" to enable encryption at rest for the Keyspace.
5. Enable Encryption in Transit:
   - In the Keyspace details page, click on the `Configuration` tab.
   - Under the `Encryption` section, locate the "Encryption in Transit" option.
   - Click on `Edit`.
   - Select the desired encryption setting:
     - Encryption in Transit Enabled: Choose this option to enable encryption in transit for data transmitted between your client applications and Amazon Keyspaces. Keyspaces support Transport Layer Security (TLS) encryption for secure communication.
     - Encryption in Transit Disabled: Choose this option if you do not require encryption in transit.
   - Click "Save" to enable encryption in transit for the Keyspace.
6. Verify Encryption Status:
   - Wait a few minutes for the changes to propagate and the encryption settings to take effect.
   - Refresh the Keyspace details page to see the updated encryption status.
   - Verify that encryption at rest and in transit are enabled for the Keyspace.

## Expected Result
Encryption at rest should be enabled (using either AWS-managed or customer-managed KMS key) and encryption in transit should be enabled with TLS.

## Remediation

### Using AWS Console
Follow the audit steps above to enable encryption at rest and in transit for your Amazon Keyspaces.

## Default Value
Amazon Keyspaces encrypts data at rest by default using AWS-managed keys. Encryption in transit via TLS is supported but requires client configuration.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit | | x | x |
| v8 | 3.11 Encrypt Sensitive Data at Rest | | x | x |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | | x | x |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | x |

## Profile
Level 1 | Manual
