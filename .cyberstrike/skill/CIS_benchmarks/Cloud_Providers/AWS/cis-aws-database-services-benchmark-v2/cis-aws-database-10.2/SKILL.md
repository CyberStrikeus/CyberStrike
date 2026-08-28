---
name: cis-aws-database-10.2
description: "Ensure Data at Rest is Encrypted"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, timestream, time-series, encryption, kms]
cis_id: "10.2"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-10.1, cis-aws-database-10.3, cis-aws-database-10.4]
prerequisites: []
severity_boost: {}
---

# 10.2 Ensure Data at Rest is Encrypted (Manual)

## Description

Enable encryption at rest for Amazon Timestream to protect your data while it is stored. Utilize AWS Key Management Service (KMS) to manage and control the encryption keys used for data encryption. Configure Timestream to encrypt your data using AWS-managed keys or customer-managed keys.

## Rationale

This helps ensure that the data is kept secure and protected when at rest. The user must choose from two key options which then determine when the data is encrypted at rest.

## Impact

Encryption at rest ensures that Timestream data remains protected even if the underlying storage media is compromised.

## Audit Procedure

### Using AWS Console

1. Understand Encryption at Rest in Timestream:
   - Familiarize yourself with the concept of encryption at rest and its importance in securing your data in Timestream. Understand that encryption at rest ensures that your data remains protected even if the underlying storage media is compromised.
2. Create an AWS Key Management Service (KMS) Key:
   - Open the AWS Management Console and navigate to the AWS Key Management Service (KMS) service. Create a new KMS customer master key (CMK) or use an existing one to manage the encryption keys for Timestream. Follow the AWS documentation and best practices for creating and managing KMS keys.
3. Enable Encryption at Rest in Timestream:
   - Open the Amazon Timestream console. Select the Timestream database or table you want to enable encryption at rest. Click on the "Encryption" tab or section. Choose the option to enable encryption at rest. Select the KMS key that you created earlier to be used for encryption.
4. Verify Encryption at Rest:
   - Confirm that encryption at rest is enabled for the selected Timestream database or table. Review the encryption settings in the Timestream console to ensure the correct KMS key is associated.
5. Monitor and Audit Encryption at Rest:
   - Regularly monitor the encryption at rest status in the Timestream console. Leverage AWS CloudTrail and AWS CloudWatch to monitor and track encryption-related activities or events. Set up appropriate alerts and notifications to detect any issues or unauthorized changes to the encryption settings.
6. Test Data Access and Decryption:
   - Access the Timestream data that is encrypted at rest. Verify that you can retrieve and decrypt the data using the appropriate access controls and KMS key permissions. Perform thorough testing to ensure data access and decryption functions as expected.
7. Review and Update Encryption Configuration:
   - Regularly review your encryption configuration and settings for Timestream. Ensure that the appropriate KMS key is still associated with the Timestream resources. Update the encryption settings if necessary, such as rotating encryption keys or modifying key policies.

## Expected Result

Encryption at rest should be enabled for all Timestream databases and tables using either AWS-managed or customer-managed KMS keys.

## Remediation

### Using AWS Console

Follow the audit steps above to enable encryption at rest for your Amazon Timestream resources.

## Default Value

Amazon Timestream encrypts all data at rest by default using AWS-managed keys. Customer-managed KMS keys can be configured for additional control.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest        |      | x    | x    |
| v7               | 14.8 Encrypt Sensitive Information at Rest |      |      | x    |

## Profile

Level 1 | Manual
