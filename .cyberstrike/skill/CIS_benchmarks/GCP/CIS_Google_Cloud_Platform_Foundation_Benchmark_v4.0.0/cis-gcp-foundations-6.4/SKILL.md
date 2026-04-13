---
name: cis-gcp-foundations-6.4
description: "Ensure That the Cloud SQL Database Instance Requires All Incoming Connections To Use SSL"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, cloud-sql, ssl, networking]
cis_id: "6.4"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.4 Ensure That the Cloud SQL Database Instance Requires All Incoming Connections To Use SSL (Automated)

## Profile Applicability

- Level 1

## Description

It is recommended to enforce all incoming connections to SQL database instance to use SSL.

## Rationale

SQL database connections if successfully trapped (MITM); can reveal sensitive data like credentials, database queries, query outputs etc. For security, it is recommended to always use SSL encryption when connecting to your instance. This recommendation is applicable for Postgresql, MySql generation 1, MySql generation 2 and SQL Server 2017 instances.

## Impact

After enforcing SSL requirement for connections, existing client will not be able to communicate with Cloud SQL database instance unless they use SSL encrypted connections to communicate to Cloud SQL database instance.

## Audit

### From Google Cloud Console

1. Go to https://console.cloud.google.com/sql/instances.
2. Click on an instance name to see its configuration overview.
3. In the left-side panel, select `Connections`.
4. In the `Security` section, ensure that `Allow only SSL connections` option is selected.

### From Google Cloud CLI

1. Get the detailed configuration for every SQL database instance using the following command:

```bash
gcloud sql instances list --format=json
```

Ensure that section `settings: ipConfiguration` has the parameter `sslMode` set to `ENCRYPTED_ONLY`.

## Remediation

### From Google Cloud Console

1. Go to https://console.cloud.google.com/sql/instances.
2. Click on an instance name to see its configuration overview.
3. In the left-side panel, select `Connections`.
4. In the `security` section, select SSL mode as `Allow only SSL connections`.
5. Under `Configure SSL server certificates` click `Create new certificate` and save the setting.

### From Google Cloud CLI

To enforce SSL encryption for an instance run the command:

```bash
gcloud sql instances patch INSTANCE_NAME --ssl-mode= ENCRYPTED_ONLY
```

**Note:** `RESTART` is required for type MySQL Generation 1 Instances (`backendType: FIRST_GEN`) to get this configuration in effect.

## Default Value

By default parameter `settings: ipConfiguration: sslMode` is not set which is equivalent to `sslMode:ALLOW_UNENCRYPTED_AND_ENCRYPTED`.

## References

1. https://cloud.google.com/sql/docs/postgres/configure-ssl-instance/

## Additional Information

By default `Settings: ipConfiguration` has no `authorizedNetworks` set/configured. In that case even if by default `sslMode` is not set, which is equivalent to `sslMode:ALLOW_UNENCRYPTED_AND_ENCRYPTED` there is no risk as instance cannot be accessed outside of the network unless `authorizedNetworks` are configured. However, If default for `sslMode` is not updated to `ENCRYPTED_ONLY` any `authorizedNetworks` created later on will not enforce SSL only connection.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.10 Encrypt Sensitive Data in Transit | | X | X |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | | X | X |
| v7 | 16.5 Encrypt Transmittal of Username and Authentication Credentials | | X | X |
