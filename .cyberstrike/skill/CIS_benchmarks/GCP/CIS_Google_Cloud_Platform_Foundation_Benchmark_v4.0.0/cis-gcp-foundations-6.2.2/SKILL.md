---
name: cis-gcp-foundations-6.2.2
description: "Ensure 'Log_connections' Database Flag for Cloud SQL PostgreSQL Instance Is Set to 'On'"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, cloud-sql, postgresql]
cis_id: "6.2.2"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.2 Ensure That the 'Log_connections' Database Flag for Cloud SQL PostgreSQL Instance Is Set to 'On' (Automated)

## Profile Applicability

- Level 1

## Description

Enabling the `log_connections` setting causes each attempted connection to the server to be logged, along with successful completion of client authentication. This parameter cannot be changed after the session starts.

## Rationale

PostgreSQL does not log attempted connections by default. Enabling the `log_connections` setting will create log entries for each attempted connection as well as successful completion of client authentication which can be useful in troubleshooting issues and to determine any unusual connection attempts to the server. This recommendation is applicable to PostgreSQL database instances.

## Impact

Turning on logging will increase the required storage over time. Mismanaged logs may cause your storage costs to increase. Setting custom flags via command line on certain instances will cause all omitted flags to be reset to defaults. This may cause you to lose custom flags and could result in unforeseen complications or instance restarts. Because of this, it is recommended you apply these flags changes during a period of low usage.

## Audit

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the instance to open its `Instance Overview` page.
3. Go to the `Configuration` card.
4. Under `Database flags`, check the value of `log_connections` flag to determine if it is configured as expected.

### From Google Cloud CLI

1. Ensure the below command returns `on` for every Cloud SQL PostgreSQL database instance:

```
gcloud sql instances describe [INSTANCE_NAME] --format=json | jq '.settings.databaseFlags[] | select(.name=="log_connections")|.value'
```

In the output, database flags are listed under the `settings` as the collection `databaseFlags`.

## Remediation

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the PostgreSQL instance for which you want to enable the database flag.
3. Click `Edit`.
4. Scroll down to the `Flags` section.
5. To set a flag that has not been set on the instance before, click `Add a Database Flag`, choose the flag `log_connections` from the drop-down menu and set the value as `on`.
6. Click `Save`.
7. Confirm the changes under `Flags` on the Overview page.

### From Google Cloud CLI

1. Configure the `log_connections` database flag for every Cloud SQL PosgreSQL database instance using the below command.

```
gcloud sql instances patch <INSTANCE_NAME> --database-flags "log_connections"=on
```

Note:
This command will overwrite all previously set database flags. To keep those and add new ones, include the values for all flags to be set on the instance; any flag not specifically included is set to its default value. For flags that do not take a value, specify the flag name followed by an equals sign ("=").

## Default Value

By default `log_connections` is `off`.

## References

1. https://cloud.google.com/sql/docs/postgres/flags
2. https://www.postgresql.org/docs/current/runtime-config-logging.html#GUC-LOG-CONNECTIONS

## Additional Information

WARNING: This patch modifies database flag values, which may require your instance to be restarted. Check the list of supported flags - https://cloud.google.com/sql/docs/postgres/flags - to see if your instance will be restarted when this patch is submitted.

Note: some database flag settings can affect instance availability or stability and remove the instance from the Cloud SQL SLA. For information about these flags, see the Operational Guidelines.

Note: Configuring the above flag does not require restarting the Cloud SQL instance.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 8.5 Collect Detailed Audit Logs | | x | x |
| v7 | 6.3 Enable Detailed Logging | | x | x |
