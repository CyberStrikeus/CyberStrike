---
name: cis-azure-compute-2.3.1
description: "Ensure 'Java version' is currently supported (if in use)"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, function-apps, java, runtime-version, software-lifecycle]
cis_id: "2.3.1"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Java version' is currently supported (if in use)

## Description
Periodically, older versions of Java may be deprecated and no longer supported. Using a supported version of Java for function apps is recommended to avoid potential unpatched vulnerabilities.

## Rationale
Deprecated and unsupported versions of programming and scripting languages can present vulnerabilities which may not be addressed or may not be addressable.

## Impact
If your app is written using version-dependent features or libraries, they may not be available on more recent versions. If you wish to update, research the impact thoroughly.

## Audit Procedure

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, ensure that for a `Stack` of `Java`, the `Java Version` reflects a currently supported release.
5. Repeat steps 1-4 for each function app.

### Using Azure CLI
Run the following command to list function apps:
```bash
az functionapp list
```

For each function app, run the following command to get the Java version:
```bash
az functionapp show --resource-group <resource-group-name> --name <function-app-name> --query siteConfig.[javaContainer,javaContainerVersion,javaVersion,linuxFxVersion]
```

If Java is in use, ensure the version is currently supported.

### Using Azure PowerShell
Run the following command to list function apps:
```powershell
Get-AzFunctionApp
```

Run the following command to get the function app in a resource group with a given name:
```powershell
$app = Get-AzFunctionApp -ResourceGroupName <resource-group-name> -Name <function-app-name>
```

Run the following command to get the Java version:
```powershell
$app.SiteConfig | Select-Object JavaContainer, JavaContainerVersion, JavaVersion, LinuxFXVersion, WindowsFxVersion
```

If Java is in use, ensure the version is currently supported. Repeat for each function app.

Take note of currently supported versions of Java here:
https://www.oracle.com/java/technologies/java-se-support-roadmap.html

## Expected Result
If Java is in use, the Java version should reflect a currently supported release.

## Remediation

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, for a `Stack` of `Java`, set the `Java Version` to a currently supported release.
5. Click `Save`.
6. Click `Continue`.
7. Repeat steps 1-6 for each function app requiring remediation.

**Note:** No action is required if Java is not in use.

### Using Azure CLI
Run the following command to list supported runtimes:
```bash
az functionapp list-runtimes
```

For each function app requiring remediation, run the following command with the appropriate parameters to update the Java version:
```bash
az functionapp config set --resource-group <resource-group-name> --name <function-app-name> [--java-container <java-container> --java-container-version <java-container-version> --java-version <java-version>] [--linux-fx-version <java-runtime-version>]
```

## Default Value
The version is selected during creation.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/configure-language-java-deploy-run
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-posture-vulnerability-management#pv-3-define-and-establish-secure-configurations-for-compute-resources
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-posture-vulnerability-management#pv-6-rapidly-and-automatically-remediate-vulnerabilities
4. https://www.oracle.com/java/technologies/java-se-support-roadmap.html
5. https://learn.microsoft.com/en-us/cli/azure/functionapp
6. https://learn.microsoft.com/en-us/powershell/module/az.functions/get-azfunctionapp

## Profile
Level 1 | Manual
