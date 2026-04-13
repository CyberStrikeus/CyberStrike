---
name: cis-aws-database-4.4
description: "Ensure DynamoDB Encryption in Transit"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, dynamodb, encryption, tls, encryption-in-transit]
cis_id: "4.4"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-4.3]
prerequisites: []
severity_boost: {}
---

# 4.4 Ensure DynamoDB Encryption in Transit

## Description
Use the SSL/TLS protocol to encrypt data in transit between your applications and DynamoDB. Amazon DynamoDB encrypts data in transit by default using Transport Layer Security (TLS) encryption. Here is a step-by-step guide on how to ensure encryption in transit for your DynamoDB:

## Rationale
Amazon DynamoDB uses TLS to encrypt data during transit. To secure your data in transit the individual should identify their client application and what is supported by TLS to configure it correctly.

## Impact
If the user does not have the code configured correctly it would not be able to connect to the DynamoDB.

## Audit Procedure

### Using AWS Console
1. Access the DynamoDB Console
   - Sign in to the AWS Management Console and open the DynamoDB console at https://console.aws.amazon.com/dynamodb/.

2. Create or Select a DynamoDB Table
   - You can create a new DynamoDB table or select an existing one to configure encryption in transit.

3. Verify Encryption Settings
   - By default, DynamoDB encrypts data in transit using TLS. To ensure that encryption in transit is enabled:
   - In the DynamoDB console, select your table.
   - In the table details, navigate to the `Overview` tab.
   - Under the `Encryption` section, verify that "Encryption at rest" is enabled. This indicates that data is encrypted at rest.
   - Confirm that `Encryption in transit` is enabled. It should be enabled by default.

4. Use SSL/TLS Endpoints for API Calls
   - To ensure that your API calls to DynamoDB are encrypted in transit, use SSL/TLS endpoints:
   - Use the appropriate SDK or AWS CLI in your application or code that interacts with DynamoDB.
   - By default, the SDKs and AWS CLI use the SSL/TLS endpoints provided by DynamoDB.
   - Verify that your code is configured to connect to DynamoDB using the appropriate SSL/TLS endpoint.

## Expected Result
All data in transit between applications and DynamoDB is encrypted using TLS. SSL/TLS endpoints are used for all API calls.

## Remediation

### Using AWS Console
Ensure that your applications use the SSL/TLS endpoints provided by DynamoDB. By default, the AWS SDKs and CLI use SSL/TLS. Verify your application code connects using HTTPS endpoints.

## Default Value
By default, DynamoDB encrypts data in transit using TLS. The AWS SDKs and CLI use SSL/TLS endpoints.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.10 Encrypt Sensitive Data in Transit | | x | x |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | | x | x |

## Profile
Level 1 | Manual
