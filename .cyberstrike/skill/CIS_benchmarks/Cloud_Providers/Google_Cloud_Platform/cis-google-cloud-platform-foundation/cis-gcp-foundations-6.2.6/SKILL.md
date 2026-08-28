---
name: cis-gcp-foundations-6.2.6
description: "Ensure 'Log_min_error_statement' Database Flag for Cloud SQL PostgreSQL Instance Is Set to 'Error' or Stricter"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, cloud-sql, postgresql]
cis_id: "6.2.6"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.6 Ensure 'Log_min_error_statement' Database Flag for Cloud SQL PostgreSQL Instance Is Set to 'Error' or Stricter (Automated)

## Profile Applicability

- Level 1

## Description

The `log_min_error_statement` flag defines the minimum message severity level that are considered as an error statement. Messages for error statements are logged with the SQL statement. Valid values include (from lowest to highest severity) `DEBUG5`, `DEBUG4`, `DEBUG3`, `DEBUG2`, `DEBUG1`, `INFO`, `NOTICE`, `WARNING`, `ERROR`, `LOG`, `FATAL`, and `PANIC`. Each severity level includes the subsequent levels mentioned above. Ensure a value of `ERROR` or stricter is set.

## Rationale

Auditing helps in troubleshooting operational problems and also permits forensic analysis. If `log_min_error_statement` is not set to the correct value, messages may not be classified as error messages appropriately. Considering general log messages as error messages would make is difficult to find actual errors and considering only stricter severity levels as error messages may skip actual errors to log their SQL statements. The `log_min_error_statement` flag should be set to `ERROR` or stricter. This recommendation is applicable to PostgreSQL database instances.

## Impact

Turning on logging will increase the required storage over time. Mismanaged logs may cause your storage costs to increase. Setting custom flags via command line on certain instances will cause all omitted flags to be reset to defaults. This may cause you to lose custom flags and could result in unforeseen complications or instance restarts. Because of this, it is recommended you apply these flags changes during a period of low usage.

## Audit

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the instance to open its `Instance Overview` page
3. Go to `Configuration` card
4. Under `Database flags`, check the value of `log_min_error_statement` flag is configured as to `ERROR` or stricter.

### From Google Cloud CLI

1. Use the below command for every Cloud SQL PostgreSQL database instance to verify the value of `log_min_error_statement` is set to `ERROR` or stricter.

```
gcloud sql instances describe <INSTANCE_NAME> --format=json | jq '.[].settings.databaseFlags[] | select(.name=="log_min_error_statement")|.value'
```

In the output, database flags are listed under the `settings` as the collection `databaseFlags`.

## Remediation

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the PostgreSQL instance for which you want to enable the database flag.
3. Click `Edit`.
4. Scroll down to the `Flags` section.
5. To set a flag that has not been set on the instance before, click `Add item`, choose the flag `log_min_error_statement` from the drop-down menu and set appropriate value.
6. Click `Save` to save your changes.
7. Confirm your changes under `Flags` on the Overview page.

### From Google Cloud CLI

1. Configure the `log_min_error_statement` database flag for every Cloud SQL PosgreSQL database instance using the below command.

```
gcloud sql instances patch <INSTANCE_NAME> --database-flags log_min_error_statement=<DEBUG5|DEBUG4|DEBUG3|DEBUG2|DEBUG1|INFO|NOTICE|WARNING|ERROR>
```

Note: This command will overwrite all database flags previously set. To keep those and add new ones, include the values for all flags you want set on the instance; any flag not specifically included is set to its default value. For flags that do not take a value, specify the flag name followed by an equals sign ("=").

## Default Value

By default `log_min_error_statement` is `ERROR`.

## References

1. https://cloud.google.com/sql/docs/postgres/flags
2. https://www.postgresql.org/docs/current/runtime-config-logging.html#GUC-LOG-MIN-ERROR-STATEMENT

## Additional Information

WARNING: This patch modifies database flag values, which may require your instance to be restarted. Check the list of supported flags - https://cloud.google.com/sql/docs/postgres/flags - to see if your instance will be restarted when this patch is submitted.

Note: some database flag settings can affect instance availability or stability and remove the instance from the Cloud SQL SLA. For information about these flags, see Operational Guidelines.

Note: Configuring the above flag does not require restarting the Cloud SQL instance.

## CIS Controls

| Controls Version | Control                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs |      | x    | x    |
| v7               | 6.3 Enable Detailed Logging     |      | x    | x    |
