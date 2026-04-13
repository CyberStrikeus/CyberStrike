---
name: cis-azure-compute-2.1.15
description: "Ensure App Service plan SKU supports private endpoints"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, private-endpoint, sku, app-service-plan, network-security]
cis_id: "2.1.15"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure App Service plan SKU supports private endpoints

## Description
Ensure that your App Service plan SKU supports private endpoints. Private endpoints provide secure access over Azure Private Link, which keeps traffic on the Microsoft backbone network and eliminates exposure to the public internet. Note that not all SKUs support private endpoints.

## Rationale
An appropriately configured private endpoint eliminates public exposure and helps prevent data exfiltration.

## Impact
App Service plan costs vary based on the selected SKU.

- App Service on Linux pricing: https://azure.microsoft.com/en-us/pricing/details/app-service/linux/
- App Service on Windows pricing: https://azure.microsoft.com/en-us/pricing/details/app-service/windows/

## Audit Procedure

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. In the `Properties` pane, under `Hosting`, next to `SKU and size`, ensure that the plan tier is one of the following: `Basic`, `Standard`, `ElasticPremium`, `Premium`, `PremiumV2`, `Premium0V3`, `PremiumV3`, `PremiumMV3`, `IsolatedV2`, `IsolatedMV2`, `WorkflowStandard`, `FlexConsumption`, and that the plan name is one of the following: `B1`, `B2`, `B3`, `S1`, `S2`, `S3`, `EP1`, `EP2`, `EP3`, `P1`, `P2`, `P3`, `P1V2`, `P2V2`, `P3V2`, `P0V3`, `P1V3`, `P2V3`, `P3V3`, `P1MV3`, `P2MV3`, `P3MV3`, `P4MV3`, `P5MV3`, `I1V2`, `I2V2`, `I3V2`, `I4V2`, `I5V2`, `I6V2`, `I1MV2`, `I2MV2`, `I3MV2`, `I4MV2`, `I5MV2`, `WS1`, `WS2`, `WS3`, `FC1`.
4. Repeat steps 1-3 for each app.

### Using Azure CLI
Run the following command to list apps:
```
az webapp list
```

For each app, run the following command to get the App Service plan ID:
```
az webapp show --resource-group <resource-group-name> --name <app-name> --query appServicePlanId
```

For each App Service plan, run the following command to get the plan SKU tier and name:
```
az appservice plan show --resource-group <resource-group-name> --name <app-service-plan-name> --query "{tier:sku.tier,name:sku.name}"
```

Ensure that the plan tier is one of the following: `Basic`, `Standard`, `ElasticPremium`, `Premium`, `PremiumV2`, `Premium0V3`, `PremiumV3`, `PremiumMV3`, `IsolatedV2`, `IsolatedMV2`, `WorkflowStandard`, `FlexConsumption`, and that the plan name is one of the following: `B1`, `B2`, `B3`, `S1`, `S2`, `S3`, `EP1`, `EP2`, `EP3`, `P1`, `P2`, `P3`, `P1V2`, `P2V2`, `P3V2`, `P0V3`, `P1V3`, `P2V3`, `P3V3`, `P1MV3`, `P2MV3`, `P3MV3`, `P4MV3`, `P5MV3`, `I1V2`, `I2V2`, `I3V2`, `I4V2`, `I5V2`, `I6V2`, `I1MV2`, `I2MV2`, `I3MV2`, `I4MV2`, `I5MV2`, `WS1`, `WS2`, `WS3`, `FC1`.

### Using Azure PowerShell
Run the following command to list apps:
```
Get-AzWebApp
```

Run the following command to get the app in a resource group with a given name:
```
$app = Get-AzWebApp -ResourceGroupName <resource-group-name> -Name <app-name>
```

Run the following command to get the App Service plan ID:
```
$app.ServerFarmId
```

Run the following command to get the App Service plan in a resource group with a given name:
```
$plan = Get-AzAppServicePlan -ResourceGroupname <resource-group-name> -Name <app-service-plan-name>
```

Run the following command to get the plan SKU tier and name:
```
$plan.Sku | select-object Tier, Name
```

Ensure that the plan tier and name match the supported values listed above. Repeat for each app.

## Expected Result
The App Service plan SKU tier and name should be one that supports private endpoints (Basic or higher).

## Remediation

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. In the `Properties` pane, under `Hosting`, next to `Name`, click the App Service plan name.
4. Under `Current App Service plan`, next to `Name`, click the App Service plan name.
5. Under `Essentials`, next to `Pricing plan`, click the pricing plan name.
6. Select a pricing plan where the plan tier is one of the following: `Basic`, `Standard`, `ElasticPremium`, `Premium`, `PremiumV2`, `Premium0V3`, `PremiumV3`, `PremiumMV3`, `IsolatedV2`, `IsolatedMV2`, `WorkflowStandard`, `FlexConsumption`, and the plan name is one of the supported values.
7. Click `Select`.
8. Click `Downgrade` or `Upgrade` to confirm the change.
9. Repeat steps 1-8 for each app and App Service plan requiring remediation.

### Using Azure CLI
For each App Service plan requiring remediation, run the following command to update the SKU:
```
az appservice plan update --resource-group <resource-group-name> --name <app-service-plan-name> --sku <sku>
```

### Using Azure PowerShell
Not specifically documented for this control.

## Default Value
The App Service plan is selected during creation.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans
2. https://learn.microsoft.com/en-us/azure/app-service/overview-private-endpoint
3. https://learn.microsoft.com/en-us/cli/azure/webapp
4. https://learn.microsoft.com/en-us/cli/azure/appservice/plan
5. https://learn.microsoft.com/en-us/powershell/module/az.websites/get-azwebapp
6. https://learn.microsoft.com/en-us/powershell/module/az.websites/get-azappserviceplan
7. https://azure.microsoft.com/en-us/pricing/details/app-service/linux/
8. https://azure.microsoft.com/en-us/pricing/details/app-service/windows/

## Profile
Level 2 | Automated
