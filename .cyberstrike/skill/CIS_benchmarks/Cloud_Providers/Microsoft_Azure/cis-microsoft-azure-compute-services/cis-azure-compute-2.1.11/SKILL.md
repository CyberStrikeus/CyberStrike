---
name: cis-azure-compute-2.1.11
description: "Ensure incoming client certificates are enabled and required (if in use)"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, client-certificates, mutual-tls, authentication]
cis_id: "2.1.11"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure incoming client certificates are enabled and required (if in use)

## Description

Client certificates allow for the app to request a certificate for incoming requests. Only clients that have a valid certificate will be able to reach the app.

## Rationale

The TLS mutual authentication technique in enterprise environments ensures the authenticity of clients to the server. If incoming client certificates are enabled, then only an authenticated client with valid certificates can access the app.

## Impact

Utilizing and maintaining client certificates will require additional work to obtain and manage replacement and key rotation.

**NOTE:** This recommendation cannot be implemented if following the recommendation titled "Ensure 'HTTP Version' is set to '2.0' (if in use)." This recommendation should only be considered for scenarios where HTTP versions prior to 2.0 are required for an app, and mutual certificate authentication is desired for validating clients.

## Audit Procedure

### Using Azure Portal

1. Login to Azure Portal using https://portal.azure.com
2. Go to `App Services`
3. Click on each App
4. Under the Settings section, Click on `Configuration`, then `General settings`
5. Ensure that the option `Client certificate mode` located under Incoming client certificates is set to `Require`

### Using Azure CLI

To check Incoming client certificates value for an existing app, run the following command:

```
az webapp show --resource-group <RESOURCE_GROUP_NAME> --name <APP_NAME> --query clientCertEnabled
```

The output should return `true` if Incoming client certificates value is set to `On`.

### Using Azure PowerShell

List all web apps:

```
Get-AzWebApp
```

For each web app run the following command:

```
Get-AzWebApp -ResourceGroup <app resource group> -Name <app name>
```

Make sure the `ClientCertEnabled` is set to `True`.

## Expected Result

The `clientCertEnabled` setting should return `true` and `Client certificate mode` should be set to `Require`.

## Remediation

### Using Azure Portal

1. Login to Azure Portal using https://portal.azure.com
2. Go to `App Services`
3. Click on each App
4. Under the Settings section, Click on `Configuration`, then `General settings`
5. Set the option `Client certificate mode` located under Incoming client certificates to `Require`

### Using Azure CLI

To set Incoming client certificates value for an existing app, run the following command:

```
az webapp update --resource-group <RESOURCE_GROUP_NAME> --name <APP_NAME> --set clientCertEnabled=true
```

### Using Azure PowerShell

Not specifically documented for this control.

## Default Value

By default, incoming client certificates are disabled.

## References

1. https://docs.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-identity-management#im-4-authenticate-server-and-services
2. https://learn.microsoft.com/en-us/azure/app-service/app-service-web-configure-tls-mutual-auth
3. https://learn.microsoft.com/en-us/cli/azure/webapp
4. https://learn.microsoft.com/en-us/powershell/module/az.websites/get-azwebapp

## Profile

Level 2 | Automated
