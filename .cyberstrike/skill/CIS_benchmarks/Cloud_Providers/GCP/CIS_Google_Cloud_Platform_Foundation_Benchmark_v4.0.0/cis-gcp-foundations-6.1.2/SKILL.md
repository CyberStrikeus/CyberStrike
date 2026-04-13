---
name: cis-gcp-foundations-6.1.2
description: "Ensure 'Skip_show_database' Database Flag for Cloud SQL MySQL Instance Is Set to 'On'"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, cloud-sql, mysql]
cis_id: "6.1.2"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.1.2 Ensure 'Skip_show_database' Database Flag for Cloud SQL MySQL Instance Is Set to 'On' (Automated)

## Profile Applicability

- Level 1

## Description

It is recommended to set `skip_show_database` database flag for Cloud SQL Mysql instance to `on`.

## Rationale

`skip_show_database` database flag prevents people from using the SHOW DATABASES statement if they do not have the SHOW DATABASES privilege. This can improve security if you have concerns about users being able to see databases belonging to other users. Its effect depends on the SHOW DATABASES privilege: If the variable value is ON, the SHOW DATABASES statement is permitted only to users who have the SHOW DATABASES privilege, and the statement displays all database names. If the value is OFF, SHOW DATABASES is permitted to all users, but displays the names of only those databases for which the user has the SHOW DATABASES or other privilege. This recommendation is applicable to Mysql database instances.

## Audit

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the instance to open its `Instance Overview` page
3. Ensure the database flag `skip_show_database` that has been set is listed under the `Database flags` section.

### From Google Cloud CLI

1. List all Cloud SQL database Instances

```
gcloud sql instances list
```

2. Ensure the below command returns `on` for every Cloud SQL Mysql database instance

```
gcloud sql instances describe <INSTANCE_NAME> --format=json | jq '.settings.databaseFlags[] | select(.name=="skip_show_database")|.value'
```

## Remediation

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the Mysql instance for which you want to enable to database flag.
3. Click `Edit`.
4. Scroll down to the `Flags` section.
5. To set a flag that has not been set on the instance before, click `Add a Database Flag`, choose the flag `skip_show_database` from the drop-down menu, and set its value to `on`.
6. Click `Save` to save your changes.
7. Confirm your changes under `Flags` on the Overview page.

### From Google Cloud CLI

1. List all Cloud SQL database Instances

```
gcloud sql instances list
```

2. Configure the `skip_show_database` database flag for every Cloud SQL Mysql database instance using the below command.

```
gcloud sql instances patch <INSTANCE_NAME> --database-flags skip_show_database=on
```

Note:
This command will overwrite all database flags previously set. To keep those and add new ones, include the values for all flags you want set on the instance; any flag not specifically included is set to its default value. For flags that do not take a value, specify the flag name followed by an equals sign ("=").

## References

1. https://cloud.google.com/sql/docs/mysql/flags
2. https://dev.mysql.com/doc/refman/5.7/en/server-system-variables.html#sysvar_skip_show_database

## Additional Information

WARNING: This patch modifies database flag values, which may require your instance to be restarted. Check the list of supported flags - https://cloud.google.com/sql/docs/mysql/flags - to see if your instance will be restarted when this patch is submitted.

Note: some database flag settings can affect instance availability or stability, and remove the instance from the Cloud SQL SLA. For information about these flags, see Operational Guidelines."

Note: Configuring the above flag restarts the Cloud SQL instance.

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               |      | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists |      | x    | x    |
