---
name: cis-aws-database-2.7
description: "Ensure Least Privilege Access"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, aurora, least-privilege, iam, polp, access-control]
cis_id: "2.7"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-2.4, cis-aws-database-2.10]
prerequisites: []
severity_boost: {}
---

# 2.7 Ensure Least Privilege Access (Manual)

## Description

Use the principle of least privilege when granting access to your Amazon Aurora resources. This principle of least privilege (POLP) is a computer security concept where users are given the minimum access levels necessary to complete their job functions.

In Amazon Aurora, this can be implemented at various levels, including AWS IAM for managing AWS resources and within the database for managing database users and roles.

Here is a step-by-step guide for each:

## Rationale

POLP limits the user interaction on the database, and it only gives the database permission to complete the necessary or mandatory task. AWS IAM gives permission for what the entity can and cannot do. Incorporating both POLP and AWS IAM in a database gives limited permission to the user to complete the tasks.

## Impact

Users would need to create a IAM role to implement POLP into their database.

## Audit Procedure

### Implementing POLP with AWS IAM

#### Using AWS Console

1. **Sign in to AWS Management Console**
   - If you do not already have an AWS account, you will need to create one at https://aws.amazon.com.

2. **Navigate to IAM Dashboard**
   - Navigate to the IAM service once logged in to the AWS Management Console.
   - You can find this under the `Security, Identity, & Compliance` category.

3. **Create a new IAM role or user**
   - If creating a new IAM role or user, click `Roles` or `Users`.
   - Then `Create role` or `Create user`.

4. **Attach minimum necessary permissions**
   - When attaching policies, give only the permissions necessary to perform the intended tasks.
   - AWS provides many predefined policies designed following the POLP. You can create a custom policy with precise permissions if none suits your needs.

### Implementing POLP within Amazon Aurora

1. **Log into your Aurora Database**
   - Depending on your Aurora database engine, you can log in through the terminal using a MySQL or PostgreSQL client. You'll need your host endpoint, username, and password to log in.

2. **Create a new user**
   - You can create a new user with the CREATE USER command in SQL.

For example:

```sql
CREATE USER '<username>'@'<localhost>' IDENTIFIED BY 'password';
```

3. **Grant minimal necessary privileges**
   - After creating the user, you can grant privileges using the GRANT command. The privileges should be as limited as possible for the user to perform their necessary functions.

For example:

```sql
GRANT SELECT, INSERT ON <mydb.mytbl> TO '<username>'@'<localhost>';
```

4. **Regularly review permissions**
   - It is essential to regularly review and update permissions to make sure they adhere to the principle of least privilege. You can view a user's permissions with the SHOW GRANTS command; for example:

```sql
SHOW GRANTS FOR '<username>'@'<localhost>';
```

## Expected Result

- IAM roles and users should have only the minimum permissions necessary for their function.
- Database users should have only the specific privileges required for their tasks, not broad or administrative access.

## Remediation

This is important because it reduces and secures any possible threat that an unauthorized user can gain by hacking into the system.

Follow the audit procedure steps above to implement least privilege access at both the AWS IAM level and within the Aurora database.

## Default Value

By default, newly created IAM users have no permissions. Database master users created during Aurora cluster setup have full administrative privileges.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | x | x | x |

## Profile

Level 1 | Manual
