---
name: cis-azure-compute-2.3.6
description: "Ensure 'HTTPS Only' is set to 'On'"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, function-apps, https, tls, encryption, data-in-transit]
cis_id: "2.3.6"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'HTTPS Only' is set to 'On'

## Description

Azure App Service allows function apps to run under both HTTP and HTTPS by default. Function apps can be accessed by anyone using non-secure HTTP links by default. Non-secure HTTP requests can be restricted and all HTTP requests redirected to the secure HTTPS port. It is recommended to enforce HTTPS-only traffic.

## Rationale

Enabling HTTPS-only traffic will redirect all non-secure HTTP requests to HTTPS ports. HTTPS uses the TLS/SSL protocol to provide a secure connection which is both encrypted and authenticated. It is therefore important to support HTTPS for the security benefits.

## Impact

When it is enabled, every incoming HTTP request is redirected to the HTTPS port. This means an extra level of security will be added to the HTTP requests made to the deployment slot.

## Audit Procedure

### Using Azure Portal

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` tab, under `Platform settings`, ensure that `HTTPS Only` is set to `On`.
5. Repeat steps 1-4 for each function app.

### Using Azure CLI

Run the following command to list function apps:

```bash
az functionapp list
```

For each function app, run the following command to get the HTTPS setting:

```bash
az functionapp show --resource-group <resource-group-name> --name <function-app-name> --query "httpsOnly"
```

Ensure that the command returns `true`.

### Using Azure PowerShell

Run the following command to list function apps:

```powershell
Get-AzFunctionApp
```

Run the following command to get the function app with a given name:

```powershell
$app = Get-AzFunctionApp -ResourceGroupName <resource-group-name> -Name <function-app-name>
```

Run the following command to get the HTTPS setting for the function app:

```powershell
$app.httpsOnly
```

Ensure that the command returns `True`. Repeat for each function app.

## Expected Result

The `httpsOnly` setting should return `true`.

## Remediation

### Using Azure Portal

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` tab, under `Platform settings`, next to `HTTPS Only`, select the radio button next to `On`.
5. Click `Save`.
6. Click `Continue`.
7. Repeat steps 1-6 for each function app requiring remediation.

### Using Azure CLI

For each function app requiring remediation, run the following command to enable `HTTPS Only`:

```bash
az resource update --resource-group <resource-group-name> --name <function-app-name> --resource-type "Microsoft.Web/sites" --set properties.httpsOnly=true
```

## Default Value

`HTTPS Only` is enabled by default.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/overview-security#https-and-certificates
2. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-data-protection#dp-3-encrypt-sensitive-data-in-transit
3. https://techcommunity.microsoft.com/t5/azure-paas-blog/enable-https-setting-on-azure-app-service-using-azure-policy/ba-p/3286603
4. https://learn.microsoft.com/en-us/cli/azure/functionapp
5. https://learn.microsoft.com/en-us/powershell/module/az.functions/get-azfunctionapp
6. https://learn.microsoft.com/en-us/azure/azure-functions/security-concepts
7. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile

Level 1 | Automated
