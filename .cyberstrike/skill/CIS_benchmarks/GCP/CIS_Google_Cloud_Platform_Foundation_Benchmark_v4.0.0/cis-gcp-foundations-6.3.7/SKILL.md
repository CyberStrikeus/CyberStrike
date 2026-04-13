---
name: cis-gcp-foundations-6.3.7
description: "Ensure 'contained database authentication' Database Flag for Cloud SQL SQL Server Instance Is Set to 'off'"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, cloud-sql, sql-server]
cis_id: "6.3.7"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3.7 Ensure 'contained database authentication' Database Flag for Cloud SQL SQL Server Instance Is Set to 'off' (Automated)

## Profile Applicability

- Level 1

## Description

A contained database includes all database settings and metadata required to define the database and has no configuration dependencies on the instance of the Database Engine where the database is installed. Users can connect to the database without authenticating a login at the Database Engine level. Isolating the database from the Database Engine makes it possible to easily move the database to another instance of SQL Server. Contained databases have some unique threats that should be understood and mitigated by SQL Server Database Engine administrators. Most of the threats are related to the USER WITH PASSWORD authentication process, which moves the authentication boundary from the Database Engine level to the database level, hence this is recommended not to enable this flag. This recommendation is applicable to SQL Server database instances.

## Rationale

When contained databases are enabled, database users with the ALTER ANY USER permission, such as members of the db_owner and db_accessadmin database roles, can grant access to databases and by doing so, grant access to the instance of SQL Server. This means that control over access to the server is no longer limited to members of the sysadmin and securityadmin fixed server role, and logins with the server level CONTROL SERVER and ALTER ANY LOGIN permission.

It is recommended to set `contained database authentication` database flag for Cloud SQL on the SQL Server instance to `off`.

## Impact

When `contained database authentication` is off (0) for the instance, contained databases cannot be created, or attached to the Database Engine. Setting custom flags via command line on certain instances will cause all omitted flags to be reset to defaults. This may cause you to lose custom flags and could result in unforeseen complications or instance restarts. Because of this, it is recommended you apply these flags changes during a period of low usage.

## Audit

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the instance to open its `Instance Overview` page.
3. Under the 'Database flags' section, if the database flag `contained database authentication` is present, then ensure that it is set to 'off'.

### From Google Cloud CLI

1. Ensure the below command returns `off` for any Cloud SQL for SQL Server database instance.

```bash
gcloud sql instances describe <INSTANCE_NAME> --format=json | jq '.settings.databaseFlags[] | select(.name=="contained database authentication")|.value'
```

## Remediation

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the SQL Server instance for which you want to enable to database flag.
3. Click `Edit`.
4. Scroll down to the `Flags` section.
5. If the flag `contained database authentication` is present and its value is set to 'on', then change it to 'off'.
6. Click `Save`.
7. Confirm the changes under `Flags` on the Overview page.

### From Google Cloud CLI

1. If any Cloud SQL for SQL Server instance has the database flag `contained database authentication` set to 'on', then change it to 'off' using the below command:

```bash
gcloud sql instances patch <INSTANCE_NAME> --database-flags "contained database authentication=off"
```

**Note:** This command will overwrite all database flags previously set. To keep those and add new ones, include the values for all flags you want set on the instance; any flag not specifically included is set to its default value. For flags that do not take a value, specify the flag name followed by an equals sign ("=").

## References

1. https://cloud.google.com/sql/docs/sqlserver/flags
2. https://docs.microsoft.com/en-us/sql/database-engine/configure-windows/contained-database-authentication-server-configuration-option?view=sql-server-ver15
3. https://docs.microsoft.com/en-us/sql/relational-databases/databases/security-best-practices-with-contained-databases?view=sql-server-ver15

## Additional Information

WARNING: This patch modifies database flag values, which may require your instance to be restarted. Check the list of supported flags - https://cloud.google.com/sql/docs/sqlserver/flags - to see if your instance will be restarted when this patch is submitted.

Note: Some database flag settings can affect instance availability or stability, and remove the instance from the Cloud SQL SLA. For information about these flags, see Operational Guidelines.

Note: Configuring the above flag does not restart the Cloud SQL instance.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | X | X | X |
| v7 | 14.6 Protect Information through Access Control Lists | X | X | X |
