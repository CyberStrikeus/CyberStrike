---
name: cis-azure-compute-2.4.2
description: "Ensure 'Python version' is currently supported (if in use)"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, functions, deployment-slots]
cis_id: "2.4.2"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Python version' is currently supported (if in use)

## Description

Periodically, older versions of Python may be deprecated and no longer supported. Using a supported version of Python for function app deployment slots is recommended to avoid potential unpatched vulnerabilities.

## Rationale

Deprecated and unsupported versions of programming and scripting languages can present vulnerabilities which may not be addressed or may not be addressable.

## Impact

If your app is written using version-dependent features or libraries, they may not be available on more recent versions. If you wish to update, research the impact thoroughly.

## Audit Procedure

### Using Azure Portal

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` pane, ensure that for a `Stack` of `Python`, the `Python Version` reflects a currently supported release.
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

For each deployment slot, run the following command to get the Python version:

```bash
az resource show --name web --resource-group <resource-group-name> --namespace Microsoft.Web --resource-type config --parent sites/<function-app-name>/slots/<deployment-slot-name> --query properties.[linuxFxVersion,pythonVersion]
```

If Python is in use, ensure the version is currently supported.

Take note of the currently supported versions (given a status of "security") of Python here: https://devguide.python.org/versions/

## Expected Result

If Python is in use, the Python version should reflect a currently supported release.

## Remediation

### Using Azure Portal

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` pane, for a `Stack` of `Python`, set the `Python Version` to a currently supported release.
7. Click `Save`.
8. Click `Continue`.
9. Repeat steps 1-8 for each function app and deployment slot requiring remediation.

### Using Azure CLI

Run the following command to list supported runtimes:

```bash
az functionapp list-runtimes
```

For each deployment slot requiring remediation, run the following command with the appropriate parameters to update the Python version:

```bash
az resource update --name web --resource-group <resource-group-name> --namespace Microsoft.Web --resource-type config --parent sites/<function-app-name>/slots/<deployment-slot-name> --set properties.linuxFxVersion="PYTHON|<python-version>"
```

## Default Value

The version is selected during creation.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/configure-common#configure-language-stack-settings
2. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-posture-vulnerability-management#pv-7-rapidly-and-automatically-remediate-software-vulnerabilities
3. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-posture-vulnerability-management#pv-3-establish-secure-configurations-for-compute-resources
4. https://devguide.python.org/versions/
5. https://learn.microsoft.com/en-us/cli/azure/functionapp
6. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile

Level 1 | Manual
