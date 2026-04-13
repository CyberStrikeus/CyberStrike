---
name: cis-azure-compute-2.7
description: "Ensure App Service Environment is provisioned with v3 or higher"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service-environment, ase]
cis_id: "2.7"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure App Service Environment is provisioned with v3 or higher

## Description
Ensure App Service Environment is provisioned with v3 or higher to benefit from the latest enhancements.

## Rationale
Older versions of App Service Environment require manual management of Azure resources and have greater scaling limitations.

## Impact
Manual configuration may be required to complete the migration and to optimize your App Service plan SKU choice to meet your needs.

## Audit Procedure

### Using Azure Portal
1. Go to `App Service Environments`.
2. Click the name of an App Service Environment.
3. Ensure that `Version` displays `App Service Environment v3` or higher.
4. Repeat steps 1-3 for each App Service Environment.

### Using Azure CLI
Run the following command to list App Service Environments:
```bash
az appservice ase list
```

For each App Service Environment, ensure that `kind` is set to `ASEV3` or higher.

## Expected Result
The `kind` property should be `ASEV3` or higher. The `Version` should display `App Service Environment v3`.

## Remediation

### Using Azure Portal
When creating an App Service Environment from the portal, after clicking `+ Add`, ensure that `Create App Service Environment v3` is displayed.

## Default Value
The default version is currently App Service Environment v3.

## Additional Information
App Service Environment v1 and v2 were retired as of 31 August, 2024. As of September 1, 2024, Azure auto-migrated any remaining App Service Environment v1 and v2 on a best-effort basis.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/environment/overview
2. https://azure.microsoft.com/en-gb/updates?id=App-Service-Environment-v1v2-Retirement-Update-1
3. https://learn.microsoft.com/en-us/azure/app-service/environment/auto-migration
4. https://learn.microsoft.com/en-us/cli/azure/appservice/ase

## Profile
Level 1 | Automated
