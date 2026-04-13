---
name: cis-azure-compute-2.4.14
description: "Ensure configuration is routed through the virtual network integration"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, functions, deployment-slots]
cis_id: "2.4.14"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure configuration is routed through the virtual network integration

## Description
By default, configuration traffic for function app deployment slots goes directly over the public route. Container image pulls and content sharing can be routed through the virtual network integration.

This recommendation applies to function apps using the Premium or Dedicated (App Service) plans, which support deployment slots and virtual networking.

This recommendation should be applied after integrating a function app deployment slot with a virtual network.

## Rationale
Route container image pulls and content sharing through a virtual network integration for increased security and control.

## Impact
Additional configuration may be required to ensure that traffic is routed properly.

## Audit Procedure

### Using Azure CLI
Run the following command to list function apps:
```bash
az functionapp list
```

For each function app, run the following command to list deployment slots:
```bash
az functionapp deployment slot list --resource-group <resource-group-name> --name <function-app-name>
```

For each deployment slot, ensure that `vnetImagePullEnabled` and `vnetContentShareEnabled` are set to `true`.

## Expected Result
Both `vnetImagePullEnabled` and `vnetContentShareEnabled` should be set to `true`.

## Remediation

### Using Azure CLI
For each deployment slot requiring remediation, run the following command to route container image pulls and content sharing through the virtual network integration:
```bash
az resource update --resource-group <resource-group-name> --name <function-app-name>/slots/<deployment-slot-name> --resource-type "Microsoft.Web/sites" --set properties.vnetImagePullEnabled=true --set properties.vnetContentShareEnabled=true
```

## Default Value
By default, configuration traffic goes directly over the public route.

## Additional Information
In addition to configuring the routing for content sharing, you must also ensure that any firewall or Network Security Group configured on traffic from the subnet allow traffic to port 443 and 445.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/overview-vnet-integration#routes
2. https://learn.microsoft.com/en-us/azure/app-service/configure-vnet-integration-routing#configure-configuration-routing
3. https://learn.microsoft.com/en-us/cli/azure/functionapp
4. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile
Level 2 | Automated
