---
name: cis-azure-compute-2.4.11
description: "Ensure managed identities are configured"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, functions, deployment-slots]
cis_id: "2.4.11"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure managed identities are configured

## Description
Managed identities from Microsoft Entra ID allow function app deployment slots to securely access other Azure services without the need to provision or rotate any secrets.

This recommendation applies to function apps using the Consumption, Premium, or Dedicated (App Service) plans, which support deployment slots.

## Rationale
Using managed identities with function app deployment slots eliminates the need to store and manage credentials to access Azure resources.

## Impact
Minor administrative overhead to configure and manage role assignments for managed identities.

## Audit Procedure

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Identity`.
6. Ensure that in the `System assigned` pane, the `Status` is set to `On`, and an `Object (principal) ID` is displayed, or that in the `User assigned` pane, a managed identity is listed.
7. Repeat steps 1-6 for each function app and deployment slot.

### Using Azure CLI
Run the following command to list function apps:
```bash
az functionapp list
```

For each function app, run the following command to list deployment slots:
```bash
az functionapp deployment slot list --resource-group <resource-group-name> --name <function-app-name>
```

For each deployment slot, ensure that `identity` contains `type` set to `SystemAssigned`, `UserAssigned`, or both.

## Expected Result
The deployment slot should have a managed identity configured, either system-assigned, user-assigned, or both.

## Remediation

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Identity`.
6. To add a system assigned managed identity:
   1. In the `System assigned` pane, under `Status`, click `On`.
   2. Click `Save`.
   3. Click `Yes`.
7. To add a user assigned managed identity:
   1. In the `User assigned` pane, click `Add`.
   2. Use the filter box to search for a managed identity.
   3. Select the identity.
   4. Click `Add`.
8. Repeat steps 1-7 for each function app and deployment slot requiring remediation.

### Using Azure PowerShell
For each deployment slot requiring remediation, run the following command to assign a system-assigned managed identity:
```powershell
Set-AzWebAppSlot -ResourceGroupName <resource-group-name> -Name <function-app-name> -Slot <deployment-slot-name> -AssignIdentity $true
```

## Default Value
Managed identities are disabled by default for function app deployment slots.

## References
1. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management#im-1-use-centralized-identity-and-authentication-system
2. https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity
3. https://learn.microsoft.com/en-us/cli/azure/functionapp
4. https://learn.microsoft.com/en-us/powershell/module/az.websites/set-azwebappslot

## Profile
Level 1 | Automated
