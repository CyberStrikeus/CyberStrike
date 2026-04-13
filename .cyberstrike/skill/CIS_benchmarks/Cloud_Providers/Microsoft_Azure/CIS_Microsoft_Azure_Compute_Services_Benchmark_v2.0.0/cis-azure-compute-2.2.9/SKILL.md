---
name: cis-azure-compute-2.2.9
description: "Ensure end-to-end TLS encryption is enabled"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, deployment-slots, tls, e2e-encryption, data-in-transit]
cis_id: "2.2.9"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure end-to-end TLS encryption is enabled

## Description

End-to-end (E2E) TLS encryption ensures that front-end to worker communication within App Service deployment slots is encrypted using TLS. Without this feature, while incoming HTTPS requests are encrypted to the front ends, the traffic from front ends to workers running the application workloads would travel unencrypted inside Azure's infrastructure.

## Rationale

E2E TLS helps ensure full encryption of traffic between:

- Clients and front ends
- Front ends and worker processes hosting the application

## Impact

Enabling end-to-end TLS encryption may introduce minimal latency and require additional configuration of certificates and HTTPS settings to ensure compatibility.

## Audit Procedure

### Using Azure Portal

1. Go to `App Services`.
2. Click the name of an app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` pane, under `Platform settings`, ensure that `Enable end-to-end TLS encryption` is set to `On`.
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

For each deployment slot, ensure that `endToEndEncryptionEnabled` is set to `true`.

## Expected Result

The `endToEndEncryptionEnabled` property should be set to `true`.

## Remediation

### Using Azure Portal

1. Go to `App Services`.
2. Click the name of an app.
3. Under `Deployment`, click `Deployment slots`.
4. Click the name of a deployment slot.
5. Under `Settings`, click `Configuration`.
6. In the `General settings` pane, under `Platform settings`, next to `Enable end-to-end TLS encryption`, click the radio button next to `On`.
7. Click `Save`.
8. Click `Continue`.
9. Repeat steps 1-8 for each app and deployment slot requiring remediation.

### Using Azure CLI

For each deployment slot requiring remediation, run the following command to enable end-to-end TLS encryption:

```bash
az resource update --resource-group <resource-group-name> --name <app-name>/slots/<deployment-slot-name> --resource-type "Microsoft.Web/sites" --set properties.endToEndEncryptionEnabled=true
```

## Default Value

By default, end-to-end TLS encryption is disabled.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/overview-tls#end-to-end-tls-encryption
2. https://learn.microsoft.com/en-us/cli/azure/webapp
3. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile

Level 1 | Automated
