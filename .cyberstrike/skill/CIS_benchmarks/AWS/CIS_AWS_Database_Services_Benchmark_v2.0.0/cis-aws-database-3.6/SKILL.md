---
name: cis-aws-database-3.6
description: "Enable Encryption in Transit"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, rds, encryption, encryption-in-transit, ssl, tls]
cis_id: "3.6"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-3.5]
prerequisites: []
severity_boost: {}
---

# 3.6 Enable Encryption in Transit (Manual)

## Description

Amazon Relational Database uses SSL/TLS to encrypt data during transit. To secure your data in transit the individual should identify their client application and what is supported by SSL/TLS to configure it correctly.

## Rationale

Encrypting data in transit prevents eavesdropping, man-in-the-middle attacks, and data interception between the application and the database.

## Impact

Enabling encryption in transit ensures data confidentiality during transmission between the client application and the RDS instance.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console
   - Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon RDS Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/rds/.

3. Select the RDS Instance
   - Choose the Amazon RDS instance you want to implement encryption in transit.
   - Click on the instance name to access its details page.
   - In the instance details page, navigate to the `Configuration` or `Encryption & Security` section.

4. Enable SSL/TLS
   - Under the `Connectivity` or `Encryption in Transit` section
   - Click the `Modify` or `Edit` option to enable SSL/TLS encryption.
   - Select the option to enable SSL/TLS encryption.
   - Choose the SSL/TLS certificate authority (CA) certificate option that best suits your needs:
     - If you have an existing certificate, select `Use a certificate from ACM (AWS Certificate Manager)` or `Use a certificate from AWS Secrets Manager`.
     - If you do not have a certificate, select `Generate a new certificate`.
   - Click `Continue` or `Save` to apply the changes.

5. Verify SSL/TLS Encryption
   - After enabling SSL/TLS encryption, monitor the encryption status of your RDS instance.
   - In the RDS console, check the `Connectivity` or "Encryption in Transit" section to ensure that SSL/TLS encryption is enabled, and the status is "In Progress" or "Enabled."

6. Test SSL/TLS Encryption
   - Connect to your RDS instance using a database client or application that supports SSL/TLS encryption.
   - Configure the client or application to use SSL/TLS encryption by specifying the SSL/TLS certificate details.
   - Verify that the connection is established successfully with SSL/TLS encryption.

7. Monitor and Manage SSL/TLS Certificates
   - Regularly monitor the SSL/TLS certificates associated with your RDS instances.
   - Manage certificate expiration and renewal to ensure uninterrupted SSL/TLS encryption.

## Expected Result

All RDS instances should have SSL/TLS encryption enabled for connections, and clients should be configured to require encrypted connections.

## Remediation

### Using AWS Console

Follow the audit steps above to enable SSL/TLS encryption on the RDS instance. Configure the database parameter group to enforce SSL connections (e.g., `rds.force_ssl=1` for PostgreSQL).

## Default Value

SSL/TLS is supported by default on RDS instances, but enforcement of SSL-only connections must be configured manually.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | x    | x    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | x    | x    |

## Profile

Level 1 | Manual
