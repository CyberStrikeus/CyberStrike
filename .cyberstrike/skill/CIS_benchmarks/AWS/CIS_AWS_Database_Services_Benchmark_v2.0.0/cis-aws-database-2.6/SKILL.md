---
name: cis-aws-database-2.6
description: "Ensure Passwords are Regularly Rotated"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, aurora, passwords, rotation, credentials, access-management]
cis_id: "2.6"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-2.4, cis-aws-database-2.7]
prerequisites: []
severity_boost: {}
---

# 2.6 Ensure Passwords are Regularly Rotated (Manual)

## Description

Regularly rotating your Aurora passwords is critical to access management, contributing to maintaining system security. The database password can be rotated in Amazon Aurora, but the access keys refer to the rotation of AWS IAM User access keys.

## Rationale

Updating your password is critical to access AWS resources. This also ensures that your account is being kept safe from a potential threat.

## Impact

Having the passwords updated frequently allows only the authorized individual to access the AWS resources.

## Audit Procedure

### Using AWS Console

1. **Sign in to AWS Management Console**
   - If you do not already have an AWS account, you will need to create one at https://aws.amazon.com.

2. **Navigate to Amazon RDS Dashboard**
   - Navigate to the RDS service once logged in to the AWS Management Console. You can find this under the `Database` category.

3. **Choose your Aurora DB instance**
   - In the RDS Dashboard, click on `Databases`, and then click on the name of your Aurora DB instance.

4. **Modify the instance**
   - Click `Modify`.
   - In the `Settings` section, enter a new password in the `Master password` and `Confirm password` fields.

5. **Apply the changes**
   - Scroll to the bottom and choose when to apply the changes. You can apply them immediately or schedule them for the next maintenance window.
   - Then, click `Continue` and `Modify DB Instance`.

**Note**: Changing the master password will reboot the DB instance if you apply the change immediately.

## Expected Result

The Aurora DB instance master password should be rotated on a regular schedule according to organizational password policies.

## Remediation

Follow the audit procedure steps above to rotate Aurora database passwords. Consider using AWS Secrets Manager for automated password rotation.

## Default Value

AWS does not enforce automatic password rotation for Aurora database master passwords by default.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.2 Use Unique Passwords - Use unique passwords for all enterprise assets. Best practice implementation includes, at a minimum, an 8-character password for accounts using MFA and a 14-character password for accounts not using MFA. | x | x | x |
| v7 | 4.4 Use Unique Passwords - Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system. | | x | x |

## Profile

Level 1 | Manual
