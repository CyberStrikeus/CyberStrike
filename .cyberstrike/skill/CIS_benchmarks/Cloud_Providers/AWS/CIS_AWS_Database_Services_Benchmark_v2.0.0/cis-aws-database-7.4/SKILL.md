---
name: cis-aws-database-7.4
description: "Ensure Encryption in Transit is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, documentdb, encryption, tls, ssl, in-transit]
cis_id: "7.4"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-7.3, cis-aws-database-7.11]
prerequisites: []
severity_boost: {}
---

# 7.4 Ensure Encryption in Transit is Enabled (Manual)

## Description

Ensure that encryption in transit is enabled for Amazon DocumentDB clusters to protect data as it moves between clients and the database.

## Rationale

Amazon Database DB uses SSL/TLS to encrypt data during transit. To secure your data in transit the individual should identify their client application and what is supported by TLS to configure it correctly.

## Impact

Enabling encryption in transit ensures that all communications between client applications and the DocumentDB cluster are secured using SSL/TLS, preventing data interception.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console
   - Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon DocumentDB Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/docdb/.

3. Select the DocumentDB Cluster
   - Choose the Amazon DocumentDB cluster for which you want to enable encryption in transit.
   - Click on the cluster name to access its details page.
   - In the cluster details page, navigate to the "Configuration" section.

4. Enable Encryption in Transit
   - Under the `Network & Security` section.
   - Click on the `Edit` button or `Modify` option to configure the encryption settings.
   - Enable the option for encryption in transit by choosing the appropriate setting.
   - Note that encryption in transit uses SSL/TLS to secure communications between your applications and the DocumentDB cluster.

5. Save the Configuration
   - Click on the "Save" button to apply the encryption in transit configuration.
   - DocumentDB will automatically handle the SSL/TLS encryption for network traffic between clients and the cluster.

6. Validate Encryption in Transit
   - Test the connectivity to your DocumentDB cluster from your applications or clients.
   - Ensure that the communication is established securely using SSL/TLS encryption.

7. Monitor and Maintain Encryption in Transit
   - Regularly monitor the encryption in transit configuration for your DocumentDB cluster.
   - Stay informed about updates or changes in SSL/TLS protocols and encryption standards.
   - Keep your client applications current to ensure they support the latest encryption protocols.

## Expected Result

Encryption in transit (TLS) is enabled for all DocumentDB clusters, and all client connections use SSL/TLS.

## Remediation

### Using AWS Console

Follow the audit procedure steps to enable encryption in transit for each DocumentDB cluster. Configure the cluster parameter group to set `tls` to `enabled`.

## Default Value

Amazon DocumentDB enables encryption in transit (TLS) by default.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | X    | X    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | X    | X    |

## Profile

Level 1 | Manual
