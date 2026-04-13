---
name: cis-gcp-foundations-6.2.5
description: "Ensure That the 'Log_min_messages' Flag for a Cloud SQL PostgreSQL Instance Is Set at Minimum to 'Warning'"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, cloud-sql, postgresql]
cis_id: "6.2.5"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.5 Ensure That the 'Log_min_messages' Flag for a Cloud SQL PostgreSQL Instance Is Set at Minimum to 'Warning' (Automated)

## Profile Applicability

- Level 1

## Description

The `log_min_messages` flag defines the minimum message severity level that is considered as an error statement. Messages for error statements are logged with the SQL statement. Valid values include (from lowest to highest severity) `DEBUG5`, `DEBUG4`, `DEBUG3`, `DEBUG2`, `DEBUG1`, `INFO`, `NOTICE`, `WARNING`, `ERROR`, `LOG`, `FATAL`, and `PANIC`. Each severity level includes the subsequent levels mentioned above. ERROR is considered the best practice setting. Changes should only be made in accordance with the organization's logging policy.

## Rationale

Auditing helps in troubleshooting operational problems and also permits forensic analysis. If `log_min_messages` is not set to the correct value, messages may not be classified as error messages appropriately. Setting the threshold to 'Warning' will log messages for the most needed error messages.

This recommendation is applicable to PostgreSQL database instances.

## Impact

Setting the threshold too low will might result in increased log storage size and length, making it difficult to find actual errors. Higher severity levels may cause errors needed to troubleshoot to not be logged. An organization will need to decide their own threshold for logging `log_min_messages` flag.

Note: To effectively turn off logging failing statements, set this parameter to PANIC.

## Audit

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the instance to open its `Instance Overview` page.
3. Go to the `Configuration` card.
4. Under `Database flags`, check the value of `log_min_messages` flag is set to `warning` or higher (WARNING|ERROR|LOG|FATAL|PANIC).

### From Google Cloud CLI

1. Use the below command for every Cloud SQL PostgreSQL database instance to verify that the value of `log_min_messages` is set to `warning` or higher.

```
gcloud sql instances describe [INSTANCE_NAME] --format=json | jq '.settings.databaseFlags[] | select(.name=="log_min_messages")|.value'
```

## Remediation

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances
2. Select the PostgreSQL instance for which you want to enable the database flag.
3. Click `Edit`.
4. Scroll down to the `Flags` section.
5. To set a flag that has not been set on the instance before, click `Add a Database Flag`, choose the flag `log_min_messages` from the drop-down menu and set appropriate value.
6. Click `Save` to save the changes.
7. Confirm the changes under `Flags` on the Overview page.

### From Google Cloud CLI

1. Configure the `log_min_messages` database flag for every Cloud SQL PosgreSQL database instance using the below command.

```
gcloud sql instances patch <INSTANCE_NAME> --database-flags log_min_messages=<DEBUG5|DEBUG4|DEBUG3|DEBUG2|DEBUG1|INFO|NOTICE|WARNING|ERROR|LOG|FATAL|PANIC>
```

Note: This command will overwrite all database flags previously set. To keep those and add new ones, include the values for all flags you want set on the instance; any flag not specifically included is set to its default value. For flags that do not take a value, specify the flag name followed by an equals sign ("=").

## Default Value

By default `log_min_messages` is `ERROR`.

## References

1. https://cloud.google.com/sql/docs/postgres/flags
2. https://www.postgresql.org/docs/current/runtime-config-logging.html#GUC-LOG-MIN-MESSAGES

## Additional Information

WARNING: This patch modifies database flag values, which may require your instance to be restarted. Check the list of supported flags - https://cloud.google.com/sql/docs/postgres/flags - to see if your instance will be restarted when this patch is submitted.

Note: Some database flag settings can affect instance availability or stability and remove the instance from the Cloud SQL SLA. For information about these flags, see Operational Guidelines.

Note: Configuring the above flag does not require restarting the Cloud SQL instance.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 8.5 Collect Detailed Audit Logs | | x | x |
| v7 | 6.3 Enable Detailed Logging | | x | x |
