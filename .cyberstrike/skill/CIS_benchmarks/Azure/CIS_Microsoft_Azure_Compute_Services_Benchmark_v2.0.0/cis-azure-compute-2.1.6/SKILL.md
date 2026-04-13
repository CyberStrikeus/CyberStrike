---
name: cis-azure-compute-2.1.6
description: "Ensure 'HTTP version' is set to '2.0' (if in use)"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, http, http2, protocol-version]
cis_id: "2.1.6"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'HTTP version' is set to '2.0' (if in use)

## Description

Periodically, newer versions are released for HTTP, either due to security flaws or to include additional functionalities. Using the latest HTTP version allows apps to take advantage of security fixes, if any, and/or new functionalities of the newer version.

## Rationale

Newer versions may contain security enhancements and additional functionalities. Using the latest version is recommended in order to take advantage of enhancements and new capabilities. With each software installation, organizations need to determine if a given update meets their requirements. They must also verify the compatibility and support provided for any additional software against the update revision that is selected.

HTTP 2.0 has additional performance improvements for the head-of-line blocking problem of the old HTTP version, header compression, and request prioritization. HTTP 2.0 no longer supports HTTP 1.1's chunked transfer encoding mechanism, as it provides its own, more efficient mechanisms for data streaming.

## Impact

Most modern browsers support the HTTP/2 protocol over TLS only, while non-encrypted traffic continues to use HTTP/1.1. To ensure that client browsers connect to your app with HTTP/2, either purchase an App Service Certificate for your app's custom domain or bind a third-party certificate.

**NOTE:** HTTP/2 cannot be used in tandem with mutual authentication or client certificates.

## Audit Procedure

### Using Azure Portal

1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, under `Platform settings`, ensure that `HTTP version` is set to `2.0`.
5. Repeat steps 1-4 for each app.

### Using Azure CLI

Run the following command to list apps:

```
az webapp list
```

For each app, run the following command to get the `http20Enabled` setting:

```
az webapp config show --resource-group <resource-group-name> --name <app-name> --query http20Enabled
```

Ensure that `true` is returned.

### Using Azure PowerShell

Run the following command to list apps:

```
Get-AzWebApp
```

Run the following command to get the app in a resource group with a given name:

```
$app = Get-AzWebApp -ResourceGroupName <resource-group-name> -Name <app-name>
```

Run the following command to get the `Http20Enabled` setting:

```
$app.SiteConfig.Http20Enabled
```

Ensure that `True` is returned. Repeat for each app.

## Expected Result

The `http20Enabled` setting should return `true`.

## Remediation

### Using Azure Portal

1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, under `Platform settings`, set `HTTP version` to `2.0`.
5. Click `Save`.
6. Click `Continue`.
7. Repeat steps 1-6 for each app requiring remediation.

### Using Azure CLI

For each app requiring remediation, run the following command to enable `http20Enabled`:

```
az webapp config set --resource-group <resource-group-name> --name <app-name> --http20-enabled true
```

### Using Azure PowerShell

Not specifically documented for this control.

## Default Value

By default, `HTTP version` is set to `1.1`.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/configure-common#general-settings
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-posture-vulnerability-management#pv-3-define-and-establish-secure-configurations-for-compute-resources
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-posture-vulnerability-management#pv-6-rapidly-and-automatically-remediate-vulnerabilities
4. https://learn.microsoft.com/en-us/cli/azure/webapp
5. https://learn.microsoft.com/en-us/powershell/module/az.websites/get-azwebapp

## Profile

Level 1 | Automated
