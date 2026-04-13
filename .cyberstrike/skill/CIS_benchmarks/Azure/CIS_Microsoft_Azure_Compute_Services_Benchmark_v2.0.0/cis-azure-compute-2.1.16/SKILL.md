---
name: cis-azure-compute-2.1.16
description: "Ensure private endpoints are used to access App Service apps"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, private-endpoint, private-link, network-security, vnet]
cis_id: "2.1.16"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure private endpoints are used to access App Service apps

## Description
Use private endpoints to allow clients and services to securely access data located over a network via an encrypted Private Link. To do this, the private endpoint uses an IP address from the VNet for each service. Network traffic between disparate services securely traverses encrypted over the VNet. This VNet can also link addressing space, extending your network and accessing resources on it. Similarly, it can be a tunnel through public networks to connect remote infrastructures together. This creates further security through segmenting network traffic and preventing outside sources from accessing it.

## Rationale
Securing traffic between services through encryption protects the data from easy interception and reading.

## Impact
If an Azure Virtual Network is not implemented correctly, this may result in the loss of critical network traffic.

Private endpoints are charged per hour of use. Refer to https://azure.microsoft.com/en-us/pricing/details/private-link/ and https://azure.microsoft.com/en-us/pricing/calculator/ to estimate potential costs.

## Audit Procedure

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Networking`.
4. Under `Inbound traffic configuration`, click the link next to `Private endpoints`.
5. Ensure that at least one private endpoint is listed with a `Connection state` of `Approved`.
6. Repeat steps 1-5 for each app.

### Using Azure CLI
Run the following command to list apps IDs:
```
az webapp list --query [*].id
```

Run the following command to list private link service IDs and connection states:
```
az network private-endpoint list --query [*].privateLinkServiceConnections[*].[privateLinkServiceId,privateLinkServiceConnectionState.status]
```

Ensure that a private endpoint exists for each app with a connection state of `Approved`.

### Using Azure PowerShell
Not specifically documented for this control.

## Expected Result
At least one private endpoint should exist for each app with a connection state of `Approved`.

## Remediation

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Networking`.
4. Under `Inbound traffic configuration`, click the link next to `Private endpoints`.
5. Click `+ Add`.
6. From the drop-down menu, select `Express` or `Advanced`.
7. If selecting `Express`:
   1. Provide a `Name`, and select a `Subscription`, `Virtual network`, and `Subnet`.
   2. Click `OK`.
8. If selecting `Advanced`:
   1. Select a `Subscription` and `Resource group`, provide an instance `Name` and `Network Interface Name`, and select a `Region`.
   2. Click `Next : Resource >`.
   3. Select a `Target sub-resource`.
   4. Click `Next : Virtual Network >`.
   5. Select a `Virtual network` and a `Subnet`.
   6. Click `Next : DNS >`.
   7. Optionally update the DNS configuration.
   8. Click `Next : Tags >`.
   9. Optionally configure tags.
   10. Click `Next : Review + create >`.
   11. Click `Create`.

### Using Azure CLI
For each app requiring remediation, run the following command to create a private endpoint:
```
az network private-endpoint create --resource-group <resource-group-name> --location <location> --name <private-endpoint-name> --vnet-name <virtual-network-name> --subnet <subnet-name> --private-connection-resource-id <fully-qualified-app-id> --connection-name <connection-name> --group-id sites
```

### Using Azure PowerShell
Not specifically documented for this control.

## Default Value
By default, private endpoints are not configured for apps.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/overview-private-endpoint
2. https://azure.microsoft.com/en-us/pricing/details/private-link/
3. https://learn.microsoft.com/en-us/cli/azure/webapp
4. https://learn.microsoft.com/en-us/cli/azure/network/private-endpoint

## Profile
Level 2 | Automated
