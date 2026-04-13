---
name: cis-azure-storage-17.2.1
description: "Ensure Private Endpoints are used to access Storage Accounts"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, storage-accounts, networking, private-endpoints]
cis_id: "17.2.1"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 17.2.1 Ensure Private Endpoints are used to access Storage Accounts (Automated)

## Description

Use private endpoints for your Azure Storage accounts to allow clients and services to securely access data located over a network via an encrypted Private Link. To do this, the private endpoint uses an IP address from the VNet for each service. Network traffic between disparate services securely traverses encrypted over the VNet. This VNet can also link addressing space, extending your network and accessing resources on it. Similarly, it can be a tunnel through public networks to connect remote infrastructures together. This creates further security through segmenting network traffic and preventing outside sources from accessing it.

## Rationale

Securing traffic between services through encryption protects the data from easy interception and reading.

## Impact

A Private Endpoint costs approximately US$7.30 per month. If an Azure Virtual Network is not implemented correctly, this may result in the loss of critical network traffic.

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

### Audit from Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure. If referencing a printed copy, you can search Policy IDs from this URL: https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- Policy ID: `6edd7eda-6dd8-40f7-810d-67160c639cd9`
- Name: 'Storage accounts should use private link'

## Expected Result

Each Storage Account has at least one Private Endpoint connection with a `Connection state` of `Approved`. The Azure CLI command returns a non-empty Private Endpoint connection ID. The Azure Policy 'Storage accounts should use private link' shows compliant.

## Remediation

### Remediate from Azure Portal

1. Open the `Storage Accounts` blade
2. For each listed Storage Account, perform the following:
3. Under the `Security + networking` heading, click on `Networking`
4. Click on the `Private endpoint connections` tab at the top of the networking window
5. Click the `+ Private endpoint` button
6. In the `1 - Basics` tab/step:
   - `Enter a name` that will be easily recognizable as associated with the Storage Account (Note: The "Network Interface Name" will be automatically completed, but you can customize it if needed.)
   - Ensure that the `Region` matches the region of the Storage Account
   - Click `Next`
7. In the `2 - Resource` tab/step:
   - Select the `target sub-resource` based on what type of storage resource is being made available
   - Click `Next`
8. In the `3 - Virtual Network` tab/step:
   - Select the `Virtual network` that your Storage Account will be connecting to
   - Select the `Subnet` that your Storage Account will be connecting to
   - (Optional) Select other network settings as appropriate for your environment
   - Click `Next`
9. In the `4 - DNS` tab/step:
   - (Optional) Select other DNS settings as appropriate for your environment
   - Click `Next`
10. In the `5 - Tags` tab/step:
    - (Optional) Set any tags that are relevant to your organization
    - Click `Next`
11. In the `6 - Review + create` tab/step:
    - A validation attempt will be made and after a few moments it should indicate `Validation Passed` - if it does not pass, double-check your settings before beginning more in depth troubleshooting.
    - If validation has passed, click `Create` then wait for a few minutes for the scripted deployment to complete.

Repeat the above procedure for each Private Endpoint required within every Storage Account.

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

1. https://docs.microsoft.com/en-us/azure/storage/common/storage-private-endpoints
2. https://docs.microsoft.com/en-us/azure/virtual-network/virtual-networks-overview
3. https://docs.microsoft.com/en-us/azure/private-link/create-private-endpoint-portal
4. https://docs.microsoft.com/en-us/azure/private-link/create-private-endpoint-cli?tabs=dynamic-ip
5. https://docs.microsoft.com/en-us/azure/private-link/create-private-endpoint-powershell?tabs=dynamic-ip
6. https://docs.microsoft.com/en-us/azure/private-link/tutorial-private-endpoint-storage-portal
7. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security#ns-2-secure-cloud-native-services-with-network-controls

## Additional Information

A NAT gateway is the recommended solution for outbound internet access.

## Profile

Level 2 | Automated
