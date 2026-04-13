---
name: cis-azure-compute-2.4.13
description: "Ensure deployment slot is integrated with a virtual network"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, functions, deployment-slots]
cis_id: "2.4.13"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure deployment slot is integrated with a virtual network

## Description

Integrate function app deployment slots with a virtual network to enable access to resources in or through a non-internet-routable virtual network.

This recommendation applies to function apps using the Premium or Dedicated (App Service) plans, which support deployment slots and virtual networking.

## Rationale

Integrate function app deployment slots with a virtual network for increased security and control.

## Impact

Additional configuration may be required to ensure that traffic is routed properly.

## Audit Procedure

### Using Azure Portal

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Networking`.
6. Under `Outbound traffic configuration`, next to `Virtual network integration`, ensure that a virtual network and subnet name are displayed.
7. Repeat steps 1-6 for each function app and deployment slot.

### Using Azure CLI

Run the following command to list function apps:

```bash
az functionapp list
```

For each function app, run the following command to list deployment slots:

```bash
az functionapp deployment slot list --resource-group <resource-group-name> --name <function-app-name>
```

For each deployment slot, ensure that `virtualNetworkSubnetId` is set to a virtual network subnet ID.

## Expected Result

The `virtualNetworkSubnetId` property should be set to a valid virtual network subnet ID.

## Remediation

### Using Azure Portal

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Networking`.
6. Under `Outbound traffic configuration`, next to `Virtual network integration`, click `Not configured`.
7. Click `Add virtual network integration`.
8. Select an existing App Service Plan connection, or select `New connection` and select a subscription, virtual network, and subnet.
9. Click `Connect`.
10. Repeat steps 1-9 for each function app and deployment slot requiring remediation.

## Default Value

By default, virtual network integration is not configured.

## References

1. https://learn.microsoft.com/en-us/azure/azure-functions/functions-networking-options
2. https://learn.microsoft.com/en-us/azure/app-service/overview-vnet-integration
3. https://learn.microsoft.com/en-us/azure/app-service/configure-vnet-integration-enable
4. https://learn.microsoft.com/en-us/cli/azure/functionapp

## Profile

Level 1 | Automated
