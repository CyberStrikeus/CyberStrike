---
name: cis-azure-compute-2.3.4
description: "Ensure 'FTP state' is set to 'FTPS only' or 'Disabled'"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, function-apps, ftp, ftps, encryption, data-in-transit]
cis_id: "2.3.4"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'FTP state' is set to 'FTPS only' or 'Disabled'

## Description

By default, App Service supports deployment over FTP. If FTP is essential for a deployment workflow, FTPS should be enforced for all function apps.

If FTPS is not explicitly required, the recommended setting is `Disabled`.

## Rationale

FTP is an unencrypted network protocol that transmits data -- including passwords -- in clear text. The use of this protocol can lead to both data and credential compromise and can present opportunities for exfiltration, persistence, and lateral movement.

## Impact

Deployment workflows that rely on FTP or FTPS rather than WebDeploy or HTTPS endpoints may be affected.

## Audit Procedure

### Using Azure Portal

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, under `Platform settings`, ensure that `FTP state` is set to `FTPS only` or `Disabled`.
5. Repeat steps 1-4 for each function app.

### Using Azure CLI

Run the following command to list function apps:

```bash
az functionapp list
```

For each function app, run the following command to get the FTPS state setting:

```bash
az functionapp show --resource-group <resource-group-name> --name <function-app-name> --query siteConfig.ftpsState
```

Ensure that `"FtpsOnly"` or `"Disabled"` is returned.

### Using Azure PowerShell

Run the following command to list function apps:

```powershell
Get-AzFunctionApp
```

Run the following command to get the function app in a resource group with a given name:

```powershell
$app = Get-AzFunctionApp -ResourceGroupName <resource-group-name> -Name <function-app-name>
```

Run the following command to get the FTP state setting:

```powershell
$app.SiteConfig.FtpsState
```

Ensure that `"FtpsOnly"` or `"Disabled"` is returned. Repeat for each function app.

## Expected Result

The FTP state should be `FtpsOnly` or `Disabled`.

## Remediation

### Using Azure Portal

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, under `Platform settings`, set `FTP state` to `FTPS only` or `Disabled`.
5. Click `Save`.
6. Click `Continue`.
7. Repeat steps 1-6 for each function app requiring remediation.

### Using Azure CLI

For each function app requiring remediation, run the following command to set FTPS state to `FtpsOnly` or `Disabled`:

```bash
az functionapp config set --resource-group <resource-group-name> --name <function-app-name> --ftps-state <FtpsOnly|Disabled>
```

## Default Value

By default, FTP state is set to `FTPS only`.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/deploy-ftp
2. https://learn.microsoft.com/en-us/azure/app-service/overview-security
3. https://learn.microsoft.com/en-us/azure/azure-functions/functions-how-to-use-azure-function-app-settings#ftps-deployment-settings
4. https://learn.microsoft.com/en-us/cli/azure/functionapp
5. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-data-protection#dp-4-encrypt-sensitive-information-in-transit
6. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-posture-vulnerability-management#pv-7-rapidly-and-automatically-remediate-software-vulnerabilities
7. https://learn.microsoft.com/en-us/powershell/module/az.functions/get-azfunctionapp

## Profile

Level 1 | Automated
