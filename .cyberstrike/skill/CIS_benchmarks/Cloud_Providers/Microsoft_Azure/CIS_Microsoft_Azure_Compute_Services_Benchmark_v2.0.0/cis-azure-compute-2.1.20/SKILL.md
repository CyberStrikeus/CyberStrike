---
name: cis-azure-compute-2.1.20
description: "Ensure all traffic is routed through the virtual network"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, vnet-integration, outbound-traffic, route-all, network-security]
cis_id: "2.1.20"
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

This recommendation should be applied after integrating an App Service app with a virtual network.

## Rationale

Routing all outbound traffic through the virtual network enhances security.

## Impact

Additional configuration may be required to ensure that traffic is routed properly.

## Audit Procedure

### Using Azure Portal

1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Networking`.
4. Under `Outbound traffic configuration`, next to `Virtual network integration`, click the virtual network and subnet name.
5. Under `Application routing`, ensure that the box next to `Outbound internet traffic` is checked.
6. Repeat steps 1-5 for each app.

### Using Azure CLI

Run the following command to list apps:

```
az webapp list
```

For each app, run the following command to get the virtual network traffic routing setting:

```
az webapp show --resource-group <resource-group-name> --name <app-name> --query vnetRouteAllEnabled
```

Ensure that `true` is returned.

### Using Azure PowerShell

Not specifically documented for this control.

## Expected Result

The `vnetRouteAllEnabled` setting should return `true`.

## Remediation

### Using Azure Portal

1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Networking`.
4. Under `Outbound traffic configuration`, next to `Virtual network integration`, click the virtual network and subnet name.
5. Under `Application routing`, check the box next to `Outbound internet traffic`.
6. Click `Apply`.
7. Repeat steps 1-6 for each app requiring remediation.

### Using Azure CLI

For each app requiring remediation, run the following command to route all traffic through the virtual network:

```
az resource update --resource-group <resource-group-name> --name <app-name> --resource-type "Microsoft.Web/sites" --set properties.vnetRouteAllEnabled=true
```

### Using Azure PowerShell

Not specifically documented for this control.

## Default Value

For apps integrated with a virtual network, all traffic is routed through the virtual network by default.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/configure-vnet-integration-routing#configure-application-routing
2. https://learn.microsoft.com/en-us/cli/azure/webapp
3. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile

Level 1 | Automated
