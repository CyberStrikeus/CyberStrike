---
name: cis-gcp-foundations-6.3.5
description: "Ensure 'remote access' Database Flag for Cloud SQL SQL Server Instance Is Set to 'off'"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, cloud-sql, sql-server]
cis_id: "6.3.5"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3.5 Ensure 'remote access' Database Flag for Cloud SQL SQL Server Instance Is Set to 'off' (Automated)

## Profile Applicability

- Level 1

## Description

It is recommended to set `remote access` database flag for Cloud SQL SQL Server instance to `off`.

## Rationale

The `remote access` option controls the execution of stored procedures from local or remote servers on which instances of SQL Server are running. This default value for this option is 1. This grants permission to run local stored procedures from remote servers or remote stored procedures from the local server. To prevent local stored procedures from being run from a remote server or remote stored procedures from being run on the local server, this must be disabled. The Remote Access option controls the execution of local stored procedures on remote servers or remote stored procedures on local server. 'Remote access' functionality can be abused to launch a Denial-of-Service (DoS) attack on remote servers by off-loading query processing to a target, hence this should be disabled. This recommendation is applicable to SQL Server database instances.

## Impact

Setting custom flags via command line on certain instances will cause all omitted flags to be reset to defaults. This may cause you to lose custom flags and could result in unforeseen complications or instance restarts. Because of this, it is recommended you apply these flags changes during a period of low usage.

## Audit

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the instance to open its `Instance Overview` page.
3. Ensure the database flag `remote access` that has been set is listed under the `Database flags` section.

### From Google Cloud CLI

1. Ensure the below command returns `off` for every Cloud SQL SQL Server database instance:

```bash
gcloud sql instances describe <INSTANCE_NAME> --format=json | jq '.settings.databaseFlags[] | select(.name=="remote access")|.value'
```

In the output, database flags are listed under the `settings` as the collection `databaseFlags`.

## Remediation

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the SQL Server instance for which you want to enable to database flag.
3. Click `Edit`.
4. Scroll down to the `Flags` section.
5. To set a flag that has not been set on the instance before, click `Add item`, choose the flag `remote access` from the drop-down menu, and set its value to `off`.
6. Click `Save` to save your changes.
7. Confirm your changes under `Flags` on the Overview page.

### From Google Cloud CLI

1. Configure the `remote access` database flag for every Cloud SQL SQL Server database instance using the below command:

```bash
gcloud sql instances patch <INSTANCE_NAME> --database-flags "remote access"=off
```

**Note:** This command will overwrite all database flags previously set. To keep those and add new ones, include the values for all flags you want set on the instance; any flag not specifically included is set to its default value. For flags that do not take a value, specify the flag name followed by an equals sign ("=").

## Default Value

By default 'remote access' is 'on'.

## References

1. https://cloud.google.com/sql/docs/sqlserver/flags
2. https://docs.microsoft.com/en-us/sql/database-engine/configure-windows/configure-the-remote-access-server-configuration-option?view=sql-server-ver15
3. https://www.stigviewer.com/stig/ms_sql_server_2016_instance/2018-03-09/finding/V-79337

## Additional Information

WARNING: This patch modifies database flag values, which may require your instance to be restarted. Check the list of supported flags - https://cloud.google.com/sql/docs/sqlserver/flags - to see if your instance will be restarted when this patch is submitted.

Note: some database flag settings can affect instance availability or stability, and remove the instance from the Cloud SQL SLA. For information about these flags, see Operational Guidelines.

Note: Configuring the above flag restarts the Cloud SQL instance.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | X | X |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | X | X |
