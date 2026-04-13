---
name: cis-azure-compute-2.3.16
description: "Ensure all traffic is routed through the virtual network"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, function-apps, vnet-route-all, outbound-traffic, network-security]
cis_id: "2.3.16"
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

This recommendation should be applied after integrating a function app with a virtual network.

## Rationale
Routing all outbound traffic through the virtual network enhances security.

## Impact
Additional configuration may be required to ensure that traffic is routed properly.

## Audit Procedure

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Networking`.
4. Under `Outbound traffic configuration`, next to `Virtual network integration`, click the virtual network and subnet name.
5. Under `Application routing`, ensure that the box next to `Outbound internet traffic` is checked.
6. Repeat steps 1-5 for each function app.

### Using Azure CLI
Run the following command to list function apps:
```bash
az functionapp list
```

For each function app, run the following command to get the virtual network traffic routing setting:
```bash
az functionapp show --resource-group <resource-group-name> --name <app-name> --query vnetRouteAllEnabled
```

Ensure that `true` is returned.

## Expected Result
The `vnetRouteAllEnabled` setting should return `true`.

## Remediation

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Networking`.
4. Under `Outbound traffic configuration`, next to `Virtual network integration`, click the virtual network and subnet name.
5. Under `Application routing`, check the box next to `Outbound internet traffic`.
6. Click `Apply`.
7. Repeat steps 1-6 for each function app requiring remediation.

### Using Azure CLI
For each function app requiring remediation, run the following command to route all traffic through the virtual network:
```bash
az resource update --resource-group <resource-group-name> --name <function-app-name> --resource-type "Microsoft.Web/sites" --set properties.vnetRouteAllEnabled=true
```

## Default Value
For function apps integrated with a virtual network, all traffic is routed through the virtual network by default.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/configure-vnet-integration-routing#configure-application-routing
2. https://learn.microsoft.com/en-us/azure/azure-functions/functions-app-settings#vnetrouteallenabled
3. https://learn.microsoft.com/en-us/cli/azure/functionapp
4. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile
Level 1 | Automated
