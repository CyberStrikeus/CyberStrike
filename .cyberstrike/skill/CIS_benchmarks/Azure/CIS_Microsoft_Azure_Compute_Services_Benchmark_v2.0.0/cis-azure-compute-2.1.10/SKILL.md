---
name: cis-azure-compute-2.1.10
description: "Ensure 'Remote debugging' is set to 'Off'"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, remote-debugging, attack-surface, security-hardening]
cis_id: "2.1.10"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Remote debugging' is set to 'Off'

## Description
Remote debugging allows an App Service app to be debugged in real-time directly in the Azure environment. When remote debugging is enabled, it opens a communication channel that could potentially be exploited by unauthorized users if not properly secured.

## Rationale
Disabling remote debugging on an App Service app is primarily about enhancing security.

Remote debugging opens a communication channel that can be exploited by attackers. By disabling it, you reduce the number of potential entry points for unauthorized access.

If remote debugging is enabled without proper access controls, it can allow unauthorized users to connect to your application, potentially leading to data breaches or malicious code execution.

During a remote debugging session, sensitive information might be exposed. Disabling remote debugging helps ensure that such data remains secure. This minimizes the use of remote access tools to reduce risk.

## Impact
You will not be able to connect to your application from a remote location to diagnose and fix issues in real-time. You will not be able to step through code, set breakpoints, or inspect variables and the call stack while the application is running on the server. Remote debugging is particularly useful for diagnosing issues that only occur in the production environment. Without it, you will need to rely on logs and other diagnostic tools.

## Audit Procedure

### Using Azure Portal
1. Login to Azure Portal using https://portal.azure.com
2. Go to `App Services`
3. Click on each App
4. Under `Setting` section, Click on `Configuration`
5. Under the `General settings` tab, check the `Remote debugging` option. Ensure it is set to `Off`.

### Using Azure CLI
To check remote debugging status for an existing app, run the following command:
```
az webapp config show --resource-group <resource_group_name> --name <app_name> --query remoteDebuggingEnabled
```

The output should be `false` if remote debugging is disabled.

### Using Azure PowerShell
To check remote debugging status for an existing app, run the following command:
```
Get-AzWebApp -ResourceGroupName <resource_group_name> -Name <app_name> |Select-Object -ExpandProperty SiteConfig
```

The output of `remoteDebuggingEnabled` should be `false` if remote debugging is disabled.

## Expected Result
The `remoteDebuggingEnabled` setting should return `false`.

## Remediation

### Using Azure Portal
1. Login to Azure Portal using https://portal.azure.com
2. Go to `App Services`
3. Click on each App
4. Under `Setting` section, Click on `Configuration`
5. Under the `General settings` tab, set the `Remote debugging` option to `Off`.

### Using Azure CLI
To set remote debugging status to off, run the following command:
```
az webapp config set --resource-group <resource_group_name> --name <app_name> --remote-debugging-enabled false
```

### Using Azure PowerShell
To set remote debugging status to off, run the following command:
```
Set-AzWebApp -ResourceGroupName <resource_group_name> -Name <app_name> -RemoteDebuggingEnabled $false
```

## Default Value
By default, remote debugging is set to `off`.

## References
1. https://learn.microsoft.com/en-us/visualstudio/debugger/remote-debugging-azure-app-service
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-posture-vulnerability-management#pv-2-audit-and-enforce-secure-configurations
3. https://learn.microsoft.com/en-us/cli/azure/webapp
4. https://learn.microsoft.com/en-us/powershell/module/az.websites/get-azwebapp
5. https://learn.microsoft.com/en-us/powershell/module/az.websites/set-azwebapp

## Profile
Level 1 | Automated
