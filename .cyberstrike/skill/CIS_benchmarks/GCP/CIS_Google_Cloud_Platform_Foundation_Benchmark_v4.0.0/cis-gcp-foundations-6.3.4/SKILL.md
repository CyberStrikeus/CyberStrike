---
name: cis-gcp-foundations-6.3.4
description: "Ensure 'user options' Database Flag for Cloud SQL SQL Server Instance Is Not Configured"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, cloud-sql, sql-server]
cis_id: "6.3.4"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3.4 Ensure 'user options' Database Flag for Cloud SQL SQL Server Instance Is Not Configured (Automated)

## Profile Applicability

- Level 1

## Description

The `user options` option specifies global defaults for all users. A list of default query processing options is established for the duration of a user's work session. The user options option allows you to change the default values of the SET options (if the server's default settings are not appropriate).

A user can override these defaults by using the SET statement. You can configure user options dynamically for new logins. After you change the setting of user options, new login sessions use the new setting; current login sessions are not affected. This recommendation is applicable to SQL Server database instances.

## Rationale

It is recommended that, `user options` database flag for Cloud SQL SQL Server instance should not be configured.

A user can override these defaults set with `user options` by using the SET statement. Some of these features/options could adversely affect the security of the system if enabled.

## Impact

Setting custom flags via command line on certain instances will cause all omitted flags to be reset to defaults. This may cause you to lose custom flags and could result in unforeseen complications or instance restarts. Because of this, it is recommended you apply these flags changes during a period of low usage.

## Audit

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the instance to open its `Instance Overview` page.
3. Ensure the database flag `user options` that has been set is not listed under the `Database flags` section.

### From Google Cloud CLI

1. Ensure the below command returns empty result for every Cloud SQL SQL Server database instance:

```bash
gcloud sql instances describe <INSTANCE_NAME> --format=json | jq '.settings.databaseFlags[] | select(.name=="user options")|.value'
```

In the output, database flags are listed under the `settings` as the collection `databaseFlags`.

## Remediation

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the SQL Server instance for which you want to enable to database flag.
3. Click `Edit`.
4. Scroll down to the `Flags` section.
5. Click the X next `user options` flag shown.
6. Click `Save` to save your changes.
7. Confirm your changes under `Flags` on the Overview page.

### From Google Cloud CLI

1. List all Cloud SQL database Instances:

```bash
gcloud sql instances list
```

2. Clear the `user options` database flag for every Cloud SQL SQL Server database instance using either of the below commands.

Clearing all flags to their default value:

```bash
gcloud sql instances patch <INSTANCE_NAME> --clear-database-flags
```

OR

To clear only `user options` database flag, configure the database flag by overriding the `user options`. Exclude `user options` flag and its value, and keep all other flags you want to configure.

```bash
gcloud sql instances patch <INSTANCE_NAME> --database-flags [FLAG1=VALUE1,FLAG2=VALUE2]
```

**Note:** This command will overwrite all database flags previously set. To keep those and add new ones, include the values for all flags you want set on the instance; any flag not specifically included is set to its default value. For flags that do not take a value, specify the flag name followed by an equals sign ("=").

## Default Value

By default 'user options' is not configured.

## References

1. https://cloud.google.com/sql/docs/sqlserver/flags
2. https://docs.microsoft.com/en-us/sql/database-engine/configure-windows/configure-the-user-options-server-configuration-option?view=sql-server-ver15
3. https://www.stigviewer.com/stig/ms_sql_server_2016_instance/2018-03-09/finding/V-79335

## Additional Information

WARNING: This patch modifies database flag values, which may require your instance to be restarted. Check the list of supported flags - https://cloud.google.com/sql/docs/sqlserver/flags - to see if your instance will be restarted when this patch is submitted.

Note: some database flag settings can affect instance availability or stability, and remove the instance from the Cloud SQL SLA. For information about these flags, see Operational Guidelines.

Note: Configuring the above flag does not restart the Cloud SQL instance.

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.1 Establish and Maintain a Secure Configuration Process | X    | X    | X    |
| v7               | 5.1 Establish Secure Configurations                       | X    | X    | X    |
