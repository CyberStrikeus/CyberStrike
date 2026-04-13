---
name: cis-gcp-foundations-6.3.2
description: "Ensure 'cross db ownership chaining' Database Flag for Cloud SQL SQL Server Instance Is Set to 'off'"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, cloud-sql, sql-server]
cis_id: "6.3.2"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3.2 Ensure 'cross db ownership chaining' Database Flag for Cloud SQL SQL Server Instance Is Set to 'off' (Automated)

## Profile Applicability

- Level 1

## Description

It is recommended to set `cross db ownership chaining` database flag for Cloud SQL SQL Server instance to `off`.

This flag is deprecated for all SQL Server versions in CGP. Going forward, you can't set its value to on. However, if you have this flag enabled, we strongly recommend that you either remove the flag from your database or set it to off. For cross-database access, use the Microsoft tutorial for signing stored procedures with a certificate.

## Rationale

Use the `cross db ownership` for chaining option to configure cross-database ownership chaining for an instance of Microsoft SQL Server. This server option allows you to control cross-database ownership chaining at the database level or to allow cross-database ownership chaining for all databases. Enabling `cross db ownership` is not recommended unless all of the databases hosted by the instance of SQL Server must participate in cross-database ownership chaining and you are aware of the security implications of this setting. This recommendation is applicable to SQL Server database instances.

## Impact

Updating flags may cause the database to restart. This may cause it to unavailable for a short amount of time, so this is best done at a time of low usage. You should also determine if the tables in your databases reference another table without using credentials for that database, as turning off cross database ownership will break this relationship.

## Audit

NOTE: This flag is deprecated for all SQL Server versions. Going forward, you can't set its value to on. However, if you have this flag enabled it should be removed from your database or set to off.

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console.
2. Select the instance to open its `Instance Overview` page.
3. Ensure the database flag `cross db ownership chaining` that has been set is listed under the `Database flags` section.

### From Google Cloud CLI

1. Ensure the below command returns `off` for every Cloud SQL SQL Server database instance:

```bash
gcloud sql instances describe <INSTANCE_NAME> --format=json | jq '.settings.databaseFlags[] | select(.name=="cross db ownership chaining")|.value'
```

In the output, database flags are listed under the `settings` as the collection `databaseFlags`.

## Remediation

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the SQL Server instance for which you want to enable to database flag.
3. Click `Edit`.
4. Scroll down to the `Flags` section.
5. To set a flag that has not been set on the instance before, click `Add item`, choose the flag `cross db ownership chaining` from the drop-down menu, and set its value to `off`.
6. Click `Save`.
7. Confirm the changes under `Flags` on the Overview page.

### From Google Cloud CLI

1. Configure the `cross db ownership chaining` database flag for every Cloud SQL SQL Server database instance using the below command:

```bash
gcloud sql instances patch <INSTANCE_NAME> --database-flags "cross db ownership chaining"=off
```

**Note:** This command will overwrite all database flags previously set. To keep those and add new ones, include the values for all flags to be set on the instance; any flag not specifically included is set to its default value. For flags that do not take a value, specify the flag name followed by an equals sign ("=").

## Default Value

This flag is deprecated for all SQL Server versions. Going forward, you can't set its value to on.

## References

1. https://cloud.google.com/sql/docs/sqlserver/flags
2. https://docs.microsoft.com/en-us/sql/database-engine/configure-windows/cross-db-ownership-chaining-server-configuration-option?view=sql-server-ver15

## Additional Information

WARNING: This patch modifies database flag values, which may require your instance to be restarted. Check the list of supported flags - https://cloud.google.com/sql/docs/sqlserver/flags - to see if your instance will be restarted when this patch is submitted.

Note: Some database flag settings can affect instance availability or stability, and remove the instance from the Cloud SQL SLA. For information about these flags, see Operational Guidelines.

Note: Configuring the above flag does not restart the Cloud SQL instance.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | X | X | X |
| v7 | 14.6 Protect Information through Access Control Lists | X | X | X |
