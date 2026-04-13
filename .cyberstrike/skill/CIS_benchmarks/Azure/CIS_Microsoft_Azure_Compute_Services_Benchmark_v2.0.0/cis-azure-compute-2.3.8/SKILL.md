---
name: cis-azure-compute-2.3.8
description: "Ensure end-to-end TLS encryption is enabled"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, function-apps, tls, e2e-encryption, data-in-transit]
cis_id: "2.3.8"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure end-to-end TLS encryption is enabled

## Description
End-to-end (E2E) TLS encryption ensures that front-end to worker communication within function apps is encrypted using TLS. Without this feature, while incoming HTTPS requests are encrypted to the front ends, the traffic from front ends to workers running the application workloads would travel unencrypted inside Azure's infrastructure.

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

For each function app, run the following command to get the end-to-end TLS encryption setting:
```bash
az functionapp show --resource-group <resource-group-name> --name <function-app-name> --query endToEndEncryptionEnabled
```

Ensure that the command returns `true`.

### Using Azure Portal
There is no Azure Portal audit procedure documented for this control. Use the Azure CLI or Azure Policy methods.

## Expected Result
The `endToEndEncryptionEnabled` setting should return `true`.

## Remediation

### Using Azure CLI
For each function app requiring remediation, run the following command to enable end-to-end TLS encryption:
```bash
az resource update --resource-group <resource-group-name> --name <function-app-name> --resource-type "Microsoft.Web/sites" --set properties.endToEndEncryptionEnabled=true
```

### Using Azure Portal
There is no Azure Portal remediation procedure documented for this control. Use the Azure CLI method.

## Default Value
By default, end-to-end TLS encryption is disabled.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/overview-tls#end-to-end-tls-encryption
2. https://learn.microsoft.com/en-us/cli/azure/functionapp
3. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile
Level 1 | Automated
