---
name: cis-azure-compute-2.4.15
description: "Ensure all traffic is routed through the virtual network"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, functions, deployment-slots]
cis_id: "2.4.15"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure all traffic is routed through the virtual network

## Description

Enable `vnetRouteAllEnabled` to ensure all outbound traffic is routed through the integrated virtual network.

This recommendation should be applied after integrating a function app deployment slot with a virtual network.

## Rationale

Routing all outbound traffic through the virtual network enhances security.

## Impact

Additional configuration may be required to ensure that traffic is routed properly.

## Audit Procedure

### Using Azure Portal

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Networking`.
6. Under `Outbound traffic configuration`, next to `Virtual network integration`, click the virtual network and subnet name.
7. Under `Application routing`, ensure that the box next to `Outbound internet traffic` is checked.
8. Repeat steps 1-7 for each function app and deployment slot.

### Using Azure CLI

Run the following command to list function apps:

```bash
az functionapp list
```

For each function app, run the following command to list deployment slots:

```bash
az functionapp deployment slot list --resource-group <resource-group-name> --name <function-app-name>
```

For each deployment slot, ensure that `vnetRouteAllEnabled` is set to `true`.

## Expected Result

The `vnetRouteAllEnabled` property should be set to `true`.

## Remediation

### Using Azure Portal

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Networking`.
6. Under `Outbound traffic configuration`, next to `Virtual network integration`, click the virtual network and subnet name.
7. Under `Application routing`, check the box next to `Outbound internet traffic`.
8. Click `Apply`.
9. Repeat steps 1-8 for each function app and deployment slot requiring remediation.

### Using Azure CLI

For each deployment slot requiring remediation, run the following command to route all traffic through the virtual network:

```bash
az resource update --resource-group <resource-group-name> --name <function-app-name>/slots/<deployment-slot-name> --resource-type "Microsoft.Web/sites" --set properties.vnetRouteAllEnabled=true
```

## Default Value

For deployment slots integrated with a virtual network, all traffic is routed through the virtual network by default.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/configure-vnet-integration-routing#configure-application-routing
2. https://learn.microsoft.com/en-us/azure/azure-functions/functions-app-settings#vnetrouteallenabled
3. https://learn.microsoft.com/en-us/cli/azure/functionapp
4. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile

Level 1 | Automated
