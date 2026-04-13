---
name: cis-azure-foundations-7.13
description: "Ensure 'HTTP2' is set to 'Enabled' on Azure Application Gateway"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, networking, application-gateway]
cis_id: "7.13"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-7.10, cis-azure-foundations-7.12]
prerequisites: []
severity_boost: {}
---

# Ensure 'HTTP2' is set to 'Enabled' on Azure Application Gateway

## Description

Enable HTTP/2 for improved performance, efficiency, and security.

HTTP/2 protocol support is available to clients that connect to application gateway listeners only. Communication with backend server pools is always HTTP/1.1.

## Rationale

Enabling HTTP/2 supports use of modern encrypted connections.

## Impact

Clients and backend services that do not support HTTP/2 will fall back to HTTP/1.1.

## Audit Procedure

### Using Azure Portal

1. Go to `Application gateways`.
2. Click the name of an application gateway.
3. Under `Settings`, click `Configuration`.
4. Ensure `HTTP2` is set to `Enabled`.
5. Repeat steps 1-4 for each application gateway.

### Using Azure CLI

Run the following command to list application gateways:

```bash
az network application-gateway list
```

For each application gateway, run the following command to get the HTTP2 setting:

```bash
az network application-gateway show --resource-group <resource-group> --name <application-gateway> --query enableHttp2
```

Ensure `true` is returned.

### Using PowerShell

Run the following command to list application gateways:

```powershell
Get-AzApplicationGateway
```

Run the following command to get the application gateway in a resource group with a given name:

```powershell
$gateway = Get-AzApplicationGateway -ResourceGroupName <resource-group> -Name <application-gateway>
```

Run the following command to get the HTTP2 setting:

```powershell
$gateway.EnableHttp2
```

Ensure `True` is returned.

Repeat for each application gateway.

## Expected Result

All Application Gateways should have HTTP2 set to `Enabled` (enableHttp2 = true).

## Remediation

### Remediate from Azure Portal

1. Go to `Application gateways`.
2. Click the name of an application gateway.
3. Under `Settings`, click `Configuration`.
4. Under `HTTP2`, click `Enabled`.
5. Click `Save`.
6. Repeat steps 1-5 for each application gateway requiring remediation.

### Remediate from Azure CLI

For each application gateway requiring remediation, run the following command to enable HTTP2:

```bash
az network application-gateway update --resource-group <resource-group> --name <application-gateway> --http2 Enabled
```

### Remediate from PowerShell

Run the following command to get the application gateway in a resource group with a given name:

```powershell
$gateway = Get-AzApplicationGateway -ResourceGroupName <resource-group> -Name <application-gateway>
```

Run the following command to enable HTTP2:

```powershell
$gateway.EnableHttp2 = $true
```

Run the following command to apply the update:

```powershell
Set-AzApplicationGateway -ApplicationGateway $gateway
```

Repeat for each application gateway requiring remediation.

## Default Value

HTTP2 is enabled by default.

## References

1. https://learn.microsoft.com/en-us/azure/application-gateway/features#websocket-and-http2-traffic
2. https://learn.microsoft.com/en-us/cli/azure/network/application-gateway
3. https://learn.microsoft.com/en-us/powershell/module/az.network/get-azapplicationgateway
4. https://learn.microsoft.com/en-us/powershell/module/az.network/set-azapplicationgateway

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 2.2 Ensure Authorized Software is Currently Supported | x | x | x |
| v7 | 2.2 Ensure Software is Supported by Vendor | x | x | x |

## Profile

Level 1 | Automated
