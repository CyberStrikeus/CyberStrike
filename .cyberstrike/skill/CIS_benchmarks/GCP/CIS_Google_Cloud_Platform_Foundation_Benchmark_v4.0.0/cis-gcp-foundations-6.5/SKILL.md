---
name: cis-gcp-foundations-6.5
description: "Ensure That Cloud SQL Database Instances Do Not Implicitly Whitelist All Public IP Addresses"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, cloud-sql, networking]
cis_id: "6.5"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.5 Ensure That Cloud SQL Database Instances Do Not Implicitly Whitelist All Public IP Addresses (Automated)

## Profile Applicability

- Level 1

## Description

Database Server should accept connections only from trusted Network(s)/IP(s) and restrict access from public IP addresses.

## Rationale

To minimize attack surface on a Database server instance, only trusted/known and required IP(s) should be white-listed to connect to it.

An authorized network should not have IPs/networks configured to `0.0.0.0/0` which will allow access to the instance from anywhere in the world. Note that authorized networks apply only to instances with public IPs.

## Impact

The Cloud SQL database instance would not be available to public IP addresses.

## Audit

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Click the instance name to open its `Instance details` page.
3. Under the `Configuration` section click `Edit configurations`.
4. Under `Configuration options` expand the `Connectivity` section.
5. Ensure that no authorized network is configured to allow `0.0.0.0/0`.

### From Google Cloud CLI

1. Get detailed configuration for every Cloud SQL database instance.

```bash
gcloud sql instances list --format=json
```

Ensure that the section `settings: ipConfiguration : authorizedNetworks` does not have any parameter `value` containing `0.0.0.0/0`.

## Remediation

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Click the instance name to open its `Instance details` page.
3. Under the `Configuration` section click `Edit configurations`.
4. Under `Configuration options` expand the `Connectivity` section.
5. Click the `delete` icon for the authorized network `0.0.0.0/0`.
6. Click `Save` to update the instance.

### From Google Cloud CLI

Update the authorized network list by dropping off any addresses.

```bash
gcloud sql instances patch <INSTANCE_NAME> --authorized-networks=IP_ADDR1,IP_ADDR2...
```

## Prevention

To prevent new SQL instances from being configured to accept incoming connections from any IP addresses, set up a `Restrict Authorized Networks on Cloud SQL instances` Organization Policy at: https://console.cloud.google.com/iam-admin/orgpolicies/sql-restrictAuthorizedNetworks.

## Default Value

By default, authorized networks are not configured. Remote connection to Cloud SQL database instance is not possible unless authorized networks are configured.

## References

1. https://cloud.google.com/sql/docs/mysql/configure-ip
2. https://console.cloud.google.com/iam-admin/orgpolicies/sql-restrictAuthorizedNetworks
3. https://cloud.google.com/resource-manager/docs/organization-policy/org-policy-constraints
4. https://cloud.google.com/sql/docs/mysql/connection-org-policy

## Additional Information

There is no IPv6 configuration found for Google cloud SQL server services.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | X | X | X |
| v7 | 14.6 Protect Information through Access Control Lists | X | X | X |
