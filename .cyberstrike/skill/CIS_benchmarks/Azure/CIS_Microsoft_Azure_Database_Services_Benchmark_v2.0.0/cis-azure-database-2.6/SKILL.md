---
name: cis-azure-database-2.6
description: "Ensure that 'Public Network Access' is 'Disabled'"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, redis, cache]
cis_id: "2.6"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.6 Ensure that 'Public Network Access' is 'Disabled' (Manual)

## Profile Applicability

- Level 2

## Description

Disabling public network access restricts the service from accessing public networks.

## Rationale

A secure network architecture requires carefully constructed network segmentation. Public Network Access tends to be overly permissive and introduces unintended vectors for threat activity.

## Impact

Disabling 'Public Network Access' forces the requirement of the use of Private Endpoints for network connectivity which will require some additional consideration from a network architecture perspective and will introduce cost based on the inbound/outbound data being processed by the Private Endpoint.

**IMPORTANT NOTE:** If Azure Cache for Redis has been deployed in a VNet, this recommendation cannot be implemented. See additional information below for more detail.

## Audit Procedure

### Audit From Azure Portal

**NOTE:** This procedure applies only to instances that are not using VNets.

1. Search for and open the `Azure Cache for Redis` service
2. For each instance, repeat the remaining steps
3. Click on the name of the instance
4. In the blade menu on the left, click on **Private Endpoint**
5. Review the button to the right of `+ Private Endpoint`

If the button is titled `enable public network access`, the configuration for that instance is currently disabled and compliant.

### Audit From Azure Policy

- **Policy ID:** `470baccb-7e51-4549-8b1a-3e5be069f663` - **Name:** 'Azure Cache for Redis should disable public network access'

## Expected Result

The button next to `+ Private Endpoint` should display `enable public network access`, indicating public network access is currently disabled.

## Remediation

### Remediate From Azure Portal

**NOTE:** A Private Endpoint must exist before the "Disable public network access" button allows the configuration change to be performed via Portal.

1. Search for and open the `Azure Cache for Redis` service
2. For each instance, repeat the remaining steps
3. Click on the name of the instance
4. In the blade menu on the left, click on **Private Endpoint**
5. Click the `Disable public network access` button.

## Default Value

By default Public Network Access is **Disabled** when creating an Azure Cache for Redis instance.

## References

1. [https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-network-security#ns-2-secure-cloud-services-with-network-controls](https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-network-security#ns-2-secure-cloud-services-with-network-controls)
2. [https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-network-isolation](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-network-isolation)
3. [https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-private-link#how-can-i-change-my-private-endpoint-to-be-disabled-or-enabled-from-public-network-access](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-private-link#how-can-i-change-my-private-endpoint-to-be-disabled-or-enabled-from-public-network-access)

## Additional Information

For Azure Cache for Redis instances deployed in classic VNets (Virtual Network injection), public network access cannot be disabled. In these cases, an equivalent control using restrictive Access Control Lists (ACLs) in Network Security Groups (NSGs) and/or Azure Firewall is recommended. If it is feasible, the Azure Cache for Redis instance can also be deleted and re-created with a new instance using Private Endpoints instead of VNets.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.4 Implement and Manage a Firewall on Servers | X | X | X |
| v7 | 9.4 Apply Host-based Firewalls or Port Filtering | X | X | X |
