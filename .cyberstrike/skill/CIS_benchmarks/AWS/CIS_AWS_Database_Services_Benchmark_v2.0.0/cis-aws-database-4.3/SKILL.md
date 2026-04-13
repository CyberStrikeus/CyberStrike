---
name: cis-aws-database-4.3
description: "Ensure DynamoDB Encryption at Rest"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, dynamodb, encryption, kms, encryption-at-rest]
cis_id: "4.3"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-4.4]
prerequisites: []
severity_boost: {}
---

# 4.3 Ensure DynamoDB Encryption at Rest

## Description
Encryption at rest in Amazon DynamoDB enhances the security of your data by encrypting it using AWS Key Management Service (AWS KMS) keys. Here is how to enable encryption at rest while creating a DynamoDB table.

## Rationale
Once the user is in their AWS account, they should open the DynamoDB to create the table and enable encryption. A key would be required to be created to enable encryption. Only the authorized user would always have access to this key. Enabling encryption would keep the user's data private and stored securely, which would only allow them to access it with their key.

## Impact
Add an additional layer of security by preventing any unauthorized personnel from accessing the data since both IAM access to the data and access to the encryption key would be required.

## Audit Procedure

### Using AWS Console
1. Open DynamoDB Console
   - Sign in to the AWS Management Console and open the DynamoDB console at https://console.aws.amazon.com/dynamodb/.

2. Create DynamoDB Table
   - Click `Create table`. This will bring you to the `Create DynamoDB table` page.

3. Specify Table Details
   - Enter a `Table name` and `Primary key`.
   - The primary key consists of a partition key and, optionally, a sort key.
   - Fill in these details according to your requirements.

4. Enable Encryption
   - Under the `Settings` section, check the `Enable encryption at rest`.
   - By default, DynamoDB uses an AWS-owned CMK to encrypt your data.
   - To use an AWS-managed CMK or a customer-managed CMK instead, select `AWS-managed CMK` or `Customer-managed CMK` from the dropdown menu, then choose the desired CMK.

5. Create a Table
   - Click `Create`.
   - This will create your DynamoDB table with encryption at rest enabled.

**Note:**
1. The setting for encryption at rest applies to all DynamoDB data associated with the table, including primary key data and indexes.
2. If you need to apply encryption at rest to an existing table, you can modify the table settings. However, modifying settings on large tables could take time and impact performance during the transition.
3. Ensure you have the necessary permissions in AWS KMS when choosing an AWS-managed CMK or a customer-managed CMK.

## Expected Result
DynamoDB tables have encryption at rest enabled using AWS KMS keys (AWS-owned, AWS-managed, or customer-managed CMK).

## Remediation

### Using AWS Console
Follow the same steps as the audit procedure to enable encryption at rest for DynamoDB tables. For existing tables, modify the table settings to enable encryption.

## Default Value
By default, DynamoDB uses an AWS-owned CMK to encrypt data at rest. Encryption at rest is enabled by default for all DynamoDB tables.

## References
1. https://aws.amazon.com/products/databases/
2. https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#kms_keys

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | x | x |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | x |

## Profile
Level 1 | Manual
