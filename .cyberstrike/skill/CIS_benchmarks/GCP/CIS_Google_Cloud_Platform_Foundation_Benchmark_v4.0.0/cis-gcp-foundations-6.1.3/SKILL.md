---
name: cis-gcp-foundations-6.1.3
description: "Ensure That the 'Local_infile' Database Flag for a Cloud SQL MySQL Instance Is Set to 'Off'"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, cloud-sql, mysql]
cis_id: "6.1.3"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.1.3 Ensure That the 'Local_infile' Database Flag for a Cloud SQL MySQL Instance Is Set to 'Off' (Automated)

## Profile Applicability

- Level 1

## Description

It is recommended to set the `local_infile` database flag for a Cloud SQL MySQL instance to `off`.

## Rationale

The `local_infile` flag controls the server-side LOCAL capability for LOAD DATA statements. Depending on the `local_infile` setting, the server refuses or permits local data loading by clients that have LOCAL enabled on the client side.

To explicitly cause the server to refuse LOAD DATA LOCAL statements (regardless of how client programs and libraries are configured at build time or runtime), start mysqld with local_infile disabled. local_infile can also be set at runtime.

Due to security issues associated with the `local_infile` flag, it is recommended to disable it. This recommendation is applicable to MySQL database instances.

## Impact

Disabling `local_infile` makes the server refuse local data loading by clients that have LOCAL enabled on the client side.

## Audit

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the instance to open its `Instance Overview` page
3. Ensure the database flag `local_infile` that has been set is listed under the `Database flags` section.

### From Google Cloud CLI

1. List all Cloud SQL database instances:

```
gcloud sql instances list
```

2. Ensure the below command returns `off` for every Cloud SQL MySQL database instance.

```
gcloud sql instances describe <INSTANCE_NAME> --format=json | jq '.settings.databaseFlags[] | select(.name=="local_infile")|.value'
```

## Remediation

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the MySQL instance where the database flag needs to be enabled.
3. Click `Edit`.
4. Scroll down to the `Flags` section.
5. To set a flag that has not been set on the instance before, click `Add a Database Flag`, choose the flag `local_infile` from the drop-down menu, and set its value to `off`.
6. Click `Save`.
7. Confirm the changes under `Flags` on the Overview page.

### From Google Cloud CLI

1. List all Cloud SQL database instances using the following command:

```
gcloud sql instances list
```

2. Configure the `local_infile` database flag for every Cloud SQL Mysql database instance using the below command:

```
gcloud sql instances patch <INSTANCE_NAME> --database-flags local_infile=off
```

Note:
This command will overwrite all database flags that were previously set. To keep those and add new ones, include the values for all flags to be set on the instance; any flag not specifically included is set to its default value. For flags that do not take a value, specify the flag name followed by an equals sign ("=").

## Default Value

By default `local_infile` is `on`.

## References

1. https://cloud.google.com/sql/docs/mysql/flags
2. https://dev.mysql.com/doc/refman/5.7/en/server-system-variables.html#sysvar_local_infile
3. https://dev.mysql.com/doc/refman/5.7/en/load-data-local.html

## Additional Information

WARNING: This patch modifies database flag values, which may require your instance to be restarted. Check the list of supported flags - https://cloud.google.com/sql/docs/mysql/flags - to see if your instance will be restarted when this patch is submitted.

Note: some database flag settings can affect instance availability or stability, and remove the instance from the Cloud SQL SLA. For information about these flags, see Operational Guidelines."

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure | | x | x |
| v7 | 0.0 Explicitly Not Mapped | | | |
