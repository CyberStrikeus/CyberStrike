---
name: cis-azure-foundations-2.1.1
description: "Ensure Azure Databricks is deployed in a customer-managed VNet"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, databricks, analytics]
cis_id: "2.1.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-2.1.2, cis-azure-foundations-2.1.9, cis-azure-foundations-2.1.11]
prerequisites: []
severity_boost: {}
---

# Ensure Azure Databricks is deployed in a customer-managed VNet

## Description

Networking for Azure Databricks can be set up in a few different ways. Using a customer-managed Virtual Network (VNet) (also known as VNet Injection) ensures that compute clusters and control planes are securely isolated within the organization's network boundary. By default, Databricks creates a managed VNet, which provides limited control over network security policies, firewall configurations, and routing.

## Rationale

Using a customer-managed VNet ensures better control over network security and aligns with zero-trust architecture principles. It allows for:

- Restricted outbound internet access to prevent unauthorized data exfiltration.
- Integration with on-premises networks via VPN or ExpressRoute for hybrid connectivity.
- Fine-grained NSG policies to restrict access at the subnet level.
- Private Link for secure API access, avoiding public internet exposure.

## Impact

- Requires additional configuration during Databricks workspace deployment.
- Might increase operational overhead for network maintenance.
- May impact connectivity if misconfigured (e.g., restrictive NSG rules or missing routes).

## Audit Procedure

### Audit from Azure Portal

1. Go to Azure Portal -> Search for Databricks Workspaces.
2. Select the Databricks Workspace to audit.
3. Under Networking, check if the workspace is deployed in a Customer-Managed VNet.
4. If the Virtual Network field shows Databricks-Managed VNet, it is non-compliant.
5. Verify NSG rules and Private Endpoints for fine-grained access control.

### Audit from Azure CLI

Run the following command to check if Databricks is using a customer-managed VNet:

```bash
az network vnet show --resource-group <resource-group-name> --name <vnet-name>
```

Ensure that Databricks subnets are present in the VNet configuration. Validate NSG rules attached to the Databricks subnets.

### Audit from PowerShell

```powershell
Get-AzDatabricksWorkspace -ResourceGroupName <resource-group-name> -Name <databricks-workspace-name> | Select-Object VirtualNetworkId
```

If VirtualNetworkId is null or shows a Databricks-Managed VNet, it is non-compliant.

### Audit from Azure Policy

- **Policy ID:** `9c25c9e4-ee12-4882-afd2-11fb9d87893f` - **Name:** 'Azure Databricks Workspaces should be in a virtual network'

## Expected Result

The workspace should show a customer-managed VNet with properly configured subnets and NSG rules. The VirtualNetworkId should point to an organization-owned VNet resource.

## Remediation

### Remediate from Azure Portal

1. Delete the existing Databricks workspace (migration required).
2. Create a new Databricks workspace with VNet Injection:
3. Go to Azure Portal -> Create Databricks Workspace.
4. Select Advanced Networking.
5. Choose Deploy into your own Virtual Network.
6. Specify a customer-managed VNet and associated subnets.
7. Enable Private Link for secure API access.

### Remediate from Azure CLI

Deploy a new Databricks workspace in a custom VNet:

```bash
az databricks workspace create --name <databricks-workspace-name> \
    --resource-group <resource-group-name> \
    --location <region> \
    --managed-resource-group <managed-rg-name> \
    --enable-no-public-ip true \
    --network-security-group-rule "NoAzureServices" \
    --public-network-access Disabled \
    --custom-virtual-network-id /subscriptions/<subscription-id>/resourceGroups/<resource-group-name>/providers/Microsoft.Network/virtualNetworks/<vnet-name>
```

Ensure NSG Rules are correctly configured:

```bash
az network nsg rule create --resource-group <resource-group-name> \
    --nsg-name <nsg-name> \
    --name "DenyAllOutbound" \
    --direction Outbound \
    --access Deny \
    --priority 4096
```

### Remediate from PowerShell

```powershell
New-AzDatabricksWorkspace -ResourceGroupName <resource-group-name> -Name <databricks-workspace-name> -Location <region> -ManagedResourceGroupName <managed-rg-name> -CustomVirtualNetworkId "/subscriptions/<subscription-id>/resourceGroups/<resource-group-name>/providers/Microsoft.Network/virtualNetworks/<vnet-name>"
```

## Default Value

By default, Azure Databricks uses a Databricks-Managed VNet.

## References

1. https://learn.microsoft.com/en-us/security/benchmark/azure/baselines/azure-databricks-security-baseline
2. https://learn.microsoft.com/en-us/azure/databricks/security/network/classic/vnet-inject#network-security-group-rules

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 12.2 Establish and Maintain a Secure Network Architecture |      | x    | x    |
| v7               | 14.1 Segment the Network Based on Sensitivity             |      | x    | x    |

## Profile

Level 1 | Automated
