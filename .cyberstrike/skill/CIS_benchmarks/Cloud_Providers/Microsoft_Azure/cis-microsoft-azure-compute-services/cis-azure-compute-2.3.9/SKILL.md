---
name: cis-azure-compute-2.3.9
description: "Ensure 'Remote debugging' is set to 'Off'"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, function-apps, remote-debugging, attack-surface, security-hardening]
cis_id: "2.3.9"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Remote debugging' is set to 'Off'

## Description

Remote debugging allows a function app to be debugged in real-time directly in the Azure environment. When remote debugging is enabled, it opens a communication channel that could potentially be exploited by unauthorized users if not properly secured.

## Rationale

Disabling remote debugging on a function app is primarily about enhancing security.

Remote debugging opens a communication channel that can be exploited by attackers. By disabling it, you reduce the number of potential entry points for unauthorized access.

If remote debugging is enabled without proper access controls, it can allow unauthorized users to connect to your function app, potentially leading to data breaches or malicious code execution.

During a remote debugging session, sensitive information might be exposed. Disabling remote debugging helps ensure that such data remains secure. This minimizes the use of remote access tools to reduce risk.

## Impact

You will not be able to connect to your function app from a remote location to diagnose and fix issues in real-time. You will not be able to step through code, set breakpoints, or inspect variables and the call stack while the function app is running on the server. Remote debugging is particularly useful for diagnosing issues that only occur in the production environment. Without it, you will need to rely on logs and other diagnostic tools.

## Audit Procedure

### Using Azure Portal

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, under `Debugging`, ensure that `Remote debugging` is set to `Off`.
5. Repeat steps 1-4 for each function app.

### Using Azure CLI

Run the following command to list function apps:

```bash
az functionapp list
```

For each function app, run the following command to get the remote debugging setting:

```bash
az functionapp show --resource-group <resource-group-name> --name <function-app-name> --query siteConfig.remoteDebuggingEnabled
```

Ensure that `false` is returned.

### Using Azure PowerShell

Run the following command to list function apps:

```powershell
Get-AzFunctionApp
```

Run the following command to get the function app in a resource group with a given name:

```powershell
$app = Get-AzFunctionApp -ResourceGroupName <resource-group-name> -Name <function-app-name>
```

Run the following command to get the remote debugging setting:

```powershell
$app.SiteConfig.RemoteDebuggingEnabled
```

Ensure that `False` is returned. Repeat for each function app.

## Expected Result

The remote debugging setting should return `false`.

## Remediation

### Using Azure Portal

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, under `Debugging`, set `Remote debugging` to `Off`.
5. Click `Save`.
6. Click `Continue`.
7. Repeat steps 1-6 for each function app requiring remediation.

### Using Azure CLI

For each function app requiring remediation, run the following command to disable remote debugging:

```bash
az functionapp config set --resource-group <resource-group-name> --name <function-app-name> --remote-debugging-enabled false
```

## Default Value

By default, remote debugging is set to `off`.

## References

1. https://learn.microsoft.com/en-us/visualstudio/debugger/remote-debugging-azure-app-service
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-posture-vulnerability-management#pv-2-audit-and-enforce-secure-configurations
3. https://learn.microsoft.com/en-us/cli/azure/functionapp
4. https://learn.microsoft.com/en-us/powershell/module/az.functions/get-azfunctionapp

## Profile

Level 1 | Automated
