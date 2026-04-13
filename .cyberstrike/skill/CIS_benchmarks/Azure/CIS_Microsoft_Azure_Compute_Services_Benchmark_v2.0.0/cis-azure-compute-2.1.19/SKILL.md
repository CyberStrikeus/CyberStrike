---
name: cis-azure-compute-2.1.19
description: "Ensure configuration is routed through the virtual network integration"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, vnet-integration, configuration-routing, content-share, image-pull]
cis_id: "2.1.19"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure configuration is routed through the virtual network integration

## Description
By default, configuration traffic for App Service apps goes directly over the public route. Container image pulls and content sharing can be routed through the virtual network integration.

This recommendation should be applied after integrating an App Service app with a virtual network.

## Rationale
Route container image pulls and content sharing through a virtual network integration for increased security and control.

## Impact
Additional configuration may be required to ensure that traffic is routed properly.

## Audit Procedure

### Using Azure CLI
Run the following command to list apps:
```
az webapp list
```

For each app, run the following command to get the container image share and content share settings:
```
az webapp show --resource-group <resource-group-name> --name <app-name> --query "[vnetImagePullEnabled,vnetContentShareEnabled]"
```

Ensure that `[true,true]` is returned.

### Using Azure Portal
Not specifically documented with portal-only steps for this control.

### Using Azure PowerShell
Not specifically documented for this control.

## Expected Result
Both `vnetImagePullEnabled` and `vnetContentShareEnabled` should return `true`.

## Remediation

### Using Azure CLI
For each app requiring remediation, run the following command to route container image pulls and content sharing through the virtual network integration:
```
az resource update --resource-group <resource-group-name> --name <app-name> --resource-type "Microsoft.Web/sites" --set properties.vnetImagePullEnabled=true --set properties.vnetContentShareEnabled=true
```

### Using Azure Portal
Not specifically documented with portal-only steps for this control.

### Using Azure PowerShell
Not specifically documented for this control.

## Default Value
By default, configuration traffic goes directly over the public route.

## Additional Information
In addition to configuring the routing for content sharing, you must also ensure that any firewall or Network Security Group configured on traffic from the subnet allow traffic to port 443 and 445.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/overview-vnet-integration#routes
2. https://learn.microsoft.com/en-us/azure/app-service/configure-vnet-integration-routing#configure-configuration-routing
3. https://learn.microsoft.com/en-us/cli/azure/webapp
4. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile
Level 2 | Automated
