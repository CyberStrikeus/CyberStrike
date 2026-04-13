---
name: cis-gcp-foundations-6.3.6
description: "Ensure '3625 (trace flag)' Database Flag for all Cloud SQL SQL Server Instances Is Set to 'on'"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, cloud-sql, sql-server]
cis_id: "6.3.6"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3.6 Ensure '3625 (trace flag)' Database Flag for all Cloud SQL SQL Server Instances Is Set to 'on' (Automated)

## Profile Applicability

- Level 1

## Description

It is recommended to set `3625 (trace flag)` database flag for Cloud SQL SQL Server instance to `on`.

## Rationale

Microsoft SQL Trace Flags are frequently used to diagnose performance issues or to debug stored procedures or complex computer systems, but they may also be recommended by Microsoft Support to address behavior that is negatively impacting a specific workload. All documented trace flags and those recommended by Microsoft Support are fully supported in a production environment when used as directed. `3625(trace log)` Limits the amount of information returned to users who are not members of the sysadmin fixed server role, by masking the parameters of some error messages using '******'. Setting this in a Google Cloud flag for the instance allows for security through obscurity and prevents the disclosure of sensitive information, hence this is recommended to set this flag globally to on to prevent the flag having been left off, or changed by bad actors. This recommendation is applicable to SQL Server database instances.

## Impact

Changing flags on a database may cause it to be restarted. The best time to do this is at a time where there is low usage.

## Audit

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the instance to open its `Instance Overview` page.
3. Ensure the database flag `3625` that has been set is listed under the `Database flags` section.

### From Google Cloud CLI

1. Ensure the below command returns `on` for every Cloud SQL SQL Server database instance:

```bash
gcloud sql instances describe <INSTANCE_NAME> --format=json | jq '.settings.databaseFlags[] | select(.name=="3625")|.value'
```

## Remediation

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the SQL Server instance for which you want to enable to database flag.
3. Click `Edit`.
4. Scroll down to the `Flags` section.
5. To set a flag that has not been set on the instance before, click `Add item`, choose the flag `3625` from the drop-down menu, and set its value to `on`.
6. Click `Save` to save your changes.
7. Confirm your changes under `Flags` on the Overview page.

### From Google Cloud CLI

1. Configure the `3625` database flag for every Cloud SQL SQL Server database instance using the below command.

```bash
gcloud sql instances patch <INSTANCE_NAME> --database-flags "3625=on"
```

**Note:** This command will overwrite all database flags previously set. To keep those and add new ones, include the values for all flags you want set on the instance; any flag not specifically included is set to its default value. For flags that do not take a value, specify the flag name followed by an equals sign ("=").

## Default Value

MS SQL Server implementations by default have trace flags, including the '3625' flag, turned off, as they are used for logging purposes.

## References

1. https://cloud.google.com/sql/docs/sqlserver/flags
2. https://docs.microsoft.com/en-us/sql/t-sql/database-console-commands/dbcc-traceon-trace-flags-transact-sql?view=sql-server-ver15#trace-flags
3. https://github.com/ktaranov/sqlserver-kit/blob/master/SQL%20Server%20Trace%20Flag.md

## Additional Information

WARNING: This patch modifies database flag values, which may require your instance to be restarted. Check the list of supported flags - https://cloud.google.com/sql/docs/sqlserver/flags - to see if your instance will be restarted when this patch is submitted.

Note: some database flag settings can affect instance availability or stability, and remove the instance from the Cloud SQL SLA. For information about these flags, see Operational Guidelines.

Note: Configuring the above flag restarts the Cloud SQL instance.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | X | X | X |
| v7 | 5.1 Establish Secure Configurations | X | X | X |
