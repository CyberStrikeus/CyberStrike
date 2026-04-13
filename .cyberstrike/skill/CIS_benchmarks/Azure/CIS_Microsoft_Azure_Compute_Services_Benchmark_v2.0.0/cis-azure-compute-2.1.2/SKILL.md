---
name: cis-azure-compute-2.1.2
description: "Ensure 'Python version' is currently supported (if in use)"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, python, runtime-version, patch-management]
cis_id: "2.1.2"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Python version' is currently supported (if in use)

## Description
Periodically, older versions of Python may be deprecated and no longer supported. Using a supported version of Python for App Service apps is recommended to avoid potential unpatched vulnerabilities.

## Rationale
Deprecated and unsupported versions of programming and scripting languages can present vulnerabilities which may not be addressed or may not be addressable.

## Impact
If your app is written using version-dependent features or libraries, they may not be available on more recent versions. If you wish to update, research the impact thoroughly.

## Audit Procedure

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, ensure that for a `Stack` of `Python`, the `Major version` and `Minor version` reflect a currently supported release.
5. Repeat steps 1-4 for each app.

### Using Azure CLI
Run the following command to list apps:
```
az webapp list
```

For each app, run the following command to get the Python version:
```
az webapp config show --resource-group <resource-group-name> --name <app-name> --query "{LinuxFxVersion:linuxFxVersion,WindowsFxVersion:windowsFxVersion,PythonVersion:pythonVersion}"
```

If Python is in use, ensure the version is currently supported.

### Using Azure PowerShell
```
$app = Get-AzWebApp -Name <app-name> -ResourceGroup <resource-group-name>
$app.SiteConfig |Select-Object LinuxFXVersion, WindowsFxVersion, PythonVersion
```

If Python is in use, ensure the version is currently supported.

## Expected Result
The Python version in use should have a status of "security" or higher as listed at https://devguide.python.org/versions/.

## Remediation

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, for a `Stack` of `Python`, set the `Major version` and `Minor version` to a currently supported release.
5. Click `Save`.
6. Click `Continue`.
7. Repeat steps 1-6 for each app requiring remediation.

**Note:** No action is required if Python is not in use.

### Using Azure CLI
Run the following command to list supported runtimes:
```
az webapp list-runtimes
```

For each app requiring remediation, run the following command with the appropriate parameters to update the Python version:
```
az webapp config set --resource-group <resource-group-name> --name <app-name> [--windows-fx-version "PYTHON|<version>"] [--linux-fx-version "PYTHON|<version>"]
```

### Using Azure PowerShell
Not applicable for Python version updates via PowerShell at this time.

## Default Value
The version is selected during creation.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/configure-common#configure-language-stack-settings
2. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-posture-vulnerability-management#pv-7-rapidly-and-automatically-remediate-software-vulnerabilities
3. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-posture-vulnerability-management#pv-3-establish-secure-configurations-for-compute-resources
4. https://devguide.python.org/versions/
5. https://learn.microsoft.com/en-us/cli/azure/webapp
6. https://learn.microsoft.com/en-us/powershell/module/az.websites/get-azwebapp

## Profile
Level 1 | Manual
