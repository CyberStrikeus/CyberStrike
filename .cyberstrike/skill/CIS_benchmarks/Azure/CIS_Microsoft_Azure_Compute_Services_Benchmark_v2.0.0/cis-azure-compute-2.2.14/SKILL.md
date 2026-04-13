---
name: cis-azure-compute-2.2.14
description: "Ensure deployment slot is integrated with a virtual network"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, deployment-slots, vnet-integration, network-security, virtual-network]
cis_id: "2.2.14"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure deployment slot is integrated with a virtual network

## Description

Integrate App Service deployment slots with a virtual network to enable access to resources in or through a non-internet-routable virtual network.

## Rationale

Integrate App Service deployment slots with a virtual network for increased security and control.

## Impact

Additional configuration may be required to ensure that traffic is routed properly.

## Audit Procedure

### Using Azure Portal

1. Go to `App Services`.
2. Click the name of an app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Networking`.
6. Under `Outbound traffic configuration`, next to `Virtual network integration`, ensure that a virtual network and subnet name are displayed.
7. Repeat steps 1-6 for each app and deployment slot.

### Using Azure CLI

Run the following command to list apps:

```bash
az webapp list
```

For each app, run the following command to list deployment slots:

```bash
az webapp deployment slot list --resource-group <resource-group-name> --name <app-name>
```

For each deployment slot, ensure that `virtualNetworkSubnetId` is set to a virtual network subnet ID.

## Expected Result

The `virtualNetworkSubnetId` property should contain a valid virtual network subnet resource ID (not null or empty).

## Remediation

### Using Azure Portal

1. Go to `App Services`.
2. Click the name of an app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Networking`.
6. Under `Outbound traffic configuration`, next to `Virtual network integration`, click `Not configured`.
7. Click `Add virtual network integration`.
8. Select an existing App Service Plan connection, or select `New connection` and select a subscription, virtual network, and subnet.
9. Click `Connect`.
10. Repeat steps 1-9 for each app and deployment slot requiring remediation.

## Default Value

By default, virtual network integration is not configured.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/overview-vnet-integration
2. https://learn.microsoft.com/en-us/azure/app-service/configure-vnet-integration-enable
3. https://learn.microsoft.com/en-us/cli/azure/webapp
4. https://learn.microsoft.com/en-us/cli/azure/webapp/deployment/slot

## Profile

Level 1 | Automated
