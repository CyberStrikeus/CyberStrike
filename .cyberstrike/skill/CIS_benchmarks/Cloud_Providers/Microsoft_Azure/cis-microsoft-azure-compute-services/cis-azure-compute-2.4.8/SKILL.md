---
name: cis-azure-compute-2.4.8
description: "Ensure end-to-end TLS encryption is enabled"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, functions, deployment-slots]
cis_id: "2.4.8"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure end-to-end TLS encryption is enabled

## Description

End-to-end (E2E) TLS encryption ensures that front-end to worker communication within function app deployment slots is encrypted using TLS. Without this feature, while incoming HTTPS requests are encrypted to the front ends, the traffic from front ends to workers running the application workloads would travel unencrypted inside Azure's infrastructure.

This recommendation applies to function apps using the Consumption, Premium, or Dedicated (App Service) plans, which support deployment slots.

## Rationale

E2E TLS helps ensure full encryption of traffic between:

- Clients and front ends
- Front ends and worker processes hosting the application

## Impact

Enabling end-to-end TLS encryption may introduce minimal latency and require additional configuration of certificates and HTTPS settings to ensure compatibility.

## Audit Procedure

### Using Azure CLI

Run the following command to list function apps:

```bash
az functionapp list
```

For each function app, run the following command to list deployment slots:

```bash
az functionapp deployment slot list --resource-group <resource-group-name> --name <function-app-name>
```

For each deployment slot, ensure that `endToEndEncryptionEnabled` is set to `true`.

## Expected Result

The `endToEndEncryptionEnabled` property should be set to `true`.

## Remediation

### Using Azure CLI

For each deployment slot requiring remediation, run the following command to enable end-to-end TLS encryption:

```bash
az resource update --resource-group <resource-group-name> --name <function-app-name>/slots/<deployment-slot-name> --resource-type "Microsoft.Web/sites" --set properties.endToEndEncryptionEnabled=true
```

## Default Value

By default, end-to-end TLS encryption is disabled.

## References

1. https://learn.microsoft.com/en-us/azure/app-service/overview-tls#end-to-end-tls-encryption
2. https://learn.microsoft.com/en-us/cli/azure/functionapp
3. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile

Level 1 | Automated
