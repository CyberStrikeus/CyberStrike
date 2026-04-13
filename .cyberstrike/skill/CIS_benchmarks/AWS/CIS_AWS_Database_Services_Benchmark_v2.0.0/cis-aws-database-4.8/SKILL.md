---
name: cis-aws-database-4.8
description: "Ensure Database has delete protection enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, dynamodb, delete-protection, data-protection]
cis_id: "4.8"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-4.9]
prerequisites: []
severity_boost: {}
---

# 4.8 Ensure Database has delete protection enabled

## Description
Ensure that delete protection is enabled on database instances to prevent accidental or unauthorized deletion. This setting safeguards critical databases by requiring explicit disabling of delete protection before deletion, reducing the risk of data loss through human error or malicious activity.

## Rationale
Delete protection provides a safeguard against inadvertent or malicious deletion of critical databases. By requiring deliberate action to disable deletion protection, organizations mitigate risks associated with accidental data deletion and enhance the overall resilience of their data storage platform.

## Impact
Failure to enable delete protection increases the risk of irreversible data loss, potential service disruption, and operational downtime.

## Audit Procedure

### Using AWS CLI
To check whether delete protection is enabled on your DynamoDB tables, use the following command for each table:

```bash
aws dynamodb describe-table --table-name <your-table-name> \
  --query "{TableName: Table.TableName, DeleteProtectionEnabled: Table.DeletionProtectionEnabled}" \
  --output table
```

- Replace with your DynamoDB table name.
- This will return True if delete protection is enabled, False otherwise.

## Expected Result
DeleteProtectionEnabled returns `True` for all critical DynamoDB tables.

## Remediation

### Using AWS CLI
To enable delete protection on an existing DynamoDB table, use the following command:

```bash
aws dynamodb update-table \
    --table-name my-table \
    --deletion-protection-enabled
```

- Replace with your DynamoDB table name.
- Delete protection prevents the table from being deleted until the protection is disabled explicitly.

## Default Value
By default, delete protection is not enabled on DynamoDB tables.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4 Secure Configuration of Enterprise Assets and Software | | | |

## Profile
Level 1 | Manual
