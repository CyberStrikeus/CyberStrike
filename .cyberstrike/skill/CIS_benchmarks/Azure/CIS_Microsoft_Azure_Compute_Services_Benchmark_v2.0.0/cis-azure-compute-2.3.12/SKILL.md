---
name: cis-azure-compute-2.3.12
description: "Ensure managed identities are configured"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, function-apps, managed-identity, entra-id, credential-management]
cis_id: "2.3.12"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure managed identities are configured

## Description
Managed identities from Microsoft Entra ID allow function apps to securely access other Azure services without the need to provision or rotate any secrets.

## Rationale
Using managed identities with function apps eliminates the need to store and manage credentials to access Azure resources.

## Impact
Minor administrative overhead to configure and manage role assignments for managed identities.

## Audit Procedure

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Identity`.
4. Ensure that in the `System assigned` pane, the `Status` is set to `On`, and an `Object (principal) ID` is displayed, or that in the `User assigned` pane, a managed identity is listed.
5. Repeat steps 1-4 for each function app.

### Using Azure CLI
Run the following command to list function apps:
```bash
az functionapp list
```

For each function app, run the following command to get the identity setting:
```bash
az functionapp show --resource-group <resource-group-name> --name <function-app-name> --query "identity"
```

Ensure that `type` is set to `SystemAssigned`, `UserAssigned`, or both.

## Expected Result
The identity `type` should be set to `SystemAssigned`, `UserAssigned`, or both.

## Remediation

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Identity`.
4. To add a system assigned managed identity:
   1. In the `System assigned` pane, under `Status`, click `On`.
   2. Click `Save`.
   3. Click `Yes`.
5. To add a user assigned managed identity:
   1. In the `User assigned` pane, click `Add`.
   2. Use the filter box to search for a managed identity.
   3. Select the identity.
   4. Click `Add`.
6. Repeat steps 1-5 for each function app requiring remediation.

### Using Azure CLI
For each function app requiring remediation, run the following command to assign a system-assigned managed identity:
```bash
az functionapp identity assign --resource-group <resource-group-name> --name <function-app-name>
```

### Using Azure PowerShell
For each function app requiring remediation, run the following command to assign a system-assigned managed identity:
```powershell
Update-AzFunctionApp -ResourceGroupName <resource-group-name> -Name <function-app-name> -IdentityType SystemAssigned -Force
```

## Default Value
Managed identities are disabled by default for function apps.

## References
1. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management#im-1-use-centralized-identity-and-authentication-system
2. https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity
3. https://learn.microsoft.com/en-us/cli/azure/functionapp
4. https://learn.microsoft.com/en-us/powershell/module/az.functions/update-azfunctionapp

## Profile
Level 1 | Automated
