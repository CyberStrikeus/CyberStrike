---
name: cis-aws-database-3.13
description: "Ensure Database has IAM Auth is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, rds, iam, authentication, token-based]
cis_id: "3.13"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-3.7]
prerequisites: []
severity_boost: {}
---

# 3.13 Ensure Database has IAM Auth is Enabled (Manual)

## Description

RDS clusters should be configured to leverage AWS IAM authentication for database connections. This ensures that users authenticate using temporary IAM-based tokens rather than static long-lived passwords.

## Rationale

Enabling IAM authentication for RDS centralizes and strengthens access control by integrating database authentication with broader AWS IAM identity management. This approach eliminates the risks associated with hard-coded credentials, reduces administrative overhead for password rotation, and allows precise access management using IAM identities and policies.

## Impact

With the usage of IAM database authentication instead of static passwords, RDS clusters are protected against credential leakage and weak password practices, making unauthorized access significantly more difficult. This reduces the attack surface, supports audit and compliance, and ensures that database access is tightly aligned with enterprise identity governance and cloud security standards.

## Audit Procedure

### Using AWS CLI

1. List RDS clusters and check IAM authentication status:

```bash
aws rds describe-db-clusters \
  --query "DBClusters[*].{DBClusterIdentifier:DBClusterIdentifier,IAMDatabaseAuthenticationEnabled:IAMDatabaseAuthenticationEnabled}" \
  --output table
```

2. List database users enabled for IAM authentication (RDS MySQL):

- For MySQL, connect to the cluster and run below command to ensure that required database users exist for IAM token logins.

```sql
SELECT user, plugin FROM mysql.user WHERE plugin='AWSAuthenticationPlugin';
```

- For Postgres, connect to the cluster and run below command to verify that necessary users are granted the rds_iam role.

```sql
SELECT r.rolname
FROM pg_roles AS r
JOIN pg_auth_members AS m ON r.oid = m.member
JOIN pg_roles AS g ON m.roleid = g.oid
WHERE g.rolname = 'rds_iam';
```

The cluster must have IAM database authentication enabled and users intended for IAM authentication must exist in the database engine with appropriate privileges.

### Using AWS Console

1. Navigate to the Amazon RDS console.
2. Select the DB cluster.
3. Under the Configuration tab, verify that IAM DB Authentication is set to Enabled.

## Expected Result

All RDS clusters should have IAM Database Authentication enabled, and database users intended for IAM authentication should be properly configured within the database engine.

## Remediation

### Using AWS CLI

1. Enable IAM Database Authentication on the RDS Cluster

- Use the AWS CLI to enable IAM authentication for an existing RDS cluster:

```bash
aws rds modify-db-cluster \
  --db-cluster-identifier <your-cluster-name> \
  --enable-iam-database-authentication \
  --apply-immediately
```

2. Create Local Database Users Configured for IAM Authentication

- For RDS MySQL: Connect to the database and create or alter users as follows:

```sql
CREATE USER 'jane_doe' IDENTIFIED WITH AWSAuthenticationPlugin as 'RDS';
```

or

```sql
ALTER USER 'jane_doe' IDENTIFIED WITH AWSAuthenticationPlugin as 'RDS';
```

- For RDS PostgreSQL:

Grant the rds_iam role to eligible users:

```sql
GRANT rds_iam TO jane_doe;
```

3. Grant Necessary Privileges to the Database Users

- Assign required permissions and roles to the users within your DB engine via standard SQL GRANT commands.

4. Ensure IAM Users/Roles Have Required AWS Permissions

- The IAM principal that connects needs the following AWS permission in their policy:

```json
{
    "Version":"2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "rds-db:connect"
            ],
            "Resource": [
                "arn:aws:rds-db:region:account-id:dbuser:DbClusterResourceId/db-user-name"
            ]
        }
    ]
}
```

- region is the AWS Region for the DB cluster
- account-id is the AWS account number for the DB cluster.
- DbClusterResourceId is the identifier for the DB cluster. This identifier is unique to an AWS Region and never changes. To find a DB cluster resource ID in the AWS Management Console for Amazon RDS, choose the DB cluster to see its details. Then choose the Configuration tab. The Resource ID is shown in the Configuration section.

5. Test the Configuration

- Use the AWS CLI to generate an authentication token:

```bash
aws rds generate-db-auth-token \
  --hostname <cluster-endpoint> \
  --port 3306 \
  --region <region> \
  --username <db_user>
```

- Use the generated token to authenticate to the database, confirming successful login.

For mysql:

```bash
mysql --host= <cluster-endpoint> \
  --port=3306 \
  --ssl-mode=REQUIRED \
  --enable-cleartext-plugin \
  --user= <db_user_name> \
  --password= '<generated_db_auth_token>'
```

For postgres:

```bash
psql "host=<cluster-endpoint> port=5432 dbname=<database_name> user=<>db_user_name password='<generated_db_auth_token>' sslmode=require"
```

### Using AWS Console

1. Navigate to the Amazon RDS console.
2. Select the DB cluster.
3. Click Modify.
4. Under Database authentication, select IAM database authentication.
5. Click Continue and apply the changes.

## Default Value

IAM Database Authentication is disabled by default on RDS clusters.

## References

1. https://aws.amazon.com/products/databases/
2. https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 6.7 Centralize Access Control | | x | x |

## Profile

Level 2 | Manual
