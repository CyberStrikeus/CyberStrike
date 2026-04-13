---
name: cis-aws-database-10.3
description: "Ensure Encryption in Transit is Configured"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, timestream, time-series, encryption, tls, https]
cis_id: "10.3"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-10.1, cis-aws-database-10.2, cis-aws-database-10.4]
prerequisites: []
severity_boost: {}
---

# 10.3 Ensure Encryption in Transit is Configured (Manual)

## Description

Configure your applications or tools to use secure communication protocols when interacting with Amazon Timestream. Utilize endpoints to establish private and secure connections to Timestream.

## Rationale

The database uses HTTPS/TLS to encrypt data during transit. To secure your data in transit the individual should identify their client application and what is supported by HTTPS/TLS in order to configure it correctly. Also has an option for leverage, which creates a private connection between virtual private code (VPC) without interfering with public networks.

## Impact

If the client does not have the code configured correctly it would not be able to connect to the server.

## Audit Procedure

### Using AWS Console

1. Understand Encryption in Transit in Timestream:
   - Familiarize yourself with the concept of encryption in transit and its importance in securing data communication. Understand that encryption in transit ensures that data transmitted between clients and Timestream remains confidential and protected from interception.
2. Use HTTPS for Communication:
   - Configure your client applications or tools to communicate with Amazon Timestream over HTTPS. Utilize the HTTPS protocol to establish secure encrypted connections between clients and the Timestream service. Ensure your client applications support the TLS (Transport Layer Security) protocol versions AWS recommends.
3. Leverage AWS PrivateLink (Optional):
   - Consider using AWS PrivateLink to establish private and secure connections between your VPC and Timestream. Configure a VPC endpoint for Timestream to securely access the service without traversing the public internet.
4. Enable SSL/TLS Certificates:
   - Obtain and configure valid SSL/TLS certificates for your client applications or tools. Install the SSL/TLS certificates on your client systems or load balancers. Use the configured certificates to establish secure connections with Timestream.
5. Verify Encryption in Transit:
   - Validate that your client applications or tools are using secure communication channels. Verify that HTTPS is being utilized for communication with Timestream. Confirm that SSL/TLS certificates are properly configured and used in communication.
6. Monitor Encryption in Transit:
   - Utilize Amazon CloudWatch to monitor the metrics and logs related to your Timestream resources. Set up appropriate alarms and notifications to alert you of any potential security incidents or anomalies in the encryption in transit process. Regularly review the CloudWatch logs and metrics to ensure the integrity and security of the data in transit.
7. Regularly Update Encryption Configuration:
   - Stay informed about the latest encryption standards, protocols, and best practices. Regularly review and update your encryption configurations and settings to align with industry standards and security recommendations. Apply any necessary updates or patches to client applications or tools to maintain strong encryption in transit.

## Expected Result

All communications with Timestream should use HTTPS/TLS with valid SSL/TLS certificates. VPC endpoints should be considered for private connectivity.

## Remediation

### Using AWS Console

Follow the audit steps above to configure encryption in transit for your Amazon Timestream environment.

## Default Value

Amazon Timestream requires HTTPS for all API calls. TLS encryption in transit is enforced by default.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | x    | x    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | x    | x    |

## Profile

Level 1 | Manual
