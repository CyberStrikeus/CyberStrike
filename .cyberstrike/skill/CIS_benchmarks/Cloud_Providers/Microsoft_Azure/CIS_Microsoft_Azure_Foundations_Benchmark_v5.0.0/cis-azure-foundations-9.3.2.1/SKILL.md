---
name: cis-azure-foundations-9.3.2.1
description: "Ensure Private Endpoints are used to access Storage Accounts"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, storage-accounts, private-endpoints, networking, private-link]
cis_id: "9.3.2.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Private Endpoints are used to access Storage Accounts

## Description

Use private endpoints for your Azure Storage accounts to allow clients and services to securely access data located over a network via an encrypted Private Link. To do this, the private endpoint uses an IP address from the VNet for each service. Network traffic between disparate services securely traverses encrypted over the VNet. This VNet can also link addressing space, extending your network and accessing resources on it. Similarly, it can be a tunnel through public networks to connect remote infrastructures together. This creates further security through segmenting network traffic and preventing outside sources from accessing it.

## Rationale

Securing traffic between services through encryption protects the data from easy interception and reading.

## Impact

If an Azure Virtual Network is not implemented correctly, this may result in the loss of critical network traffic. Private endpoints are charged per hour of use. Refer to https://azure.microsoft.com/en-us/pricing/details/private-link/ and https://azure.microsoft.com/en-us/pricing/calculator/ to estimate potential costs.

## Audit Procedure

### Audit from Azure Portal

1. Open the `Storage Accounts` blade.
2. For each listed Storage Account, perform the following check:
3. Under the `Security + networking` heading, click on `Networking`.
4. Click on the `Private endpoint connections` tab at the top of the networking window.
5. Ensure that for each VNet that the Storage Account must be accessed from, a unique Private Endpoint is deployed and the `Connection state` for each Private Endpoint is `Approved`.

Repeat the procedure for each Storage Account.

### Audit from PowerShell

```powershell
$storageAccount = Get-AzStorageAccount -ResourceGroup '<ResourceGroupName>' -Name '<storageaccountname>'

Get-AzPrivateEndpoint -ResourceGroup '<ResourceGroupName>'|Where-Object {$_.PrivateLinkServiceConnectionsText -match $storageAccount.id}
```

If the results of the second command returns information, the Storage Account is using a Private Endpoint and complies with this Benchmark, otherwise if the results of the second command are empty, the Storage Account generates a finding.

### Audit from Azure CLI

```bash
az storage account show --name '<storage account name>' --query "privateEndpointConnections[0].id"
```

If the above command returns data, the Storage Account complies with this Benchmark, otherwise if the results are empty, the Storage Account generates a finding.

## Expected Result

Each Storage Account should have at least one Private Endpoint connection with `Connection state` set to `Approved`.

## Remediation

### Remediate from Azure Portal

1. Open the `Storage Accounts` blade
2. For each listed Storage Account, perform the following:
3. Under the `Security + networking` heading, click on `Networking`
4. Click on the `Private endpoint connections` tab at the top of the networking window
5. Click the `+ Private endpoint` button
6. In the `1 - Basics` tab/step: Enter a name, ensure that the Region matches the region of the Storage Account, click `Next`
7. In the `2 - Resource` tab/step: Select the `target sub-resource` based on what type of storage resource is being made available, click `Next`
8. In the `3 - Virtual Network` tab/step: Select the Virtual network and Subnet, click `Next`
9. In the `4 - DNS` tab/step: Select other DNS settings as appropriate, click `Next`
10. In the `5 - Tags` tab/step: Set any tags as relevant, click `Next`
11. In the `6 - Review + create` tab/step: If validation has passed, click `Create`

### Remediate from PowerShell

```powershell
$storageAccount = Get-AzStorageAccount -ResourceGroupName '<ResourceGroupName>' -Name '<storageaccountname>'

$privateEndpointConnection = @{
    Name = 'connectionName'
    PrivateLinkServiceId = $storageAccount.Id
    GroupID = "blob|blob_secondary|file|file_secondary|table|table_secondary|queue|queue_secondary|web|web_secondary|dfs|dfs_secondary"
}

$privateLinkServiceConnection = New-AzPrivateLinkServiceConnection @privateEndpointConnection

$virtualNetDetails = Get-AzVirtualNetwork -ResourceGroupName '<ResourceGroupName>' -Name '<name>'

$privateEndpoint = @{
    ResourceGroupName = '<ResourceGroupName>'
    Name = '<PrivateEndpointName>'
    Location = '<location>'
    Subnet = $virtualNetDetails.Subnets[0]
    PrivateLinkServiceConnection = $privateLinkServiceConnection
}

New-AzPrivateEndpoint @privateEndpoint
```

### Remediate from Azure CLI

```bash
az network private-endpoint create --resource-group <ResourceGroupName> --location <location> --name <private endpoint name> --vnet-name <VNET Name> --subnet <subnet name> --private-connection-resource-id <storage account ID> --connection-name <private link service connection name> --group-id <blob|blob_secondary|file|file_secondary|table|table_secondary|queue|queue_secondary|web|web_secondary|dfs|dfs_secondary>
```

## Default Value

By default, Private Endpoints are not created for Storage Accounts.

## References

1. https://learn.microsoft.com/en-us/azure/storage/common/storage-private-endpoints
2. https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-overview
3. https://learn.microsoft.com/en-us/azure/private-link/create-private-endpoint-portal
4. https://learn.microsoft.com/en-us/azure/private-link/create-private-endpoint-cli
5. https://learn.microsoft.com/en-us/azure/private-link/create-private-endpoint-powershell
6. https://learn.microsoft.com/en-us/azure/private-link/tutorial-private-endpoint-storage-portal
7. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security#ns-2-secure-cloud-native-services-with-network-controls

## Profile

Level 2
