---
name: cis-azure-database-2.7
description: "Ensure Azure Cache for Redis is Using a Private Link"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, redis, cache]
cis_id: "2.7"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.7 Ensure Azure Cache for Redis is Using a Private Link (Manual)

## Profile Applicability

- Level 2

## Description

Private links make resources available via a private endpoint to a network you select. Tunneling between subscriptions, resource groups, without the need for traditional network routing.

## Rationale

Networking communication should be segmented to prevent undesired interception.

## Impact

If improperly configured network communication between your Azure Cache for Redis and other resources may be interrupted. This is only concerning resources or services being offered to other Azure tenants.

## Audit Procedure

### Audit From Azure Portal

1. Go to `Azure Cache for Redis`.
2. Select the name of a cache.
3. Expand the `Administration` menu in the left column.
4. Select **Networking**.
5. View the private endpoints associated with the cache.

### Audit From PowerShell

1. Run the following code block with the identifying information for your environment.

```powershell
Get-AzPrivateEndpoint -ResourceGroupName <ResourceGroupName> |
Where-Object{
$_.PrivateLinkServiceConnections.PrivateLinkServiceId -eq
<AzureCacheforRedisName>
}
```

2. View the private endpoints associated with the cache.

### Audit From Azure Policy

- **Policy ID:** `960e650e-9ce3-4316-9590-8ee2c016ca2f` - **Name:** 'Azure Cache for Redis should use private link'

## Expected Result

At least one private endpoint should be associated with the Azure Cache for Redis instance.

## Remediation

### Remediate From Azure Portal

1. Go to `Azure Cache for Redis`.
2. Select the name of a cache.
3. In the left column expand **Administration**.
4. Select **Networking**.
5. In the top heading select `Private Endpoints`.
6. Select `+ Private Endpoint`.
7. Select your subscription and resource group then select `Next : Resource >`.
8. Select `Connect to an Azure resource in my directory.`
9. Enter your subscription id or select from the dropdown.
10. Under Resource type select Microsoft.Cache/redisEnterprise from the dropdown.
11. Select your resource and your sub-resource of `redisEnterprise`.
12. Select your desired virtual network.
13. Select your desired subnet.
14. Determine whether you want to dynamically or statically allocate an IP address.
15. Select your network application security group or select `+ Create` to create a new one, the select **Next**.
16. Determine if you want to create a dns entry in a private DNS zone or on your own DNS servers. If in a private DNS zone select the desired subscription and resource group. Select next.
17. Enter any tags necessary, then click next.
18. Review the settings and select **Create**.
19. After creation your Cache will be available in your network at the FQDN and IP address listed under **Settings** and **DNS configuration**.

### Remediate From PowerShell

```powershell
$resourceGroup     = "<resourcegroup>"
$virtualNetName    = "<virtualnetworkname>"
$subnetName        = "<subnetName>"
$redisName         = "<rediscachename>"
$privateEndpointName = "<privateendpointname>"
$dnsZoneName       = "<dnsfqdn>"
$dnsLinkName       = "<redisdnsname>"

# Get existing resources
$vnet = Get-AzVirtualNetwork -Name $virtualNetName -ResourceGroupName $resourceGroup
$subnet = Get-AzVirtualNetworkSubnetConfig -VirtualNetwork $virtualNetName -Name $subnetName
$redis = Get-AzRedisCache -Name $redisName -ResourceGroupName $resourceGroup

# Validate Redis resource ID for Private Endpoint connection
$redisResourceId = $redis.Id

# Link DNS Zone to Virtual Network
$link = New-AzPrivateDnsVirtualNetworkLink `
    -ZoneName $dnsZoneName `
    -ResourceGroupName $resourceGroup `
    -Name $dnsLinkName `
    -VirtualNetworkId $vnet.Id `
    -EnableRegistration false

# Create the Private Endpoint
$privateLinkConnection = New-AzPrivateLinkServiceConnection `
    -Name $privateEndpointName `
    -PrivateLinkServiceId $redisResourceId `
    -GroupId "redisCache"

$privateEndpoint = New-AzPrivateEndpoint `
    -Name $privateEndpointName `
    -ResourceGroupName $resourceGroup `
    -Location $location `
    -Subnet $subnet `
    -PrivateLinkServiceConnection $privateLinkConnection
```

## Default Value

Unless configured at resource creation, by default no private links are used in Azure Cache for Redis.

## References

1. [https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-private-link](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-private-link)
2. [https://learn.microsoft.com/en-us/security/benchmark/azure/baselines/azure-cache-for-redis-security-baseline](https://learn.microsoft.com/en-us/security/benchmark/azure/baselines/azure-cache-for-redis-security-baseline)
3. [https://learn.microsoft.com/en-us/cli/azure/network/private-endpoint?view=azure-cli-latest](https://learn.microsoft.com/en-us/cli/azure/network/private-endpoint?view=azure-cli-latest)
4. [https://learn.microsoft.com/en-us/powershell/module/az.network/get-azprivateendpoint?view=azps-14.6.0](https://learn.microsoft.com/en-us/powershell/module/az.network/get-azprivateendpoint?view=azps-14.6.0)
5. [https://learn.microsoft.com/en-us/azure/private-link/private-link-overview](https://learn.microsoft.com/en-us/azure/private-link/private-link-overview)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 12.2 Establish and Maintain a Secure Network Architecture | | X | X |
| v7 | 14.1 Segment the Network Based on Sensitivity | | X | X |
