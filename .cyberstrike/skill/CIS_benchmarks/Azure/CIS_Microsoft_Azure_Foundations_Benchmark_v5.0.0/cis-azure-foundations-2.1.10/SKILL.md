---
name: cis-azure-foundations-2.1.10
description: "Ensure 'Allow Public Network Access' is set to 'Disabled'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, databricks, analytics]
cis_id: "2.1.10"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-2.1.1, cis-azure-foundations-2.1.9, cis-azure-foundations-2.1.11]
prerequisites: []
severity_boost: {}
---

# Ensure 'Allow Public Network Access' is set to 'Disabled'

## Description

Disable public network access to prevent exposure to the internet and reduce the risk of unauthorized access. Use private endpoints to securely manage access within trusted networks.

## Rationale

Disabling public network access improves security by ensuring that Azure Databricks workspaces are not exposed on the public internet.

## Impact

**NOTE:** Prior to disabling public network access, it is strongly recommended that, for each workspace, either:

- Virtual network integration is completed as described in "Ensure that Azure Databricks is deployed in a customer-managed virtual network (VNet)"

OR

- Private endpoints/links are set up as described in "Ensure private endpoints are used to access Azure Databricks workspaces."

Disabling public network access restricts access to the service. This enhances security but will require the configuration of a virtual network and/or private endpoints for any services or users needing access within trusted networks.

Before public network access can be disabled, Azure Databricks workspaces must be deployed in a customer-managed virtual network (VNet injection) -- refer to the recommendation `Ensure that Azure Databricks is deployed in a customer-managed virtual network (VNet)`, and `requiredNsgRules` must be set to a value other than `AllRules`.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Azure Databricks`.
2. Click the name of a workspace.
3. Under `Settings` click `Networking`.
4. Under `Network access`, ensure `Allow Public Network Access` is set to `Disabled`.
5. Repeat steps 1-4 for each workspace.

### Audit from Azure CLI

Run the following command to list workspaces:

```bash
az databricks workspace list
```

For each workspace, run the following command to get the `publicNetworkAccess` setting:

```bash
az databricks workspace show --resource-group <resource-group> --name <workspace> --query publicNetworkAccess
```

Ensure that `"Disabled"` is returned.

### Audit from PowerShell

Run the following command to list workspaces:

```powershell
Get-AzDatabricksWorkspace
```

Run the following command to get the workspace in a resource group with a given name:

```powershell
$workspace = Get-AzDatabricksWorkspace -ResourceGroupName <resource-group> -Name <workspace>
```

Run the following command to get the `PublicNetworkAccess` setting:

```powershell
$workspace.PublicNetworkAccess
```

Ensure that `Disabled` is returned. Repeat for each workspace.

### Audit from Azure Policy

- **Policy ID:** `0e7849de-b939-4c50-ab48-fc6b0f5eeba2` - **Name:** 'Azure Databricks Workspaces should disable public network access'

## Expected Result

The `publicNetworkAccess` setting should return `Disabled` for all Databricks workspaces. Access should only be possible through private endpoints or VNet-integrated paths.

## Remediation

### Remediate from Azure Portal

1. Go to `Azure Databricks`.
2. Click the name of a workspace.
3. Under `Settings` click `Networking`.
4. Under `Network access`, next to `Allow Public Network Access`, click the radio button next to `Disabled`.
5. Click `Save`.
6. Repeat steps 1-5 for each workspace requiring remediation.

### Remediate from Azure CLI

For each workspace requiring remediation, run the following command to set `publicNetworkAccess` to `Disabled`:

```bash
az databricks workspace update --resource-group <resource-group> --name <workspace> --public-network-access Disabled
```

### Remediate from PowerShell

For each workspace requiring remediation, run the following command to set `PublicNetworkAccess` to `Disabled`:

```powershell
Update-AzDatabricksWorkspace -ResourceGroupName <resource-group> -Name <workspace> -PublicNetworkAccess Disabled
```

## Default Value

`Allow Public Network Access` is set to `Enabled` by default.

## References

1. https://learn.microsoft.com/en-us/cli/azure/databricks/workspace
2. https://learn.microsoft.com/en-us/powershell/module/az.databricks

## Additional Information

This recommendation is based on the Common Reference Recommendation `Ensure public network access is Disabled`, from the Common Reference Recommendations > Networking > Virtual Networks (VNets) section.

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1530                       | TA0009  | M1037       |

## Profile

Level 1 | Automated
