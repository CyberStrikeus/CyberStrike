---
name: cis-gcp-foundations-6.2.4
description: "Ensure 'Log_statement' Database Flag for Cloud SQL PostgreSQL Instance Is Set Appropriately"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, cloud-sql, postgresql]
cis_id: "6.2.4"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.4 Ensure 'Log_statement' Database Flag for Cloud SQL PostgreSQL Instance Is Set Appropriately (Automated)

## Profile Applicability

- Level 2

## Description

The value of `log_statement` flag determined the SQL statements that are logged. Valid values are:

- `none`
- `ddl`
- `mod`
- `all`

The value `ddl` logs all data definition statements. The value `mod` logs all ddl statements, plus data-modifying statements.

The statements are logged after a basic parsing is done and statement type is determined, thus this does not logs statements with errors. When using extended query protocol, logging occurs after an Execute message is received and values of the Bind parameters are included.

A value of 'ddl' is recommended unless otherwise directed by your organization's logging policy.

## Rationale

Auditing helps in forensic analysis. If `log_statement` is not set to the correct value, too many statements may be logged leading to issues in finding the relevant information from the logs, or too few statements may be logged with relevant information missing from the logs. Setting log_statement to align with your organization's security and logging policies facilitates later auditing and review of database activities. This recommendation is applicable to PostgreSQL database instances.

## Impact

Turning on logging will increase the required storage over time. Mismanaged logs may cause your storage costs to increase. Setting custom flags via command line on certain instances will cause all omitted flags to be reset to defaults. This may cause you to lose custom flags and could result in unforeseen complications or instance restarts. Because of this, it is recommended you apply these flags changes during a period of low usage.

## Audit

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the instance to open its `Instance Overview` page
3. Go to `Configuration` card
4. Under `Database flags`, check the value of `log_statement` flag is set to appropriately.

### From Google Cloud CLI

1. Use the below command for every Cloud SQL PostgreSQL database instance to verify the value of `log_statement`

```
gcloud sql instances list --format=json | jq '.[].settings.databaseFlags[] | select(.name=="log_statement")|.value'
```

## Remediation

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the PostgreSQL instance for which you want to enable the database flag.
3. Click `Edit`.
4. Scroll down to the `Flags` section.
5. To set a flag that has not been set on the instance before, click `Add a Database Flag`, choose the flag `log_statement` from the drop-down menu and set appropriate value.
6. Click `Save` to save your changes.
7. Confirm your changes under `Flags` on the Overview page.

### From Google Cloud CLI

1. Configure the `log_statement` database flag for every Cloud SQL PosgreSQL database instance using the below command.

```
gcloud sql instances patch <INSTANCE_NAME> --database-flags log_statement=<ddl|mod|all|none>
```

Note: This command will overwrite all database flags previously set. To keep those and add new ones, include the values for all flags you want set on the instance; any flag not specifically included is set to its default value. For flags that do not take a value, specify the flag name followed by an equals sign ("=").

## Default Value

`none`

## References

1. https://cloud.google.com/sql/docs/postgres/flags
2. https://www.postgresql.org/docs/current/runtime-config-logging.html#GUC-LOG-STATEMENT

## Additional Information

WARNING: This patch modifies database flag values, which may require your instance to be restarted. Check the list of supported flags - https://cloud.google.com/sql/docs/postgres/flags - to see if your instance will be restarted when this patch is submitted.

Note: some database flag settings can affect instance availability or stability and remove the instance from the Cloud SQL SLA. For information about these flags, see Operational Guidelines.

Note: Configuring the above flag does not require restarting the Cloud SQL instance.

## CIS Controls

| Controls Version | Control                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs |      | x    | x    |
| v7               | 6.3 Enable Detailed Logging     |      | x    | x    |
