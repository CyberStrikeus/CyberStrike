---
name: cis-azure-compute-2.1.3
description: "Ensure 'PHP version' is currently supported (if in use)"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, php, runtime-version, patch-management]
cis_id: "2.1.3"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'PHP version' is currently supported (if in use)

## Description

Periodically, older versions of PHP may be deprecated and no longer supported. Using a supported version of PHP for App Service apps is recommended to avoid potential unpatched vulnerabilities.

## Rationale

Deprecated and unsupported versions of programming and scripting languages can present vulnerabilities which may not be addressed or may not be addressable.

## Impact

If your app is written using version-dependent features or libraries, they may not be available on more recent versions. If you wish to update, research the impact thoroughly.

## Audit Procedure

### Using Azure Portal

1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, ensure that for a `Stack` of `PHP`, the `Major version` and `Minor version` reflect a currently supported release.
5. Repeat steps 1-4 for each app.

### Using Azure CLI

Run the following command to list apps:

```
az webapp list
```

For each app, run the following command to get the PHP version:

```
az webapp config show --resource-group <resource-group-name> --name <app-name> --query "{LinuxFxVersion:linuxFxVersion,PhpVersion:phpVersion}"
```

If PHP is in use, ensure the version is currently supported.

### Using Azure PowerShell

Run the following command to list apps:

```
Get-AzWebApp
```

Run the following command to get the app in a resource group with a given name:

```
$app = Get-AzWebApp -ResourceGroupName <resource-group-name> -Name <app-name>
```

Run the following command to get the PHP version:

```
$app.SiteConfig | select-object LinuxFXVersion, PhpVersion
```

If PHP is in use, ensure the version is currently supported. Repeat for each app.

## Expected Result

The PHP version in use should be a currently supported release as listed at https://www.php.net/supported-versions.php.

## Remediation

### Using Azure Portal

1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, for a `Stack` of `PHP`, set the `Major version` and `Minor version` to a currently supported release.
5. Click `Save`.
6. Click `Continue`.
7. Repeat steps 1-6 for each app requiring remediation.

**Note:** No action is required if PHP is not in use.

### Using Azure CLI

Run the following command to list supported runtimes:

```
az webapp list-runtimes
```

For each app requiring remediation, run the following command with the appropriate parameters to update the PHP version:

```
az webapp config set --resource-group <resource-group-name> --name <app-name> [--linux-fx-version <php-runtime-version>][--php-version <php-version>]
```

### Using Azure PowerShell

For each app requiring remediation, run the following command to update the PHP version:

```
Set-AzWebApp -ResourceGroupName <resource-group-name> -Name <app-name> -phpVersion <php-version>
```

**Note:** Currently, there is no way to update an app's `Linux FX Version` setting using PowerShell.

## Default Value

The version is selected during creation.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/configure-common#general-settings
2. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-posture-vulnerability-management#pv-7-rapidly-and-automatically-remediate-software-vulnerabilities
3. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-posture-vulnerability-management#pv-3-establish-secure-configurations-for-compute-resources
4. https://www.php.net/supported-versions.php
5. https://learn.microsoft.com/en-us/cli/azure/webapp
6. https://learn.microsoft.com/en-us/powershell/module/az.websites/get-azwebapp
7. https://learn.microsoft.com/en-us/powershell/module/az.websites/set-azwebapp

## Profile

Level 1 | Manual
