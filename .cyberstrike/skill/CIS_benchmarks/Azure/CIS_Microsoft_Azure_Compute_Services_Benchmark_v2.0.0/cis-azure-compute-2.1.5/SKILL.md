---
name: cis-azure-compute-2.1.5
description: "Ensure 'FTP State' is set to 'FTPS only' or 'Disabled'"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, ftp, ftps, encryption, data-in-transit]
cis_id: "2.1.5"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'FTP State' is set to 'FTPS only' or 'Disabled'

## Description
By default, App Service supports deployment over FTP. If FTP is essential for a deployment workflow, FTPS should be enforced for all App Service apps.

If FTPS is not explicitly required, the recommended setting is `Disabled`.

## Rationale
FTP is an unencrypted network protocol that transmits data -- including passwords -- in clear text. The use of this protocol can lead to both data and credential compromise and can present opportunities for exfiltration, persistence, and lateral movement.

## Impact
Deployment workflows that rely on FTP or FTPS rather than WebDeploy or HTTPS endpoints may be affected.

## Audit Procedure

### Using Azure Portal
1. Go to the Azure Portal
2. Select `App Services`
3. Click on an app
4. Select `Settings` and then `Configuration`
5. Under `General Settings`, for the `Platform Settings`, the `FTP state` should not be set to `All allowed`

### Using Azure CLI
List webapps to obtain the ids:
```
az webapp list
```

List the publish profiles to obtain the username, password, and ftp server url:
```
az webapp deployment list-publishing-profiles --ids <ids>
```

### Using Azure PowerShell
List all Web Apps:
```
Get-AzWebApp
```

For each app:
```
Get-AzWebApp -ResourceGroupName <resource group name> -Name <app name> | Select-Object -ExpandProperty SiteConfig
```

In the output, look for the value of **FtpsState**. If its value is **AllAllowed** the setting is out of compliance. Any other value is considered in compliance with this check.

## Expected Result
FTP state should be set to `FtpsOnly` or `Disabled`, not `AllAllowed`.

## Remediation

### Using Azure Portal
1. Go to the Azure Portal
2. Select `App Services`
3. Click on an app
4. Select `Settings` and then `Configuration`
5. Under `General Settings`, for the `Platform Settings`, the `FTP state` should be set to `Disabled` or `FTPS Only`

### Using Azure CLI
For each out of compliance application, run the following choosing either 'disabled' or 'FtpsOnly' as appropriate:
```
az webapp config set --resource-group <resource group name> --name <app name> --ftps-state [disabled|FtpsOnly]
```

### Using Azure PowerShell
For each out of compliance application, run the following:
```
Set-AzWebApp -ResourceGroupName <resource group name> -Name <app name> -FtpsState <Disabled or FtpsOnly>
```

## Default Value
By default, FTP state is set to `FTPS only`.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/deploy-ftp
2. https://learn.microsoft.com/en-us/azure/app-service/overview-security
3. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-data-protection#dp-4-encrypt-sensitive-information-in-transit
4. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-posture-vulnerability-management#pv-7-rapidly-and-automatically-remediate-software-vulnerabilities
5. https://learn.microsoft.com/en-us/rest/api/appservice/web-apps/create-or-update-configuration#ftpsstate
6. https://learn.microsoft.com/en-us/cli/azure/webapp
7. https://learn.microsoft.com/en-us/powershell/module/az.websites/get-azwebapp
8. https://learn.microsoft.com/en-us/powershell/module/az.websites/set-azwebapp

## Profile
Level 1 | Automated
