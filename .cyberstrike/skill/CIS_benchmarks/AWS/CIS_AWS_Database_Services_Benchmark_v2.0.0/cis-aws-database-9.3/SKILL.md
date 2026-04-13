---
name: cis-aws-database-9.3
description: "Ensure Data in Transit is Encrypted"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, neptune, graph-database, encryption, tls, ssl]
cis_id: "9.3"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-9.1, cis-aws-database-9.2, cis-aws-database-9.4]
prerequisites: []
severity_boost: {}
---

# 9.3 Ensure Data in Transit is Encrypted (Manual)

## Description

Enabling encryption in transit helps that the data is protected when it is moving from one location to another.

## Rationale

Encryption in transit ensures data transmitted between clients and Neptune remains confidential and protected from interception.

## Impact

If an unauthorized user steals the data, it would be unreadable for them because a key would be required to decrypt the message into plaintext.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.
2. Open the Amazon Neptune Console - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/neptune/.
3. Select the Neptune Cluster:
   - Choose the Amazon Neptune cluster for which you want to implement encryption in transit.
   - Click on the cluster name to access its details page.
4. Enable SSL/TLS Encryption:
   - In the cluster details page, navigate to the `Configuration` or `Encryption in Transit` section.
   - Under `Encryption in Transit`, ensure that the `Enable` option is selected.
   - Optionally, you can also select the `Enforce` option to require SSL/TLS encryption for all client connections to the Neptune cluster.
   - Click `Apply Changes` to enable SSL/TLS encryption for the Neptune cluster.
5. Update Client Applications:
   - When connecting to the Neptune cluster, update your client applications to establish an SSL/TLS-encrypted connection.
   - Consult your client drivers or libraries documentation or configuration settings to enable SSL/TLS encryption.
   - Configure the necessary SSL/TLS settings, such as specifying the SSL/TLS certificate to use.
6. Verify Encryption in Transit:
   - Test the connection to the Neptune cluster from your client application.
   - Ensure that the connection is established using SSL/TLS encryption.
   - Verify that all data transmitted between your client applications and the Neptune cluster is encrypted in transit.

## Expected Result

SSL/TLS encryption in transit should be enabled (and preferably enforced) for all connections to the Neptune cluster.

## Remediation

### Using AWS Console

Follow the audit steps above to enable and enforce SSL/TLS encryption in transit for your Neptune cluster.

## Default Value

Neptune supports SSL/TLS encryption in transit. It should be explicitly enabled and enforced for all client connections.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | x    | x    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | x    | x    |

## Profile

Level 1 | Manual
