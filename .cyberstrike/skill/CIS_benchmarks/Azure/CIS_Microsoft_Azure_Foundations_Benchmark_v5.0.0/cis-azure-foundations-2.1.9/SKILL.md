---
name: cis-azure-foundations-2.1.9
description: "Ensure 'No Public IP' is set to 'Enabled'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, databricks, analytics]
cis_id: "2.1.9"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-2.1.1, cis-azure-foundations-2.1.10, cis-azure-foundations-2.1.11]
prerequisites: []
severity_boost: {}
---

# Ensure 'No Public IP' is set to 'Enabled'

## Description

Enable secure cluster connectivity (also known as no public IP) on Azure Databricks workspaces to ensure that clusters do not have public IP addresses and communicate with the control plane over a secure connection.

## Rationale

Enabling secure cluster connectivity limits exposure to the public internet, improving security and reducing the risk of external attacks.

## Impact

Enabling secure cluster connectivity requires careful network configuration. Before secure cluster connectivity can be enabled, Azure Databricks workspaces must be deployed in a customer-managed virtual network (VNet injection) -- refer to the recommendation `Ensure that Azure Databricks is deployed in a customer-managed virtual network (VNet)`.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Azure Databricks`.
2. Click the name of a workspace.
3. Under `Settings`, click `Networking`.
4. Under `Network access`, ensure that `Deploy Azure Databricks workspace with Secure Cluster Connectivity (No Public IP)` is set to `Enabled`.
5. Repeat steps 1-4 for each workspace.

### Audit from Azure CLI

Run the following command to list workspaces:

```bash
az databricks workspace list
```

For each workspace, run the following command to get the `enableNoPublicIp` setting:

```bash
az databricks workspace show --resource-group <resource-group> --name <workspace> --query parameters.enableNoPublicIp.value
```

Ensure that `true` is returned.

### Audit from PowerShell

Run the following command to list workspaces:

```powershell
Get-AzDatabricksWorkspace
```

Run the following command to get the workspace in a resource group with a given name:

```powershell
$workspace = Get-AzDatabricksWorkspace -ResourceGroupName <resource-group> -Name <workspace>
```

Run the following command to get the `EnableNoPublicIp` setting:

```powershell
$workspace.EnableNoPublicIP
```

Ensure that `True` is returned. Repeat for each workspace.

### Audit from Azure Policy

- **Policy ID:** `51c1490f-3319-459c-bbbc-7f391bbed753` - **Name:** 'Azure Databricks Clusters should disable public IP'

## Expected Result

The `enableNoPublicIp` parameter should return `true` for all Databricks workspaces. No cluster nodes should have public IP addresses assigned.

## Remediation

### Remediate from Azure Portal

1. Go to `Azure Databricks`.
2. Click the name of a workspace.
3. Under `Settings`, click `Networking`.
4. Under `Network access`, next to `Deploy Azure Databricks workspace with Secure Cluster Connectivity (No Public IP)`, click the radio button next to `Enabled`.
5. Click `Save`.
6. Repeat steps 1-5 for each workspace requiring remediation.

### Remediate from Azure CLI

For each workspace requiring remediation, run the following command to set `enableNoPublicIp` to `true`:

```bash
az databricks workspace update --resource-group <resource-group> --name <workspace> --enable-no-public-ip true
```

### Remediate from PowerShell

For each workspace requiring remediation, run the following command to set `EnableNoPublicIP` to `True`:

```powershell
Update-AzDatabricksWorkspace -ResourceGroupName <resource-group> -Name <workspace> -EnableNoPublicIP
```

## Default Value

`No Public IP` is set to `Enabled` by default.

## References

1. https://learn.microsoft.com/en-us/azure/databricks/security/network/classic/secure-cluster-connectivity
2. https://learn.microsoft.com/en-us/cli/azure/databricks/workspace
3. https://learn.microsoft.com/en-us/powershell/module/az.databricks

## CIS Controls

| Controls Version | Control                                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists                          | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists            | x    | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| ---------------------------- | ------- | ----------- |
| T1530                        | TA0009  | M1037       |

## Profile

Level 1 | Automated
