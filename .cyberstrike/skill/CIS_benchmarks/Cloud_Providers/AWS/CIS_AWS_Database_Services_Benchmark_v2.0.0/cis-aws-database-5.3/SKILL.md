---
name: cis-aws-database-5.3
description: "Ensure Encryption at Rest and in Transit is configured"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, elasticache, redis, encryption, tls, kms, encryption-at-rest, encryption-in-transit]
cis_id: "5.3"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-5.1, cis-aws-database-5.2]
prerequisites: []
severity_boost: {}
---

# 5.3 Ensure Encryption at Rest and in Transit is configured

## Description

Enabling encryption at rest and in transit for Amazon ElastiCache helps protect your data when it is stored and transmitted.

## Rationale

Enabling encryption at rest secured the users data where it is stored. Enabling encryption in transit helps that the data is protected when it is moving from one location to another.

## Impact

If the user didn't enable encryption and rest and during transit, there is a possibility of the data being vulnerable to a ransomware attack.

## Audit Procedure

### Using AWS Console

1. Enable Encryption at Rest
   - Sign in to the AWS Management Console and open the Amazon ElastiCache console at https://console.aws.amazon.com/elasticache/.
   - Create a new ElastiCache cluster or select an existing cluster.
   - On the cluster details page, click the `Encryption` tab.
   - Select the option to enable encryption Under the `Encryption at Rest` section.
   - Choose the desired encryption type:
     - Default Encryption: Select this option to use the default AWS-managed key for encryption.
     - Customer Managed Key (CMK): Select this option to use your own AWS Key Management Service (KMS) customer-managed key for encryption.
   - If you selected `Customer Managed Key (CMK)`, choose the appropriate KMS key from the dropdown menu.
   - Click "Save changes" to enable encryption at rest for the ElastiCache cluster.

2. Enable Encryption in Transit
   - On the ElastiCache cluster details page, click the `Encryption` tab.
   - Select the option to enable encryption Under the "Encryption in Transit" section.
   - Choose the desired encryption type:
     - Transit encryption enabled with SSL/TLS: Select this option to enable encryption in transit using SSL/TLS encryption.
     - Transit encryption disabled: Select this option if you do not require encryption in transit.
   - Click `Save changes` to enable encryption in transit for the ElastiCache cluster.

3. Verify the Encryption Status
   - Wait a few minutes for the changes to propagate and the encryption to take effect.
   - Refresh the ElastiCache console and navigate to the cluster details page.
   - Verify that the encryption status is now enabled for both encryptions at rest and in transit.

## Expected Result

Both encryption at rest and encryption in transit are enabled on all ElastiCache clusters.

## Remediation

The user has two options when it comes to encryption at rest and in transit to choose from. Depending on what actions the user selects from it determines how their data is going to be protected.

### Using AWS Console

Follow the same steps as the audit procedure to enable encryption at rest and in transit for ElastiCache clusters.

## Default Value

By default, encryption at rest and encryption in transit are not enabled for ElastiCache clusters.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | x    | x    |
| v8               | 3.11 Encrypt Sensitive Data at Rest               |      | x    | x    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | x    | x    |
| v7               | 14.8 Encrypt Sensitive Information at Rest        |      |      | x    |

## Profile

Level 1 | Manual
