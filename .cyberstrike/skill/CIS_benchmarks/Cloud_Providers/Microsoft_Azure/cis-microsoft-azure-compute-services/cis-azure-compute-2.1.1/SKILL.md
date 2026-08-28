---
name: cis-azure-compute-2.1.1
description: "Ensure 'Java version' is currently supported (if in use)"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, java, runtime-version, patch-management]
cis_id: "2.1.1"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Java version' is currently supported (if in use)

## Description

Periodically, older versions of Java may be deprecated and no longer supported. Using a supported version of Java for App Service apps is recommended to avoid potential unpatched vulnerabilities.

## Rationale

Deprecated and unsupported versions of programming and scripting languages can present vulnerabilities which may not be addressed or may not be addressable.

## Impact

If your app is written using version-dependent features or libraries, they may not be available on more recent versions. If you wish to update, research the impact thoroughly.

## Audit Procedure

### Using Azure Portal

1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, ensure that for a `Stack` of `Java`, the `Major Version` and `Minor Version` reflect a currently supported release, and that the `Java web server version` is set to the `auto-update` option.
5. Repeat steps 1-4 for each app.

**NOTE:** No action is required if `Java version` is set to `Off`, as Java is not used by your app.

### Using Azure CLI

Run the following command to list apps:

```
az webapp list
```

For each app, run the following command to check the Java version:

```
az webapp config show --resource-group <resource-group-name> --name <app-name> --query "{LinuxFxVersion:linuxFxVersion, WindowsFxVersion:windowsFxVersion, JavaVersion:javaVersion, JavaContainerVersion:javaContainerVersion, JavaContainer:javaContainer}"
```

If Java is in use, ensure the version is currently supported.

### Using Azure PowerShell

For each application, store the application information within an object, and then interrogate the `SiteConfig` information for that application object:

```
$app = Get-AzWebApp -Name <app-name> -ResourceGroup <resource-group-name>

$app.SiteConfig |Select-Object LinuxFXVersion, WindowsFxVersion, JavaVersion, JavaContainerVersion, JavaContainer
```

If Java is in use, ensure the version is currently supported.

## Expected Result

The Java version in use should be a currently supported release as listed at https://www.oracle.com/java/technologies/java-se-support-roadmap.html.

## Remediation

### Using Azure Portal

1. Login to Azure Portal using https://portal.azure.com
2. Go to `App Services`
3. Click on each App
4. Under `Settings` section, click on `Configuration`
5. Click on the `General settings` pane and ensure that for a `Stack` of `Java` the `Major Version` and `Minor Version` reflect a currently supported release, and that the `Java web server version` is set to the `auto-update` option.

**NOTE:** No action is required if `Java version` is set to `Off`, as Java is not used by your app.

### Using Azure CLI

To see the list of supported runtimes:

```
az webapp list-runtimes
```

To set a currently supported Java version for an existing app, run the following command:

```
az webapp config set --resource-group <RESOURCE_GROUP_NAME> --name <APP_NAME> [--java-version <JAVA_VERSION> --java-container <JAVA_CONTAINER> --java-container-version <JAVA_CONTAINER_VERSION> [--windows-fx-version <JAVA_RUNTIME_VERSION>] [--linux-fx-version <JAVA_RUNTIME_VERSION>]
```

If creating a new application to use a currently supported version of Java, run the following commands.

To create an app service plan:

```
az appservice plan create --resource-group <RESOURCE_GROUP_NAME> --name <PLAN_NAME> --location <LOCATION> [--is-linux --number-of-workers <INT> --sku <PRICING_TIER>] [--hyper-v --sku <PRICING_TIER>]
```

Get the app service plan ID:

```
az appservice plan list --query "[].{Name:name, ID:id, SKU:sku, Location:location}"
```

To create a new Java web application using the retrieved app service ID:

```
az webapp create --resource-group <RESOURCE_GROUP_NAME> --plan <APP_SERVICE_PLAN_ID> --name <app name> [--linux-fx-version <JAVA_RUNTIME_VERSION>] [--windows-fx-version <JAVA_RUNTIME_VERSION>]
```

### Using Azure PowerShell

As of this writing, there is no way to update an existing application's `SiteConfig` or set a new application's `SiteConfig` settings during creation via PowerShell.

## Default Value

The version is selected during creation.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/configure-language-java-deploy-run
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-posture-vulnerability-management#pv-3-define-and-establish-secure-configurations-for-compute-resources
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-posture-vulnerability-management#pv-6-rapidly-and-automatically-remediate-vulnerabilities
4. https://www.oracle.com/java/technologies/java-se-support-roadmap.html
5. https://learn.microsoft.com/en-us/cli/azure/webapp

## Profile

Level 1 | Manual
