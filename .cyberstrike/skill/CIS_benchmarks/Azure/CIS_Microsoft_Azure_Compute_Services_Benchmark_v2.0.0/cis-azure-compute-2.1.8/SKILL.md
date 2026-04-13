---
name: cis-azure-compute-2.1.8
description: "Ensure 'Minimum Inbound TLS Version' is set to '1.2' or higher"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, tls, encryption, minimum-tls-version, data-in-transit]
cis_id: "2.1.8"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Minimum Inbound TLS Version' is set to '1.2' or higher

## Description
The TLS (Transport Layer Security) protocol secures the transmission of data over the internet using standard encryption technology. App Service apps use TLS 1.2 for the `Minimum Inbound TLS Version` by default and allow for the use of TLS versions 1.0, 1.1, and 1.3. NIST strongly suggests the use of TLS 1.2 and recommends the adoption of TLS 1.3.

## Rationale
TLS 1.0 and 1.1 are outdated and vulnerable to security risks. Since TLS 1.2 and TLS 1.3 provide enhanced security and improved performance, it is highly recommended to use TLS 1.2 or higher whenever possible.

## Impact
Using the latest TLS version may affect compatibility with clients and backend services.

## Audit Procedure

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, under `Platform settings`, ensure that `Minimum Inbound TLS Version` is set to `1.2` or higher.
5. Repeat steps 1-4 for each app.

### Using Azure CLI
Run the following command to list apps:
```
az webapp list
```

For each app, run the following command to get the TLS version setting:
```
az webapp config show --resource-group <resource-group-name> --name <app-name> --query minTlsVersion
```

Ensure that `"1.2"` or higher is returned.

### Using Azure PowerShell
Run the following command to list apps:
```
Get-AzWebApp
```

Run the following command to get the app in a resource group with a given name:
```
$app = Get-AzWebApp -ResourceGroupName <resource-group-name> -Name <app-name>
```

Run the following command to get the TLS version setting:
```
$app.SiteConfig.MinTlsVersion
```

Ensure that the command returns `1.2` or higher. Repeat for each app.

## Expected Result
The minimum TLS version should be `1.2` or higher.

## Remediation

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, under `Platform settings`, click the drop-down next to `Minimum Inbound TLS Version` and select `1.2` or higher.
5. Click `Save`.
6. Click `Continue`.
7. Repeat steps 1-6 for each app requiring remediation.

### Using Azure CLI
For each app requiring remediation, run the following command to update the TLS version:
```
az webapp config set --resource-group <resource-group-name> --name <app-name> --min-tls-version <1.2|1.3>
```

### Using Azure PowerShell
For each app requiring remediation, run the following command to update the TLS version:
```
Set-AzWebApp -ResourceGroupName <resource-group-name> -Name <app-name> -MinTlsVersion <1.2|1.3>
```

## Default Value
By default, TLS version is set to 1.2.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/configure-ssl-bindings#how-can-i-change-the-minimum-tls-versions-for-the-app
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-3-encrypt-sensitive-data-in-transit
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security#ns-8-detect-and-disable-insecure-services-and-protocols
4. https://learn.microsoft.com/en-us/cli/azure/webapp
5. https://learn.microsoft.com/en-us/powershell/module/az.websites/get-azwebapp
6. https://learn.microsoft.com/en-us/powershell/module/az.websites/set-azwebapp
7. https://csrc.nist.gov/news/2019/nist-publishes-sp-800-52-revision-2

## Profile
Level 1 | Automated
