---
name: cis-azure-foundations-8.3.6
description: "Ensure that Private Endpoints are Used for Azure Key Vault"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, key-vault, private-endpoints, networking]
cis_id: "8.3.6"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.3.6 Ensure that Private Endpoints are Used for Azure Key Vault (Automated)

## Description

Ensure that Azure Key Vaults are configured with private endpoints, enabling secure access to Key Vault over a private link from within the virtual network and eliminating exposure to the public internet.

## Rationale

By default, Azure Key Vault is accessible over the public internet. While access is still protected by authentication and authorization, exposing Key Vault to the public internet increases the attack surface and risk of data exfiltration. Private endpoints provide a private IP address within the virtual network for Key Vault, ensuring all traffic between the virtual network and Key Vault traverses the Microsoft backbone network. This eliminates exposure to the public internet and provides network-level isolation.

## Impact

Configuring private endpoints requires additional networking setup including virtual network configuration, private DNS zones, and potentially changes to existing network architecture. Applications accessing Key Vault must be within the virtual network or connected via VPN/ExpressRoute. External access from outside the network will be blocked unless also allowed via firewall rules. This may require changes to CI/CD pipelines and developer workflows.

## Audit Procedure

**From Azure Portal:**

1. Go to `Key vaults`.
2. Click the name of a Key Vault.
3. Under `Settings`, click `Networking`.
4. Click the `Private endpoint connections` tab.
5. Verify that at least one private endpoint connection exists with a status of `Approved`.

**From Azure CLI:**

```
az keyvault list --query "[].name" -o tsv
```

For each Key Vault:

```
az keyvault private-endpoint-connection list --vault-name {vaultName} --query "[].{Name:name, Status:properties.privateLinkServiceConnectionState.status}" -o table
```

Ensure at least one connection exists with status `Approved`.

**From PowerShell:**

```
Get-AzKeyVault | ForEach-Object {
    $connections = Get-AzPrivateEndpointConnection -PrivateLinkResourceId $_.ResourceId
    [PSCustomObject]@{
        VaultName = $_.VaultName
        PrivateEndpoints = $connections.Count
        Status = ($connections | Select-Object -ExpandProperty PrivateLinkServiceConnectionState).Status
    }
}
```

Ensure each vault has at least one private endpoint with `Approved` status.

## Expected Result

All Key Vaults should have at least one private endpoint connection with an `Approved` status.

## Remediation

**From Azure Portal:**

1. Go to `Key vaults`.
2. Click the name of a Key Vault.
3. Under `Settings`, click `Networking`.
4. Click the `Private endpoint connections` tab.
5. Click `+ Create a private endpoint`.
6. Configure the private endpoint with the appropriate virtual network, subnet, and private DNS zone.
7. Click `Review + Create`, then `Create`.

**From Azure CLI:**

```
az network private-endpoint create \
  --name {endpointName} \
  --resource-group {resourceGroup} \
  --vnet-name {vnetName} \
  --subnet {subnetName} \
  --private-connection-resource-id $(az keyvault show --name {vaultName} --query id -o tsv) \
  --group-id vault \
  --connection-name {connectionName}
```

**From PowerShell:**

```
$vault = Get-AzKeyVault -VaultName {vaultName}
$privateEndpointConnection = New-AzPrivateLinkServiceConnection -Name {connectionName} -PrivateLinkServiceId $vault.ResourceId -GroupId "vault"
New-AzPrivateEndpoint -Name {endpointName} -ResourceGroupName {resourceGroup} -Location {location} -Subnet $subnet -PrivateLinkServiceConnection $privateEndpointConnection
```

## Default Value

By default, Key Vaults are accessible over the public internet with no private endpoints configured.

## References

1. https://learn.microsoft.com/en-us/azure/key-vault/general/private-link-service
2. https://learn.microsoft.com/en-us/azure/key-vault/general/network-security
3. https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-overview
4. https://learn.microsoft.com/en-us/cli/azure/network/private-endpoint

## Profile

- Level 2
