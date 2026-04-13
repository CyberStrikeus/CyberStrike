---
name: cis-gcp-foundations-6.1.1
description: "Ensure That a MySQL Instance Does Not Allow Anyone To Connect With Administrative Privileges"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, cloud-sql, mysql]
cis_id: "6.1.1"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.1.1 Ensure That a MySQL Instance Does Not Allow Anyone To Connect With Administrative Privileges (Manual)

## Profile Applicability

- Level 1

## Description

It is recommended to set a password for the administrative user (`root` by default) to prevent unauthorized access to the SQL database instances.

This recommendation is applicable only for MySQL Instances. PostgreSQL does not offer any setting for No Password from the cloud console.

## Rationale

At the time of MySQL Instance creation, not providing an administrative password allows anyone to connect to the SQL database instance with administrative privileges. The root password should be set to ensure only authorized users have these privileges.

## Impact

Connection strings for administrative clients need to be reconfigured to use a password.

## Audit

### From Google Cloud CLI

1. List All SQL database instances of type MySQL:

```
gcloud sql instances list --filter='DATABASE_VERSION:MYSQL*' --project <project_id> --format="(NAME,PRIMARY_ADDRESS)"
```

2. For every MySQL instance try to connect using the `PRIMARY_ADDRESS`, if available:

```
mysql -u root -h <mysql_instance_ip_address>
```

The command should return either an error message or a password prompt. Sample Error message:

```
ERROR 1045 (28000): Access denied for user 'root'@'<Instance_IP>' (using password: NO)
```

If a command produces the `mysql>` prompt, the MySQL instance allows anyone to connect with administrative privileges without needing a password.

Note: The `No Password` setting is exposed only at the time of MySQL instance creation. Once the instance is created, the Google Cloud Platform Console does not expose the set to confirm whether a password for an administrative user is set to a MySQL instance.

## Remediation

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Platform Console using https://console.cloud.google.com/sql/
2. Select the instance to open its Overview page.
3. Select `Access Control` > `Users`.
4. Click the `More actions icon` for the user to be updated.
5. Select `Change password`, specify a `New password`, and click `OK`.

### From Google Cloud CLI

1. Set a password to a MySql instance:

```
gcloud sql users set-password root --host=<host> --instance=<instance_name> --prompt-for-password
```

2. A prompt will appear, requiring the user to enter a password:

```
Instance Password:
```

3. With a successful password configured, the following message should be seen:

```
Updating Cloud SQL user...done.
```

## Default Value

From the Google Cloud Platform Console, the `Create Instance` workflow enforces the rule to enter the root password unless the option `No Password` is selected explicitly.

## References

1. https://cloud.google.com/sql/docs/mysql/create-manage-users
2. https://cloud.google.com/sql/docs/mysql/create-instance

## CIS Controls

| Controls Version | Control                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.7 Manage Default Accounts on Enterprise Assets and Software | x    | x    | x    |
| v7               | 4.2 Change Default Passwords                                  | x    | x    | x    |
