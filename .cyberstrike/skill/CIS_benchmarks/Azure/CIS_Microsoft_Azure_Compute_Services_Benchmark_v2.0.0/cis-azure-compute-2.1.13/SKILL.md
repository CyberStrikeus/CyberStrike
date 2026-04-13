---
name: cis-azure-compute-2.1.13
description: "Ensure managed identities are configured"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, managed-identity, entra-id, credential-management]
cis_id: "2.1.13"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure managed identities are configured

## Description
Managed identities from Microsoft Entra ID allow App Service apps to securely access other Azure services without the need to provision or rotate any secrets.

## Rationale
Using managed identities with App Service apps eliminates the need to store and manage credentials to access Azure resources.

## Impact
Minor administrative overhead to configure and manage role assignments for managed identities.

## Audit Procedure

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Identity`.
4. Ensure that in the `System assigned` pane, the `Status` is set to `On`, and an `Object (principal) ID` is displayed, or that in the `User assigned` pane, a managed identity is listed.
5. Repeat steps 1-4 for each app.

### Using Azure CLI
Run the following command to list web apps:
```
az webapp list
```

For each web app, run the following command:
```
az webapp identity show --resource-group <resource-group-name> --name <app-name> --query type
```

Ensure the command returns `SystemAssigned`, `UserAssigned`, or both.

### Using Azure PowerShell
Run the following command to list web apps:
```
Get-AzWebApp
```

Run the following command to get the web app in a resource group with a given name:
```
Get-AzWebapp -ResourceGroupName <resource-group-name> -Name <app-name>
```

Run the following command to get the assigned identity type for a web app:
```
$webapp.Identity.Type
```

Ensure the command returns `SystemAssigned`, `UserAssigned`, or both.

## Expected Result
The identity type should return `SystemAssigned`, `UserAssigned`, or both.

## Remediation

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
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
6. Repeat steps 1-5 for each app requiring remediation.

### Using Azure CLI
For each web app requiring remediation, run the following command to assign a managed identity:
```
az webapp identity assign --resource-group <resource-group-name> --name <app-name>
```

### Using Azure PowerShell
For each web app requiring remediation, run the following command to assign a managed identity:
```
Set-AzWebApp -AssignIdentity $True -ResourceGroupName <resource-group-name> -Name <app-name>
```

## Default Value
Managed identities are disabled by default for App Service apps.

## References
1. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management#im-1-use-centralized-identity-and-authentication-system
2. https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity
3. https://learn.microsoft.com/en-us/cli/azure/webapp
4. https://learn.microsoft.com/en-us/powershell/module/az.websites/get-azwebapp
5. https://learn.microsoft.com/en-us/powershell/module/az.websites/set-azwebapp

## Profile
Level 1 | Automated
