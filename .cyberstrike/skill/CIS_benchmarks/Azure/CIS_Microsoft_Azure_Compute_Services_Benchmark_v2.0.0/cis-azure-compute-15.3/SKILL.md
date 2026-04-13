---
name: cis-azure-compute-15.3
description: "Ensure local authentication methods for accounts are disabled"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, batch]
cis_id: "15.3"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure local authentication methods for accounts are disabled

## Description

This recommendation disables local authentication and ensures that a centralized identity provider is used.

## Rationale

Identity and Authentication silos with stale or persistent keys and tokens can increase vulnerability and risk by preventing detection mechanisms from capturing anomalous activity and may not produce an auditable trail of evidence that can be used for pattern detection and forensic investigation. Centralized Identity providers such as Microsoft Entra ID are strongly preferred for all identity, authentication, authorization, and accountability (IAAA) systems and activities.

## Impact

This control does not have an explicitly stated impact section. Disabling local authentication may affect existing automation or scripts that rely on Shared Key or Task Authentication Token methods.

## Audit Procedure

### Using Azure Portal

1. Login to Azure portal `https://portal.azure.com`
2. Navigate to `Batch Accounts`

For each Batch Account shown:

1. Click the Batch Account name
2. Under the Settings section, click on `Authentication modes`
3. In the main window, click the Authentication Mode drop-down list, and review which options are checked.

Expected Output: Only `Microsoft Entra ID` should be **checked**.

### Using Azure CLI

Check Local Authentication Status for Batch Accounts:

```bash
az batch account list \
--query "[].{name:name, resourceGroup:resourceGroup, authModes:allowedAuthenticationModes}"
```

Expected Output:
- **SHOULD** contain "AAD" (Microsoft Entra ID)
- Should **NOT** contain "SharedKey" or other entries

### Using Azure PowerShell

List Authentication Methods for All Batch Accounts using script:

```powershell
Get-AzBatchAccount | ForEach-Object
{
    $authModes = (Get-AzBatchAccount -Name $_.AccountName -ResourceGroupName $_.ResourceGroupName).AllowedAuthenticationModes
    [PSCustomObject]@{
        AccountName = $_.AccountName
        ResourceGroup = $_.ResourceGroupName
        AuthenticationModes = $authModes -join ", "
    }
}
```

## Expected Result

Only `Microsoft Entra ID` (AAD) should be listed as an allowed authentication mode. `SharedKey` and `Task Authentication Token` should not be enabled.

## Remediation

### Using Azure Portal

1. Login to Azure portal `https://portal.azure.com`
2. Navigate to `Batch Accounts`

For each Batch Account shown:

1. Click the Batch Account name
2. Under the Settings section, click on `Authentication modes`
3. In the main window, click the Authentication Mode drop-down list
4. Check the box for `Microsoft Entra ID` (or other centralized IdP)
5. (If checked) Uncheck the box for `Shared Key`
6. (If checked) Uncheck the box for `Task Authentication Token`
7. Click `Save`

## Default Value

Local authentication methods are **enabled** by default.

## References

1. https://learn.microsoft.com/en-us/azure/batch/security-best-practices#batch-account-authentication

## Profile

Level 1 | Automated
