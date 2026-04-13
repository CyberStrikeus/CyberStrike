---
name: cis-gcp-foundations-6.2.8
description: "Ensure 'cloudsql.enable_pgaudit' Database Flag for each Cloud SQL PostgreSQL Instance Is Set to 'on' For Centralized Logging"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, cloud-sql, postgresql]
cis_id: "6.2.8"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.8 Ensure That 'cloudsql.enable_pgaudit' Database Flag for each Cloud Sql Postgresql Instance Is Set to 'on' For Centralized Logging (Automated)

## Profile Applicability

- Level 1

## Description

Ensure `cloudsql.enable_pgaudit` database flag for Cloud SQL PostgreSQL instance is set to `on` to allow for centralized logging.

## Rationale

As numerous other recommendations in this section consist of turning on flags for logging purposes, your organization will need a way to manage these logs. You may have a solution already in place. If you do not, consider installing and enabling the open source pgaudit extension within PostgreSQL and enabling its corresponding flag of `cloudsql.enable_pgaudit`. This flag and installing the extension enables database auditing in PostgreSQL through the open-source pgAudit extension. This extension provides detailed session and object logging to comply with government, financial, & ISO standards and provides auditing capabilities to mitigate threats by monitoring security events on the instance. Enabling the flag and settings later in this recommendation will send these logs to Google Logs Explorer so that you can access them in a central location. This recommendation is applicable only to PostgreSQL database instances.

## Impact

Enabling the pgAudit extension can lead to increased data storage requirements and to ensure durability of pgAudit log records in the event of unexpected storage issues, it is recommended to enable the `Enable automatic storage increases` setting on the instance. Enabling flags via the command line will also overwrite all existing flags, so you should apply all needed flags in the CLI command. Also flags may require a restart of the server to be implemented or will break existing functionality so update your servers at a time of low usage.

## Audit

### Determining if the pgAudit Flag is set to 'on'

#### From Google Cloud Console

1. Go to https://console.cloud.google.com/sql/instances.
2. Select the instance to open its `Overview` page.
3. Click `Edit`.
4. Scroll down and expand `Flags`.
5. Ensure that `cloudsql.enable_pgaudit` flag is set to `on`.

#### From Google Cloud CLI

Run the command by providing `<INSTANCE_NAME>`. Ensure the value of the flag is `on`.

```
gcloud sql instances describe <INSTANCE_NAME> --format="json" | jq '.settings|.| .databaseFlags[]|select(.name=="cloudsql.enable_pgaudit")|.value'
```

### Determine if the pgAudit extension is installed

1. Connect to the the server running PostgreSQL or through a SQL client of your choice.
2. Run the following command

```sql
SELECT *
FROM pg_extension;
```

3. If pgAudit is in this list. If so, it is installed.

### Determine if Data Access Audit logs are enabled for your project and have sufficient privileges

1. From the homepage open the hamburger menu in the top left.
2. Scroll down to `IAM & Admin` and hover over it.
3. In the menu that opens up, select `Audit Logs`
4. In the middle of the page, in the search box next to `filter` search for `Cloud Composer API`
5. Select it, and ensure that both 'Admin Read' and 'Data Read' are checked.

### Determine if logs are being sent to Logs Explorer

1. From the Google Console home page, open the hamburger menu in the top left.
2. In the menu that pops open, scroll down to Logs Explorer under Operations.
3. In the query box, paste the following and search

```
resource.type="cloudsql_database"
logName="projects/<your-project-name>/logs/cloudaudit.googleapis.com%2Fdata_access"
protoPayload.request.@type="type.googleapis.com/google.cloud.sql.audit.v1.PgAuditEntry"
```

4. If it returns any log sources, they are correctly setup.

## Remediation

### Initialize the pgAudit flag

#### From Google Cloud Console

1. Go to https://console.cloud.google.com/sql/instances.
2. Select the instance to open its `Overview` page.
3. Click `Edit`.
4. Scroll down and expand `Flags`.
5. To set a flag that has not been set on the instance before, click `Add item`.
6. Enter `cloudsql.enable_pgaudit` for the flag name and set the flag to `on`.
7. Click `Done`.
8. Click `Save` to update the configuration.
9. Confirm your changes under `Flags` on the `Overview` page.

#### From Google Cloud CLI

Run the below command by providing `<INSTANCE_NAME>` to enable `cloudsql.enable_pgaudit` flag.

```
gcloud sql instances patch <INSTANCE_NAME> --database-flags cloudsql.enable_pgaudit=on
```

Note: `RESTART` is required to get this configuration in effect.

### Creating the extension

1. Connect to the the server running PostgreSQL or through a SQL client of your choice.
2. Run the following command as a superuser.

```sql
CREATE EXTENSION pgaudit;
```

### Updating the previously created pgaudit.log flag for your Logging Needs

#### From Console

Note: there are multiple options here. This command will enable logging for all databases on a server. Please see the customizing database audit logging reference for more flag options.

1. Go to https://console.cloud.google.com/sql/instances.
2. Select the instance to open its `Overview` page.
3. Click `Edit`.
4. Scroll down and expand `Flags`.
5. To set a flag that has not been set on the instance before, click `Add item`.
6. Enter `pgaudit.log=all` for the flag name and set the flag to `on`.
7. Click `Done`.
8. Click `Save` to update the configuration.
9. Confirm your changes under `Flags` on the `Overview` page.

#### From Command Line

Run the command

```
gcloud sql instances patch <INSTANCE_NAME> --database-flags cloudsql.enable_pgaudit=on,pgaudit.log=all
```

Note: This command will overwrite all previously set database flags. To keep those and add new ones, include the values for all flags to be set on the instance; any flag not specifically included is set to its default value. For flags that do not take a value, specify the flag name followed by an equals sign ("=").

### Enabling Auditing for the Project

#### From Console

1. Go to https://console.cloud.google.com/iam-admin/audit.
2. In the middle of the page in the search box next to `filter`, search for `Cloud Composer API`.
3. Select `Cloud Composer API`.
4. Select both `Admin Read` and `Data Read` checkboxes.
5. Click `Save`.

## Default Value

By default `cloudsql.enable_pgaudit` is `off`.

## References

1. https://cloud.google.com/sql/docs/postgres/pg-audit
2. https://cloud.google.com/sql/docs/postgres/flags

## Additional Information

WARNING: This patch modifies database flag values, which may require your instance to be restarted. Check the list of supported flags - https://cloud.google.com/sql/docs/postgres/flags - to see if your instance will be restarted when this patch is submitted.

Note: Some database flag settings can affect instance availability or stability and remove the instance from the Cloud SQL SLA. For information about these flags, see Operational Guidelines.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 8.5 Collect Detailed Audit Logs | | x | x |
| v7 | 6.3 Enable Detailed Logging | | x | x |
