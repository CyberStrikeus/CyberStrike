---
name: cis-azure-compute-2.4.10
description: "Ensure incoming client certificates are enabled and required (if in use)"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, functions, deployment-slots]
cis_id: "2.4.10"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure incoming client certificates are enabled and required (if in use)

## Description

Client certificates allow for the deployment slot to request a certificate for incoming requests. Only clients that have a valid certificate will be able to reach the deployment slot.

This recommendation applies to function apps using the Consumption, Premium, or Dedicated (App Service) plans, which support deployment slots.

## Rationale

The TLS mutual authentication technique in enterprise environments ensures the authenticity of clients to the server. If incoming client certificates are enabled, then only an authenticated client with valid certificates can access the deployment slot.

## Impact

Utilizing and maintaining client certificates will require additional work to obtain and manage replacement and key rotation.

NOTE: This recommendation cannot be implemented if following the recommendation titled "Ensure 'HTTP version' is set to '2.0' (if in use)." This recommendation should only be considered for scenarios where HTTP versions prior to 2.0 are required for a deployment slot, and mutual certificate authentication is desired for validating clients.

## Audit Procedure

### Using Azure Portal

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` pane, under `Incoming client certificates`, ensure that `Client certificate mode` is set to `Required`.
7. Repeat steps 1-6 for each function app and deployment slot.

### Using Azure CLI

Run the following command to list function apps:

```bash
az functionapp list
```

For each function app, run the following command to list deployment slots:

```bash
az functionapp deployment slot list --resource-group <resource-group-name> --name <function-app-name>
```

For each deployment slot, ensure that `clientCertEnabled` is set to `true`, and `clientCertMode` is set to `Required`.

## Expected Result

The `clientCertEnabled` should be `true` and `clientCertMode` should be `Required`.

## Remediation

### Using Azure Portal

1. Go to `App Services` or `Function App`.
2. Click the name of a function app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` pane, under `Incoming client certificates`, set `Client certificate mode` to `Required`.
7. Click `Save`.
8. Click `Continue`.
9. Repeat steps 1-8 for each function app and deployment slot requiring remediation.

### Using Azure CLI

For each deployment slot requiring remediation, run the following command to enable and require incoming client certificates:

```bash
az resource update --resource-group <resource-group-name> --name <function-app-name>/slots/<deployment-slot-name> --resource-type "Microsoft.Web/sites" --set properties.clientCertEnabled=true --set properties.clientCertMode=Required
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
