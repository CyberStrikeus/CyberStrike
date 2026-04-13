---
name: cis-azure-compute-2.3.10
description: "Ensure incoming client certificates are enabled and required (if in use)"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, function-apps, client-certificates, mutual-tls, authentication]
cis_id: "2.3.10"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure incoming client certificates are enabled and required (if in use)

## Description
Client certificates allow for the function app to request a certificate for incoming requests. Only clients that have a valid certificate will be able to reach the app.

## Rationale
The TLS mutual authentication technique in enterprise environments ensures the authenticity of clients to the server. If incoming client certificates are enabled, then only an authenticated client with valid certificates can access the app.

## Impact
Utilizing and maintaining client certificates will require additional work to obtain and manage replacement and key rotation.

**NOTE:** This recommendation cannot be implemented if following the recommendation titled "Ensure 'HTTP Version' is set to '2.0' (if in use)." This recommendation should only be considered for scenarios where HTTP versions prior to 2.0 are required for an app, and mutual certificate authentication is desired for validating clients.

## Audit Procedure

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, under `Incoming client certificates`, ensure that `Client certificate mode` is set to `Required`.
5. Repeat steps 1-4 for each function app.

### Using Azure CLI
Run the following command to list function apps:
```bash
az functionapp list
```

For each function app, run the following command to get the `clientCertEnabled` and `clientCertMode` settings:
```bash
az functionapp show --resource-group <resource-group-name> --name <function-app-name> --query "[clientCertEnabled, clientCertMode]"
```

Ensure that `[true,"Required"]` is returned.

## Expected Result
Client certificate mode should be enabled and set to `Required` (`[true,"Required"]`).

## Remediation

### Using Azure Portal
1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, under `Incoming client certificates`, set `Client certificate mode` to `Required`.
5. Click `Save`.
6. Click `Continue`.
7. Repeat steps 1-6 for each function app requiring remediation.

### Using Azure CLI
For each function app requiring remediation, run the following command to enable and require incoming client certificates:
```bash
az resource update --resource-group <resource-group-name> --name <function-app-name> --resource-type "Microsoft.Web/sites" --set properties.clientCertEnabled=true --set properties.clientCertMode=Required
```

## Default Value
By default, incoming client certificates are disabled.

## References
1. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-identity-management#im-4-authenticate-server-and-services
2. https://learn.microsoft.com/en-gb/azure/app-service/app-service-web-configure-tls-mutual-auth
3. https://learn.microsoft.com/en-us/cli/azure/functionapp
4. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile
Level 2 | Automated
