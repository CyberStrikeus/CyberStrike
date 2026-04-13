---
name: cis-aws-database-11.4
description: "Ensure Data in Transit is Encrypted"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, qldb, ledger, encryption, tls, https]
cis_id: "11.4"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-11.2, cis-aws-database-11.3, cis-aws-database-11.5]
prerequisites: []
severity_boost: {}
---

# 11.4 Ensure Data in Transit is Encrypted (Manual)

## Description
Use Transport Layer Security (TLS) to encrypt communications between clients and your QLDB instance. QLDB provides TLS support by default, allowing secure communication over the network. Configure your client applications to use TLS when connecting to QLDB.

## Rationale
Amazon Quantum Ledger Database (QLDB), uses TLS to encrypt data during transit. To secure your data in transit the individual should identify their client application and what is supported by TLS in order to configure it correctly.

## Impact
If the user does not have the code configured correctly it would not be able to connect to the server.

## Audit Procedure

### Using AWS Console
1. Understand TLS Encryption for QLDB:
   - Learn about Transport Layer Security (TLS) and its role in securing data during transit.
   - Understand how TLS works to establish secure communication channels between clients and QLDB.
2. Configure Clients for TLS Encryption:
   - Ensure that your client applications support TLS encryption for communication with QLDB.
   - Use the appropriate AWS SDK or QLDB driver that provides TLS encryption support.
   - Update your application code or configurations to enable TLS encryption.
3. Obtain the QLDB Endpoint:
   - Sign in to the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.
   - Open the Amazon QLDB console.
   - Locate the QLDB ledger for which you want to enable encryption in transit.
   - Note down the QLDB endpoint for your ledger.
4. Establish TLS Connection:
   - Use the QLDB endpoint obtained earlier to establish a TLS connection between your client application and QLDB.
   - Configure your client application to connect to QLDB using the secure HTTPS protocol.
   - Provide the necessary authentication credentials or tokens required to establish the connection.
5. Verify TLS Encryption:
   - Once the TLS connection is established, verify that the connection is secured using TLS by checking for a valid TLS certificate.
   - Ensure that your client application can communicate securely with QLDB without any errors or warnings related to encryption.
6. Regularly Update Client Applications:
   - Stay updated with the latest versions of the AWS SDKs or QLDB drivers used by your client applications.
   - Regularly update your client applications to leverage the latest TLS encryption features and security enhancements.
7. Monitor and Review TLS Connections:
   - Utilize AWS CloudTrail and Amazon CloudWatch to monitor and log TLS-related events and errors.
   - Review the logs and alerts to identify potential security issues or anomalies related to TLS connections.
8. Secure Other Communication Channels:
   - Ensure that other communication channels your client applications use, such as APIs or data transfers, also utilize TLS encryption.
   - Implement appropriate encryption and security measures to protect sensitive data during transit in all communication channels.

## Expected Result
All client connections to QLDB should use TLS/HTTPS encryption, with valid TLS certificates properly configured.

## Remediation

### Using AWS Console
Follow the audit steps above to configure and verify TLS encryption in transit for your Amazon QLDB environment.

## Default Value
QLDB enforces TLS encryption for all API calls by default. All communication with QLDB is over HTTPS.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit | | x | x |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | | x | x |

## Profile
Level 1 | Manual
