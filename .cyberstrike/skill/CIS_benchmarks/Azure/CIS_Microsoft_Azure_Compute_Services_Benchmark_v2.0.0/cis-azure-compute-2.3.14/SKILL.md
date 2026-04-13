---
name: cis-azure-compute-2.3.14
description: "Ensure function app is integrated with a virtual network"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, function-apps, vnet-integration, network-security, virtual-network]
cis_id: "2.3.14"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure function app is integrated with a virtual network

## Description
Integrate function apps with a virtual network to enable access to resources in or through a non-internet-routable virtual network.

This recommendation does not apply to function apps created on the consumption hosting plan, which does not support virtual networking.

## Rationale
Integrate function apps with a virtual network for increased security and control.

## Impact
Additional configuration may be required to ensure that traffic is routed properly.

## Audit Procedure

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Networking`.
4. Under `Outbound traffic configuration`, next to `Virtual network integration`, ensure that a virtual network and subnet name are displayed.
5. Repeat steps 1-4 for each function app.

### Using Azure CLI
Run the following command to list function apps:
```bash
az functionapp list
```

For each function app, run the following command to get the virtual network subnet ID:
```bash
az functionapp show --resource-group <resource-group-name> --name <function-app-name> --query "virtualNetworkSubnetId"
```

Ensure that a virtual network subnet ID is returned.

### Using Azure PowerShell
Run the following command to list function apps:
```powershell
Get-AzFunctionApp
```

Run the following command to get the function app in a resource group with a given name:
```powershell
$app = Get-AzFunctionApp -ResourceGroupName <resource-group-name> -Name <function-app-name>
```

Run the following command to get the virtual network subnet ID:
```powershell
$app.virtualNetworkSubnetId
```

Ensure that a virtual network subnet ID is returned. Repeat for each function app.

## Expected Result
A virtual network subnet ID should be returned (not null or empty).

## Remediation

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Networking`.
4. Under `Outbound traffic configuration`, next to `Virtual network integration`, click `Not configured`.
5. Click `Add virtual network integration`.
6. Select an existing App Service Plan connection, or select `New connection` and select a subscription, virtual network, and subnet.
7. Click `Connect`.
8. Repeat steps 1-7 for each function app requiring remediation.

### Using Azure CLI
For each function app requiring remediation, run the following command to integrate with a virtual network:
```bash
az functionapp vnet-integration add --resource-group <resource-group-name> --name <function-app-name> --vnet <virtual-network-name> --subnet <subnet-name>
```

### Using Azure PowerShell
For each function app requiring remediation, run the following commands to integrate with a virtual network:

Prepare parameters:
```powershell
$siteName = '<app-name>'
$vNetResourceGroupName = '<virtual-network-resource-group-name>'
$functionAppResourceGroupName = '<function-app-resource-group-name>'
$vNetName = '<virtual-network-name>'
$integrationSubnetName = '<subnet-name>'
$vNetSubscriptionId = '<subscription-guid>'
```

Check if the subnet is delegated to `Microsoft.Web/serverFarms`:
```powershell
$vnet = Get-AzVirtualNetwork -Name $vNetName -ResourceGroupName $vNetResourceGroupName
$subnet = Get-AzVirtualNetworkSubnetConfig -Name $integrationSubnetName -VirtualNetwork $vnet
Get-AzDelegation -Subnet $subnet
```

Add delegation:
```powershell
$subnet = Add-AzDelegation -Name "myDelegation" -ServiceName "Microsoft.Web/serverFarms" -Subnet $subnet
Set-AzVirtualNetwork -VirtualNetwork $vnet
```

Configure virtual network integration:
```powershell
$subnetResourceId = "/subscriptions/$vNetSubscriptionId/resourceGroups/$vNetResourceGroupName/providers/Microsoft.Network/virtualNetworks/$vNetName/subnets/$integrationSubnetName"
$functionApp = Get-AzResource -ResourceType Microsoft.Web/sites -ResourceGroupName $functionAppResourceGroupName -ResourceName $siteName
$functionApp.Properties.virtualNetworkSubnetId = $subnetResourceId
$functionApp.Properties.vnetRouteAllEnabled = 'true'
$functionApp | Set-AzResource -Force
```

## Default Value
By default, virtual network integration is not configured.

## References
1. https://learn.microsoft.com/en-us/azure/azure-functions/functions-networking-options
2. https://learn.microsoft.com/en-us/azure/app-service/overview-vnet-integration
3. https://learn.microsoft.com/en-us/azure/app-service/configure-vnet-integration-enable
4. https://learn.microsoft.com/en-us/cli/azure/functionapp
5. https://learn.microsoft.com/en-us/powershell/module/az.functions/get-azfunctionapp

## Profile
Level 1 | Automated
