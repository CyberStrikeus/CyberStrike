---
name: cis-azure-compute-2.2.3
description: "Ensure 'PHP version' is currently supported (if in use)"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, deployment-slots, php, runtime-version, software-support]
cis_id: "2.2.3"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'PHP version' is currently supported (if in use)

## Description

Periodically, older versions of PHP may be deprecated and no longer supported. Using a supported version of PHP for App Service deployment slots is recommended to avoid potential unpatched vulnerabilities.

## Rationale

Deprecated and unsupported versions of programming and scripting languages can present vulnerabilities which may not be addressed or may not be addressable.

## Impact

If your app is written using version-dependent features or libraries, they may not be available on more recent versions. If you wish to update, research the impact thoroughly.

## Audit Procedure

Take note of the currently supported versions of PHP here:
https://www.php.net/supported-versions.php

### Using Azure Portal

1. Go to `App Services`.
2. Click the name of an app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` pane, ensure that for a `Stack` of `PHP`, the `Major version` and `Minor version` reflect a currently supported release.
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

For each deployment slot, run the following command to get the PHP version:

```bash
az resource show --name web --resource-group <resource-group-name> --namespace Microsoft.Web --resource-type config --parent sites/<app-name>/slots/<deployment-slot-name> --query properties.[linuxFxVersion,phpVersion]
```

If PHP is in use, ensure the version is currently supported.

## Expected Result

The PHP version configured for the deployment slot should be a currently supported release as listed on the PHP Supported Versions page.

## Remediation

**Note:** No action is required if PHP is not in use.

### Using Azure Portal

1. Go to `App Services`.
2. Click the name of an app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` pane, for a `Stack` of `PHP`, set the `Major version` and `Minor version` to a currently supported release.
7. Click `Save`.
8. Click `Continue`.
9. Repeat steps 1-8 for each app and deployment slot requiring remediation.

### Using Azure CLI

Run the following command to list supported runtimes:

```bash
az webapp list-runtimes
```

For each deployment slot requiring remediation, run the following command with the appropriate parameters to update the PHP version:

```bash
az resource update --name web --resource-group <resource-group-name> --namespace Microsoft.Web --resource-type config --parent sites/<app-name>/slots/<deployment-slot-name> --set properties.[linuxFxVersion|phpVersion]="<python-runtime-version|python-version>"
```

## Default Value

The version is selected during creation.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/configure-common#general-settings
2. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-posture-vulnerability-management#pv-7-rapidly-and-automatically-remediate-software-vulnerabilities
3. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-posture-vulnerability-management#pv-3-establish-secure-configurations-for-compute-resources
4. https://www.php.net/supported-versions.php
5. https://learn.microsoft.com/en-us/cli/azure/webapp
6. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile

Level 1 | Manual
