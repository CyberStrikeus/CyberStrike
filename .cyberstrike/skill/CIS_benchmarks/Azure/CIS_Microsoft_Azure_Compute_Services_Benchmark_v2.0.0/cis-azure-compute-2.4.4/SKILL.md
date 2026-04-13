---
name: cis-azure-compute-2.4.4
description: "Ensure 'FTP state' is set to 'FTPS only' or 'Disabled'"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, functions, deployment-slots]
cis_id: "2.4.4"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'FTP state' is set to 'FTPS only' or 'Disabled'

## Description
By default, App Service supports deployment over FTP. If FTP is essential for a deployment workflow, FTPS should be enforced for all function app deployment slots.

If FTPS is not explicitly required, the recommended setting is `Disabled`.

## Rationale
FTP is an unencrypted network protocol that transmits data -- including passwords -- in clear text. The use of this protocol can lead to both data and credential compromise and can present opportunities for exfiltration, persistence, and lateral movement.

## Impact
Deployment workflows that rely on FTP or FTPS rather than WebDeploy or HTTPS endpoints may be affected.

## Audit Procedure

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment Slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` pane, under `Platform settings`, ensure that `FTP state` is set to `FTPS only` or `Disabled`.
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

For each deployment slot, run the following command to get the FTPS state setting:
```bash
az resource show --name web --resource-group <resource-group-name> --namespace Microsoft.Web --resource-type config --parent sites/<function-app-name>/slots/<deployment-slot-name> --query properties.ftpsState
```

Ensure that `"FtpsOnly"` or `"Disabled"` is returned.

## Expected Result
The `ftpsState` property should return `"FtpsOnly"` or `"Disabled"`.

## Remediation

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment Slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` pane, under `Platform settings`, set `FTP state` to `FTPS only` or `Disabled`.
7. Click `Save`.
8. Click `Continue`.
9. Repeat steps 1-8 for each function app and deployment slot requiring remediation.

### Using Azure CLI
For each deployment slot requiring remediation, run the following command to set FTPS state to `FtpsOnly` or `Disabled`:
```bash
az resource update --name web --resource-group <resource-group-name> --namespace Microsoft.Web --resource-type config --parent sites/<function-app-name>/slots/<deployment-slot-name> --set properties.ftpsState=<FtpsOnly|Disabled>
```

## Default Value
By default, FTP state is set to `FTPS only`.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/deploy-ftp
2. https://learn.microsoft.com/en-us/azure/app-service/overview-security
3. https://learn.microsoft.com/en-us/azure/azure-functions/functions-how-to-use-azure-function-app-settings#ftps-deployment-settings
4. https://learn.microsoft.com/en-us/cli/azure/functionapp
5. https://learn.microsoft.com/en-us/cli/azure/resource
6. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-data-protection#dp-4-encrypt-sensitive-information-in-transit
7. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-posture-vulnerability-management#pv-7-rapidly-and-automatically-remediate-software-vulnerabilities

## Profile
Level 1 | Automated
