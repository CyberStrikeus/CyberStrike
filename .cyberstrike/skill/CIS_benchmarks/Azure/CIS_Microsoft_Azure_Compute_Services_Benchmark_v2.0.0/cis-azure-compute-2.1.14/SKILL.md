---
name: cis-azure-compute-2.1.14
description: "Ensure public network access is disabled"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, public-network-access, network-security, private-endpoint]
cis_id: "2.1.14"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure public network access is disabled

## Description
Disable public network access to prevent exposure to the internet and reduce the risk of unauthorized access. Use private endpoints to securely manage access within trusted networks.

## Rationale
Disabling public network access improves security by ensuring that the service is not directly exposed to the public Internet. This has the added benefit of providing more granular control over security settings and configurations for those additional layers of separation.

## Impact
**NOTE:** Prior to disabling public network access, it is strongly recommended that, for each App Service App, either:

- complete virtual network integration as described in "Ensure app is integrated with a virtual network"

OR

- set up private endpoints/links as described in "Ensure private endpoints are used to access App Service apps."

Disabling public network access restricts direct access to the service. This enhances security but will require the configuration of a virtual network and/or private endpoints for any services or users needing access within trusted networks.

## Audit Procedure

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Networking`.
4. Under `Inbound traffic configuration`, ensure that `Public network access` is set to `Disabled`.
5. Repeat steps 1-4 for each app.

### Using Azure CLI
Run the following command to list apps:
```
az webapp list
```

For each app, run the following command to get the public network access setting:
```
az webapp show --resource-group <resource-group-name> --name <app-name> --query "publicNetworkAccess"
```

Ensure that the command returns `"Disabled"`.

### Using Azure PowerShell
Not specifically documented for this control.

## Expected Result
The `publicNetworkAccess` property should return `"Disabled"`.

## Remediation

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Networking`.
4. Under `Inbound traffic configuration`, click the text next to `Public network access`.
5. Select the radio button next to `Disabled`.
6. Click `Save`.
7. Check the box to confirm the change.
8. Click `Continue`.
9. Repeat steps 1-8 for each app requiring remediation.

### Using Azure CLI
For each app requiring remediation, run the following command to disable public network access:
```
az resource update --resource-group <resource-group-name> --name <app-name> --resource-type "Microsoft.Web/sites" --set properties.publicNetworkAccess=Disabled
```

### Using Azure PowerShell
Not specifically documented for this control.

## Default Value
By default, public network access is enabled.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/networking-features
2. https://learn.microsoft.com/en-us/cli/azure/webapp
3. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile
Level 1 | Automated
