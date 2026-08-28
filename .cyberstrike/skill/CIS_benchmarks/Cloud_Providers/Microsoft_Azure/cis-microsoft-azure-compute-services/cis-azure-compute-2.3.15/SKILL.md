---
name: cis-azure-compute-2.3.15
description: "Ensure configuration is routed through the virtual network integration"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, function-apps, vnet-routing, configuration-routing, network-security]
cis_id: "2.3.15"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure configuration is routed through the virtual network integration

## Description

By default, configuration traffic for function apps goes directly over the public route. Container image pulls and content sharing can be routed through the virtual network integration.

This recommendation should be applied after integrating a function app with a virtual network.

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

For each function app, run the following command to get the container image share and content share settings:

```bash
az functionapp show --resource-group <resource-group-name> --name <function-app-name> --query "[vnetImagePullEnabled,vnetContentShareEnabled]"
```

Ensure that `[true,true]` is returned.

### Using Azure Portal

There is no specific Azure Portal audit procedure documented for this control. Use the Azure CLI method.

## Expected Result

Both `vnetImagePullEnabled` and `vnetContentShareEnabled` should return `true` (`[true,true]`).

## Remediation

### Using Azure CLI

For each function app requiring remediation, run the following command to route container image pulls and content sharing through the virtual network integration:

```bash
az resource update --resource-group <resource-group-name> --name <function-app-name> --resource-type "Microsoft.Web/sites" --set properties.vnetImagePullEnabled=true --set properties.vnetContentShareEnabled=true
```

### Using Azure Portal

There is no specific Azure Portal remediation procedure documented for this control. Use the Azure CLI method.

## Additional Information

In addition to configuring the routing for content sharing, you must also ensure that any firewall or Network Security Group configured on traffic from the subnet allow traffic to port 443 and 445.

## Default Value

By default, configuration traffic goes directly over the public route.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/overview-vnet-integration#routes
2. https://learn.microsoft.com/en-us/azure/app-service/configure-vnet-integration-routing#configure-configuration-routing
3. https://learn.microsoft.com/en-us/cli/azure/functionapp
4. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile

Level 2 | Automated
