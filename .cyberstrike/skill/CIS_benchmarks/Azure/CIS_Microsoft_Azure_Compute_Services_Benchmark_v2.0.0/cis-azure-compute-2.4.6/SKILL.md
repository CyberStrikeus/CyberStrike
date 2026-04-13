---
name: cis-azure-compute-2.4.6
description: "Ensure 'HTTPS Only' is set to 'On'"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, functions, deployment-slots]
cis_id: "2.4.6"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'HTTPS Only' is set to 'On'

## Description
Azure App Service allows function app deployment slots to run under both HTTP and HTTPS by default. Function app deployment slots can be accessed by anyone using non-secure HTTP links by default. Non-secure HTTP requests can be restricted and all HTTP requests redirected to the secure HTTPS port. It is recommended to enforce HTTPS-only traffic.

This recommendation applies to function apps using the Consumption, Premium, or Dedicated (App Service) plans, which support deployment slots.

## Rationale
Enabling HTTPS-only traffic will redirect all non-secure HTTP requests to HTTPS ports. HTTPS uses the TLS/SSL protocol to provide a secure connection which is both encrypted and authenticated. It is therefore important to support HTTPS for the security benefits.

## Impact
When it is enabled, every incoming HTTP request is redirected to the HTTPS port. This means an extra level of security will be added to the HTTP requests made to the deployment slot.

## Audit Procedure

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` tab, under `Platform settings`, ensure that `HTTPS Only` is set to `On`.
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

For each deployment slot, ensure that `httpsOnly` is set to `true`.

## Expected Result
The `httpsOnly` property should be set to `true`.

## Remediation

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` tab, under `Platform settings`, next to `HTTPS Only`, select the radio button next to `On`.
7. Click `Save`.
8. Click `Continue`.
9. Repeat steps 1-8 for each function app and deployment slot requiring remediation.

### Using Azure CLI
For each deployment slot requiring remediation, run the following command to enable `HTTPS Only`:
```bash
az resource update --resource-group <resource-group-name> --name <function-app-name>/slots/<deployment-slot-name> --resource-type "Microsoft.Web/sites" --set properties.httpsOnly=true
```

## Default Value
`HTTPS Only` is enabled by default.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/overview-security#https-and-certificates
2. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-data-protection#dp-3-encrypt-sensitive-data-in-transit
3. https://techcommunity.microsoft.com/t5/azure-paas-blog/enable-https-setting-on-azure-app-service-using-azure-policy/ba-p/3286603
4. https://learn.microsoft.com/en-us/azure/azure-functions/security-concepts
5. https://learn.microsoft.com/en-us/azure/azure-functions/functions-deployment-slots
6. https://learn.microsoft.com/en-us/cli/azure/functionapp
7. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile
Level 1 | Automated
