---
name: cis-azure-compute-2.2.1
description: "Ensure 'Java version' is currently supported (if in use)"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, deployment-slots, java, runtime-version, software-support]
cis_id: "2.2.1"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Java version' is currently supported (if in use)

## Description

Periodically, older versions of Java may be deprecated and no longer supported. Using a supported version of Java for App Service deployment slots is recommended to avoid potential unpatched vulnerabilities.

## Rationale

Deprecated and unsupported versions of programming and scripting languages can present vulnerabilities which may not be addressed or may not be addressable.

## Impact

If your app is written using version-dependent features or libraries, they may not be available on more recent versions. If you wish to update, research the impact thoroughly.

## Audit Procedure

Take note of currently supported versions of Java here:
https://www.oracle.com/java/technologies/java-se-support-roadmap.html

### Using Azure Portal

1. Go to `App Services`.
2. Click the name of an app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` pane, ensure that for a `Stack` of `Java`, the `Major version` reflects a currently supported release, and that the `Java web server version` is set to the `auto-update` option.
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

For each deployment slot, run the following command to get the Java version:

```bash
az resource show --name web --resource-group <resource-group-name> --namespace Microsoft.Web --resource-type config --parent sites/<app-name>/slots/<deployment-slot-name> --query properties.[javaContainer,javaContainerVersion,javaVersion,linuxFxVersion,windowsFxVersion]
```

If Java is in use, ensure the version is currently supported.

## Expected Result

The Java version configured for the deployment slot should be a currently supported release as listed on the Oracle Java SE Support Roadmap. The `Java web server version` should be set to `auto-update`.

## Remediation

**Note:** No action is required if Java is not in use.

### Using Azure Portal

1. Go to `App Services`.
2. Click the name of an app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` pane, for a `Stack` of `Java`, set the `Major version` to a currently supported release, and set the `Java web server version` to the `auto-update` option.
7. Click `Save`.
8. Click `Continue`.
9. Repeat steps 1-8 for each app and deployment slot requiring remediation.

### Using Azure CLI

Run the following command to list supported runtimes:

```bash
az webapp list-runtimes
```

For each deployment slot requiring remediation, run the following command with the appropriate parameters to update the Java version:

```bash
az resource update --name web --resource-group <resource-group-name> --namespace Microsoft.Web --resource-type config --parent sites/<app-name>/slots/<deployment-slot-name> --set properties.[javaContainer|javaContainerVersion|javaVersion|linuxFxVersion|windowsFxVersion]="<java-container|java-container-version|java-version|java-runtime-version>"
```

## Default Value

The version is selected during creation.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/configure-language-java-deploy-run
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-posture-vulnerability-management#pv-3-define-and-establish-secure-configurations-for-compute-resources
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-posture-vulnerability-management#pv-6-rapidly-and-automatically-remediate-vulnerabilities
4. https://www.oracle.com/java/technologies/java-se-support-roadmap.html
5. https://learn.microsoft.com/en-us/cli/azure/webapp
6. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile

Level 1 | Manual
