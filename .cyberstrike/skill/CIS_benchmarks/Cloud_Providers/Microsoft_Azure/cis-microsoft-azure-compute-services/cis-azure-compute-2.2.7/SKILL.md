---
name: cis-azure-compute-2.2.7
description: "Ensure 'HTTPS Only' is set to 'On'"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, deployment-slots, https, tls, encryption, data-in-transit]
cis_id: "2.2.7"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'HTTPS Only' is set to 'On'

## Description

Azure App Service allows deployment slots to run under both HTTP and HTTPS by default. Deployment slots can be accessed by anyone using non-secure HTTP links by default. Non-secure HTTP requests can be restricted and all HTTP requests redirected to the secure HTTPS port. It is recommended to enforce HTTPS-only traffic.

## Rationale

Enabling HTTPS-only traffic will redirect all non-secure HTTP requests to HTTPS ports. HTTPS uses the TLS/SSL protocol to provide a secure connection which is both encrypted and authenticated. It is therefore important to support HTTPS for the security benefits.

## Impact

When it is enabled, every incoming HTTP request is redirected to the HTTPS port. This means an extra level of security will be added to the HTTP requests made to the deployment slot.

## Audit Procedure

### Using Azure Portal

1. Go to `App Services`.
2. Click the name of an app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` tab, under `Platform settings`, ensure that `HTTPS Only` is set to `On`.
7. Repeat steps 1-6 for each app and deployment slot.

### Using Azure CLI

Run the following command to list apps:

```bash
az webapp list
```

For each app, run the following command to list deployment slots:

```bash
az webapp deployment slot list --resource-group <resource-group-name> --name <app-name>
```

For each deployment slot, ensure that `httpsOnly` is set to `true`.

### Using Azure PowerShell

Run the following command to list apps:

```powershell
Get-AzWebApp
```

Run the following command to list deployment slots for an app:

```powershell
Get-AzWebAppSlot -ResourceGroupName <resource-group-name> -Name <app-name>
```

Run the following command to get the deployment slot with a given name:

```powershell
$slot = Get-AzWebAppSlot -ResourceGroupName <resource-group-name> -Name <app-name> -Slot <deployment-slot-name>
```

Run the following command to get the HTTPS setting for the deployment slot:

```powershell
$slot.httpsOnly
```

Ensure that the command returns `True`. Repeat for each app and deployment slot.

## Expected Result

The `httpsOnly` property should return `True`, indicating that HTTPS-only traffic is enforced.

## Remediation

### Using Azure Portal

1. Go to `App Services`.
2. Click the name of an app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` tab, under `Platform settings`, next to `HTTPS Only`, select the radio button next to `On`.
7. Click `Save`.
8. Click `Continue`.
9. Repeat steps 1-8 for each app and deployment slot requiring remediation.

### Using Azure CLI

For each deployment slot requiring remediation, run the following command to enable HTTPS Only:

```bash
az resource update --resource-group <resource-group-name> --name <app-name>/slots/<deployment-slot-name> --resource-type "Microsoft.Web/sites" --set properties.httpsOnly=true
```

### Using Azure PowerShell

For each deployment slot requiring remediation, run the following command to enable HTTPS Only:

```powershell
Set-AzWebAppSlot -ResourceGroupName <resource-group-name> -Name <app-name> -Slot <deployment-slot-name> -HttpsOnly $true
```

## Default Value

`HTTPS Only` is disabled by default.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/overview-security#https-and-certificates
2. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-data-protection#dp-3-encrypt-sensitive-data-in-transit
3. https://techcommunity.microsoft.com/t5/azure-paas-blog/enable-https-setting-on-azure-app-service-using-azure-policy/ba-p/3286603
4. https://learn.microsoft.com/en-us/cli/azure/webapp
5. https://learn.microsoft.com/en-us/powershell/module/az.websites/get-azwebappslot
6. https://learn.microsoft.com/en-us/powershell/module/az.websites/set-azwebappslot
7. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile

Level 1 | Automated
