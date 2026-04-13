---
name: cis-azure-compute-2.1.7
description: "Ensure 'HTTPS Only' is set to 'On'"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, https, tls, encryption, data-in-transit]
cis_id: "2.1.7"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'HTTPS Only' is set to 'On'

## Description
Azure App Service allows apps to run under both HTTP and HTTPS by default. Apps can be accessed by anyone using non-secure HTTP links by default. Non-secure HTTP requests can be restricted and all HTTP requests redirected to the secure HTTPS port. It is recommended to enforce HTTPS-only traffic.

## Rationale
Enabling HTTPS-only traffic will redirect all non-secure HTTP requests to HTTPS ports. HTTPS uses the TLS/SSL protocol to provide a secure connection which is both encrypted and authenticated. It is therefore important to support HTTPS for the security benefits.

## Impact
When it is enabled, every incoming HTTP request is redirected to the HTTPS port. This means an extra level of security will be added to the HTTP requests made to the app.

## Audit Procedure

### Using Azure Portal
1. Login to Azure Portal using https://portal.azure.com
2. Go to `App Services`
3. For each App Service
4. Under `Setting` section, click on `Configuration`
5. Under the `General Settings` tab, ensure that `HTTPS Only` is set to `On` under `Platform Settings`

### Using Azure CLI
To check HTTPS-only traffic value for an existing app, run the following command:
```
az webapp show --resource-group <RESOURCE_GROUP_NAME> --name <APP_NAME> --query httpsOnly
```

The output should return `true` if HTTPS-only traffic value is set to `On`.

### Using Azure PowerShell
List all the web apps configured within the subscription:
```
Get-AzWebApp | Select-Object ResourceGroup, Name, HttpsOnly
```

For each web app review the `HttpsOnly` setting and make sure it is set to `True`.

## Expected Result
The `httpsOnly` setting should return `true`.

## Remediation

### Using Azure Portal
1. Login to Azure Portal using https://portal.azure.com
2. Go to `App Services`
3. For each App Service
4. Under `Setting` section, click on `Configuration`
5. Under the `General Settings` tab, set `HTTPS Only` to `On` under `Platform Settings`

### Using Azure CLI
To set HTTPS-only traffic value for an existing app, run the following command:
```
az webapp update --resource-group <RESOURCE_GROUP_NAME> --name <APP_NAME> --set httpsOnly=true
```

### Using Azure PowerShell
```
Set-AzWebApp -ResourceGroupName <RESOURCE_GROUP_NAME> -Name <APP_NAME> -HttpsOnly $true
```

## Default Value
`HTTPS Only` is disabled by default.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/overview-security#https-and-certificates
2. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-data-protection#dp-3-encrypt-sensitive-data-in-transit
3. https://techcommunity.microsoft.com/t5/azure-paas-blog/enable-https-setting-on-azure-app-service-using-azure-policy/ba-p/3286603
4. https://learn.microsoft.com/en-us/cli/azure/webapp
5. https://learn.microsoft.com/en-us/powershell/module/az.websites/get-azwebapp
6. https://learn.microsoft.com/en-us/powershell/module/az.websites/set-azwebapp

## Profile
Level 1 | Automated
