---
name: cis-azure-foundations-2.1.11
description: "Ensure private endpoints are used to access Azure Databricks workspaces"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, databricks, analytics]
cis_id: "2.1.11"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-2.1.1, cis-azure-foundations-2.1.9, cis-azure-foundations-2.1.10]
prerequisites: []
severity_boost: {}
---

# Ensure private endpoints are used to access Azure Databricks workspaces

## Description

Use private endpoints for Azure Databricks workspaces to allow clients and services to securely access data located over a network via an encrypted Private Link. To do this, the private endpoint uses an IP address from the VNet for each service. Network traffic between disparate services securely traverses encrypted over the VNet. This VNet can also link addressing space, extending your network and accessing resources on it. Similarly, it can be a tunnel through public networks to connect remote infrastructures together. This creates further security through segmenting network traffic and preventing outside sources from accessing it.

## Rationale

Using private endpoints for Azure Databricks workspaces ensures that all communication between clients, services, and data sources occurs over a secure, private IP space within an Azure Virtual Network (VNet). This approach eliminates exposure to the public internet, significantly reducing the attack surface and aligning with Zero Trust principles. Additionally, integrating Databricks with a VNet enables network segmentation, fine-grained access control, and hybrid connectivity through VNet peering or VPN/ExpressRoute.

## Impact

If an Azure Virtual Network is not implemented correctly, this may result in the loss of critical network traffic.

Private endpoints are charged per hour of use. Refer to https://azure.microsoft.com/en-us/pricing/details/private-link/ and https://azure.microsoft.com/en-us/pricing/calculator/ to estimate potential costs.

Before a private endpoint can be configured, Azure Databricks workspaces:

- Must be deployed in a customer-managed virtual network (VNet injection) -- refer to the recommendation `Ensure that Azure Databricks is deployed in a customer-managed virtual network (VNet)`.
- Must have secure cluster connectivity enabled -- refer to the recommendation `Ensure 'Enable No Public IP' is set to 'Yes'`.
- Must be on the Premium pricing tier.

Ensure the requirements and concepts are considered carefully before applying this recommendation. Refer to https://learn.microsoft.com/en-us/azure/databricks/security/network/classic/private-link for more information.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Azure Databricks`.
2. Click the name of a workspace.
3. Under `Settings`, click `Networking`.
4. Click `Private endpoint connections`.
5. Ensure a private endpoint connection exists with a connection state of `Approved`.
6. Repeat steps 1-5 for each workspace.

### Audit from Azure CLI

Run the following command to list workspaces:

```bash
az databricks workspace list
```

For each workspace, run the following command to get the `privateEndpointConnections` configuration:

```bash
az databricks workspace show --resource-group <resource-group> --name <workspace> --query privateEndpointConnections
```

Ensure a private endpoint connection is returned with a `privateLinkServiceConnectionState` status of `Approved`.

### Audit from PowerShell

Run the following command to list workspaces:

```powershell
Get-AzDatabricksWorkspace
```

Run the following command to get the workspace in a resource group with a given name:

```powershell
$workspace = Get-AzDatabricksWorkspace -ResourceGroupName <resource-group> -Name <workspace>
```

Run the following command to get the `PrivateEndpointConnection` configuration:

```powershell
$workspace.PrivateEndpointConnection | Select-Object -Property Id,PrivateLinkServiceConnectionStateStatus
```

Ensure a private endpoint connection is returned with a `PrivateLinkServiceConnectionStateStatus` of `Approved`. Repeat for each workspace.

### Audit from Azure Policy

- **Policy ID:** `258823f2-4595-4b52-b333-cc96192710d8` - **Name:** 'Azure Databricks Workspaces should use private link'

## Expected Result

Each workspace should have at least one private endpoint connection with a `privateLinkServiceConnectionState` status of `Approved`. No public network paths should be the sole means of access.

## Remediation

### Remediate from Azure Portal

1. Go to `Azure Databricks`.
2. Click the name of a workspace.
3. Under `Settings`, click `Networking`.
4. Click `Private endpoint connections`.
5. Click `+ Private endpoint`.
6. Under `Project details`, select a `Subscription` and a `Resource group`.
7. Under `Instance details`, provide a `Name`, `Network Interface Name`, and select a `Region`.
8. Click `Next : Resource >`.
9. Select a `Target sub-resource`.
10. Click `Next : Virtual Network >`.
11. Under `Networking`, select a `Virtual network` and a `Subnet`.
12. Optionally, configure `Private IP configuration` and `Application security group`.
13. Click `Next : DNS >`.
14. Optionally, configure `Private DNS integration`.
15. Click `Next : Tags >`.
16. Optionally, configure tags.
17. Click `Next : Review + create >`.
18. Click `Create`.
19. Repeat steps 1-18 for each workspace requiring remediation.

### Remediate from Azure CLI

For each workspace requiring remediation, run the following command to create a private endpoint connection:

```bash
az network private-endpoint create --resource-group <resource-group> --name <private-endpoint> --location <location> --vnet-name <virtual-network> --subnet <subnet> --private-connection-resource-id <workspace> --connection-name <private-endpoint-connection> --group-id <browser_authentication|databricks_ui_api>
```

## Default Value

Private endpoints are not configured for Azure Databricks workspaces by default.

## References

1. https://learn.microsoft.com/en-us/azure/databricks/security/network/classic/private-link
2. https://learn.microsoft.com/en-us/cli/azure/databricks/workspace
3. https://learn.microsoft.com/en-us/powershell/module/az.databricks

## Additional Information

This recommendation is based on the Common Reference Recommendation `Ensure Private Endpoints are used to access {service}`, from the Common Reference Recommendations > Networking > Private Endpoints section.

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 12.2 Establish and Maintain a Secure Network Architecture |      | x    | x    |
| v7               | 14.1 Segment the Network Based on Sensitivity             |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1537                       | TA0010  | M1037       |

## Profile

Level 2 | Automated
