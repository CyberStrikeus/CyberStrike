---
name: cis-azure-database-5.3
description: "Ensure 'Public Network Access' is 'Disabled' for Azure Database for MySQL"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, mysql, database]
cis_id: "5.3"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3 Ensure 'Public Network Access' is 'Disabled' for Azure Database for MySQL (Automated)

## Profile Applicability

- Level 2

## Description

Setting public networks to disabled prevents requests from the public internet.

## Rationale

Disabling public network access prevents Azure Database for MySQL servers from communicating with the public internet and requires the use of Private endpoints for granular network control and segmentation.

## Impact

Disabling 'Public Network Access' forces the requirement of the use of Private Endpoints for network connectivity which will require some additional consideration from a network architecture perspective and will introduce cost based on the inbound/outbound data being processed by the Private Endpoint.

## Audit

### Audit from Azure Portal

1. From `Azure Database for MySQL` select the database you wish to audit.
2. In the left column expand `> Settings`.
3. Select `Networking`.
4. Ensure that Public network access is `not selected`.

### Audit from PowerShell

1. Run the following command with the identifying details for your subscription.

```powershell
Get-AzMySqlFlexibleServer -name <servername> -ResourceGroupName <resourcegroupname> | Select-Object -property NetworkPublicNetworkAccess
```

2. Ensure that Public network access is `Disabled`.

### Audit From Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure.

If referencing a printed copy, you can search Policy IDs from this URL:
https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- **Policy ID:** `c9299215-ae47-4f50-9c54-8a392f68a052` - **Name:** 'Public network access should be disabled for MySQL flexible servers'

## Expected Result

Public network access should be `Disabled` for the Azure Database for MySQL server.

## Remediation

### Remediate from Azure Portal

1. From `Azure Database for MySQL` select the database you wish to audit.
2. In the left column expand `> Settings`.
3. Select `Networking`.
4. Uncheck the checkbox under `Public Access`.

## Default Value

Unless specified at resource creation, Azure Database for MySQL by default allows public network access, but authenticates requests.

## References

1. https://learn.microsoft.com/en-us/azure/mysql/flexible-server/how-to-networking-private-link-deny-public-access

## CIS Controls

| Controls Version | Control                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------ | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers   | X    | X    | X    |
| v7               | 9.4 Apply Host-based Firewalls or Port Filtering | X    | X    | X    |
