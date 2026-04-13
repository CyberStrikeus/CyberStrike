---
name: cis-azure-foundations-6.1.5
description: "Ensure that SKU Basic/Consumption is not used on artifacts that need to be monitored"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, logging, monitoring, sku, production-workloads]
cis_id: "6.1.5"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that SKU Basic/Consumption is not used on artifacts that need to be monitored (Particularly for Production Workloads)

## Description

The use of Basic or Free SKUs in Azure whilst cost effective have significant limitations in terms of what can be monitored and what support can be realized from Microsoft. Typically, these SKUs do not have a service SLA and Microsoft may refuse to provide support for them. Consequently Basic/Free SKUs should never be used for production workloads.

While an automated assessment procedure exists for this recommendation, the assessment status remains manual. Determining appropriate SKUs depends on the context and requirements of each organization and environment.

## Rationale

Typically, production workloads need to be monitored and should have an SLA with Microsoft, using Basic SKUs for any deployed product will mean that these capabilities do not exist.

The following resource types should use standard SKUs as a minimum:

- Public IP Addresses
- Network Load Balancers
- REDIS Cache
- SQL PaaS Databases
- VPN Gateways

## Impact

The impact of enforcing Standard SKUs is twofold:

1. There will be a cost increase.
2. The monitoring and service level agreements will be available and will support the production service.

All resources should be either tagged or in separate Management Groups/Subscriptions.

## Audit Procedure

### Using Azure Portal

1. Open `Azure Resource Graph Explorer`.
2. Click `New query`.
3. Paste the following into the query window:

```
Resources
| where sku contains 'Basic' or sku contains 'consumption'
| order by type
```

4. Click `Run query` then evaluate the results in the results window.
5. Ensure that no production artifacts are returned.

### Using Azure CLI

```bash
az graph query -q "Resources | where sku contains 'Basic' or sku contains 'consumption' | order by type"
```

Alternatively, to filter on a specific resource group:

```bash
az graph query -q "Resources | where resourceGroup == '<resourceGroupName>' | where sku contains 'Basic' or sku contains 'consumption' | order by type"
```

Ensure that no production artifacts are returned.

### Using PowerShell

```powershell
Get-AzResource | ?{ $_.Sku -EQ "Basic"}
```

Ensure that no production artifacts are returned.

## Expected Result

No production resources should be using Basic or Consumption SKUs. All production workloads should use Standard or higher SKUs.

## Remediation

Each resource has its own process for upgrading from basic to standard SKUs that should be followed if required.

- Public IP Address: https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/public-ip-upgrade
- Basic Load Balancer: https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-basic-upgrade-guidance
- Azure Cache for Redis: https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-how-to-scale
- Azure SQL Database: https://learn.microsoft.com/en-us/azure/azure-sql/database/scale-resources
- VPN Gateway: https://learn.microsoft.com/en-us/azure/vpn-gateway/gateway-sku-resize

## Default Value

Policy should enforce standard SKUs for the following artifacts:

- Public IP Addresses
- Network Load Balancers
- REDIS Cache
- SQL PaaS Databases
- VPN Gateways

## References

1. https://azure.microsoft.com/en-us/support/plans
2. https://azure.microsoft.com/en-us/support/plans/response/
3. https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/public-ip-upgrade
4. https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-basic-upgrade-guidance
5. https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-how-to-scale
6. https://learn.microsoft.com/en-us/azure/azure-sql/database/scale-resources
7. https://learn.microsoft.com/en-us/azure/vpn-gateway/gateway-sku-resize

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 2.2 Ensure Authorized Software is Currently Supported | x | x | x |
| v7 | 2.2 Ensure Software is Supported by Vendor | x | x | x |

## Profile

Level 2 | Manual
