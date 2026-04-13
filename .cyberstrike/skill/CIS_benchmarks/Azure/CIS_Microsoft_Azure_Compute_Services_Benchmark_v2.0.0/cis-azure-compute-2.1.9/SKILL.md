---
name: cis-azure-compute-2.1.9
description: "Ensure end-to-end TLS encryption is enabled"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service, tls, e2e-encryption, data-in-transit]
cis_id: "2.1.9"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure end-to-end TLS encryption is enabled

## Description
End-to-end (E2E) TLS encryption ensures that front-end to worker communication within App Service apps is encrypted using TLS. Without this feature, while incoming HTTPS requests are encrypted to the front ends, the traffic from front ends to workers running the application workloads would travel unencrypted inside Azure's infrastructure.

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
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, under `Platform settings`, ensure that `Enable end-to-end TLS encryption` is set to `On`.
5. Repeat steps 1-4 for each app.

### Using Azure CLI
Run the following command to list apps:
```
az webapp list
```

For each app, run the following command to get the end-to-end TLS encryption setting:
```
az webapp show --resource-group <resource-group-name> --name <app-name> --query endToEndEncryptionEnabled
```

Ensure that the command returns `true`.

### Using Azure PowerShell
Not specifically documented for this control.

## Expected Result
The `endToEndEncryptionEnabled` setting should return `true`.

## Remediation

### Using Azure Portal
1. Go to `App Services`.
2. Click the name of an app.
3. Under `Settings`, click `Configuration`.
4. In the `General settings` pane, under `Platform settings`, next to `Enable end-to-end TLS encryption`, click the radio button next to `On`.
5. Click `Save`.
6. Click `Continue`.
7. Repeat steps 1-6 for each app requiring remediation.

### Using Azure CLI
For each app requiring remediation, run the following command to enable end-to-end TLS encryption:
```
az resource update --resource-group <resource-group-name> --name <app-name> --resource-type "Microsoft.Web/sites" --set properties.endToEndEncryptionEnabled=true
```

### Using Azure PowerShell
Not specifically documented for this control.

## Default Value
By default, end-to-end TLS encryption is disabled.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/overview-tls#end-to-end-tls-encryption
2. https://learn.microsoft.com/en-us/cli/azure/webapp
3. https://learn.microsoft.com/en-us/cli/azure/resource

## Profile
Level 1 | Automated
