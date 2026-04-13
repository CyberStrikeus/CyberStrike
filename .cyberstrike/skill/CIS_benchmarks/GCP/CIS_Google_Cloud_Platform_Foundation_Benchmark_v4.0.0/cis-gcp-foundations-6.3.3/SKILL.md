---
name: cis-gcp-foundations-6.3.3
description: "Ensure 'user Connections' Database Flag for Cloud SQL SQL Server Instance Is Set to a Non-limiting Value"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, cloud-sql, sql-server]
cis_id: "6.3.3"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3.3 Ensure 'user Connections' Database Flag for Cloud SQL SQL Server Instance Is Set to a Non-limiting Value (Automated)

## Profile Applicability

- Level 1

## Description

It is recommended to check the `user connections` for a Cloud SQL SQL Server instance to ensure that it is not artificially limiting connections.

## Rationale

The `user connections` option specifies the maximum number of simultaneous user connections that are allowed on an instance of SQL Server. The actual number of user connections allowed also depends on the version of SQL Server that you are using, and also the limits of your application or applications and hardware. SQL Server allows a maximum of 32,767 user connections. Because user connections is by default a self-configuring value, with SQL Server adjusting the maximum number of user connections automatically as needed, up to the maximum value allowable. For example, if only 10 users are logged in, 10 user connection objects are allocated. In most cases, you do not have to change the value for this option. The default is 0, which means that the maximum (32,767) user connections are allowed. However if there is a number defined here that limits connections, SQL Server will not allow anymore above this limit. If the connections are at the limit, any new requests will be dropped, potentially causing lost data or outages for those using the database.

## Impact

Setting custom flags via command line on certain instances will cause all omitted flags to be reset to defaults. This may cause you to lose custom flags and could result in unforeseen complications or instance restarts. Because of this, it is recommended you apply these flags changes during a period of low usage.

## Audit

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the instance to open its `Instance Overview` page.
3. Ensure the database flag `user connections` listed under the `Database flags` section is 0.

### From Google Cloud CLI

1. Ensure the below command returns a value of 0, for every Cloud SQL SQL Server database instance.

```bash
gcloud sql instances describe <INSTANCE_NAME> --format=json | jq '.settings.databaseFlags[] | select(.name=="user connections")|.value'
```

## Remediation

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the SQL Server instance for which you want to enable to database flag.
3. Click `Edit`.
4. Scroll down to the `Flags` section.
5. To set a flag that has not been set on the instance before, click `Add item`, choose the flag `user connections` from the drop-down menu, and set its value to your organization recommended value.
6. Click `Save` to save your changes.
7. Confirm your changes under `Flags` on the Overview page.

### From Google Cloud CLI

1. Configure the `user connections` database flag for every Cloud SQL SQL Server database instance using the below command.

```bash
gcloud sql instances patch <INSTANCE_NAME> --database-flags "user connections=[0-32,767]"
```

**Note:** This command will overwrite all database flags previously set. To keep those and add new ones, include the values for all flags you want set on the instance; any flag not specifically included is set to its default value. For flags that do not take a value, specify the flag name followed by an equals sign ("=").

## Default Value

By default `user connections` is set to '0' which does not limit the number of connections, giving the server free reign to facilitate a max of 32,767 connections.

## References

1. https://cloud.google.com/sql/docs/sqlserver/flags
2. https://docs.microsoft.com/en-us/sql/database-engine/configure-windows/configure-the-user-connections-server-configuration-option?view=sql-server-ver15
3. https://www.stigviewer.com/stig/ms_sql_server_2016_instance/2018-03-09/finding/V-79119

## Additional Information

WARNING: This patch modifies database flag values, which may require your instance to be restarted. Check the list of supported flags - https://cloud.google.com/sql/docs/sqlserver/flags - to see if your instance will be restarted when this patch is submitted.

Note: some database flag settings can affect instance availability or stability, and remove the instance from the Cloud SQL SLA. For information about these flags, see Operational Guidelines.

Note: Configuring the above flag restarts the Cloud SQL instance.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | X | X | X |
| v7 | 5.1 Establish Secure Configurations | X | X | X |
