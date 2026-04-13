---
name: cis-azure-compute-2.1.18
description: "Ensure app is integrated with a virtual network"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, vnet-integration, virtual-network, network-security]
cis_id: "2.1.18"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure app is integrated with a virtual network

## Description
Integrate App Service apps with a virtual network to enable access to resources in or through a non-internet-routable virtual network.

## Rationale
Integrate App Service apps with a virtual network for increased security and control.

## Impact
Additional configuration may be required to ensure that traffic is routed properly.

## Audit Procedure

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Networking`.
4. Under `Outbound traffic configuration`, next to `Virtual network integration`, ensure that a virtual network and subnet name are displayed.
5. Repeat steps 1-4 for each app.

### Using Azure CLI
Run the following command to list apps:
```
az webapp list
```

For each app, run the following command to get the virtual network subnet ID:
```
az webapp show --resource-group <resource-group-name> --name <app-name> --query "virtualNetworkSubnetId"
```

Ensure that a virtual network subnet ID is returned.

### Using Azure PowerShell
Run the following command to list apps:
```
Get-AzWebApp
```

Run the following command to get the app in a resource group with a given name:
```
$app = Get-AzWebapp -ResourceGroupName <resource-group-name> -Name <app-name>
```

Run the following command to get the virtual network subnet ID:
```
$app.virtualNetworkSubnetId
```

Ensure that a virtual network subnet ID is returned. Repeat for each app.

## Expected Result
A virtual network subnet ID should be returned, indicating the app is integrated with a virtual network.

## Remediation

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Networking`.
4. Under `Outbound traffic configuration`, next to `Virtual network integration`, click `Not configured`.
5. Click `Add virtual network integration`.
6. Select an existing App Service Plan connection, or select `New connection` and select a subscription, virtual network, and subnet.
7. Click `Connect`.
8. Repeat steps 1-7 for each app requiring remediation.

### Using Azure CLI
For each app requiring remediation, run the following command to integrate with a virtual network:
```
az webapp vnet-integration add --resource-group <resource-group-name> --name <app-name> --vnet <virtual-network-name> --subnet <subnet-name>
```

### Using Azure PowerShell
For each app requiring remediation, run the following commands to integrate with a virtual network:

Prepare parameters:
```
$siteName = '<app-name>'
$vNetResourceGroupName = '<virtual-network-resource-group-name>'
$appResourceGroupName = '<app-resource-group-name>'
$vNetName = '<virtual-network-name>'
$integrationSubnetName = '<subnet-name>'
$vNetSubscriptionId = '<subscription-guid>'
```

Check if the subnet is delegated to `Microsoft.Web/serverFarms`:
```
$vnet = Get-AzVirtualNetwork -Name $vNetName -ResourceGroupName $vNetResourceGroupName
$subnet = Get-AzVirtualNetworkSubnetConfig -Name $integrationSubnetName -VirtualNetwork $vnet
Get-AzDelegation -Subnet $subnet
```

Add delegation:
```
$subnet = Add-AzDelegation -Name "myDelegation" -ServiceName "Microsoft.Web/serverFarms" -Subnet $subnet
Set-AzVirtualNetwork -VirtualNetwork $vnet
```

Configure virtual network integration:
```
$subnetResourceId = "/subscriptions/$vNetSubscriptionId/resourceGroups/$vNetResourceGroupName/providers/Microsoft.Network/virtualNetworks/$vNetName/subnets/$integrationSubnetName"
$app = Get-AzResource -ResourceType Microsoft.Web/sites -ResourceGroupName $appResourceGroupName -ResourceName $siteName
$app.Properties.virtualNetworkSubnetId = $subnetResourceId
$app.Properties.vnetRouteAllEnabled = 'true'
$app | Set-AzResource -Force
```

## Default Value
By default, virtual network integration is not configured.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/overview-vnet-integration
2. https://learn.microsoft.com/en-us/azure/app-service/configure-vnet-integration-enable
3. https://learn.microsoft.com/en-us/cli/azure/webapp
4. https://learn.microsoft.com/en-us/powershell/module/az.websites/get-azwebapp

## Profile
Level 1 | Automated
