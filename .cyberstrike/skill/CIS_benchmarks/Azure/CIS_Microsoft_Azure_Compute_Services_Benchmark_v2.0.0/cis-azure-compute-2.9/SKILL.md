---
name: cis-azure-compute-2.9
description: "Ensure App Service Environment has TLS 1.0 and 1.1 disabled"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service-environment, ase]
cis_id: "2.9"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure App Service Environment has TLS 1.0 and 1.1 disabled

## Description
The TLS (Transport Layer Security) protocol secures the transmission of data over the internet using standard encryption technology. TLS versions 1.0 and 1.1 have been deprecated, and their use is generally discouraged. Disable all inbound TLS 1.0 and TLS 1.1 traffic for all the apps in an App Service Environment.

## Rationale
TLS 1.0 and 1.1 are outdated and vulnerable to security risks.

## Impact
Disallowing TLS 1.0 and 1.1 may affect compatibility with clients and backend services.

## Audit Procedure

### Using Azure Portal
1. Go to `App Service Environments`.
2. Click the name of an App Service Environment.
3. Under `Settings`, click `Configuration`.
4. Ensure that `Allow TLS 1.0 and 1.1` is set to `Off`.
5. Repeat steps 1-4 for each App Service Environment.

### Using Azure CLI
Run the following command to list App Service Environments:
```bash
az appservice ase list
```

For each App Service Environment, ensure that `clusterSettings` includes:
```json
{
  "name": "DisableTls1.0",
  "value": "1"
}
```

## Expected Result
The `clusterSettings` should include a `DisableTls1.0` setting with value `"1"`. In the portal, `Allow TLS 1.0 and 1.1` should be set to `Off`.

## Remediation

### Using Azure Portal
1. Go to `App Service Environments`.
2. Click the name of an App Service Environment.
3. Under `Settings`, click `Configuration`.
4. Next to `Allow TLS 1.0 and 1.1`, click the radio button next to `Off`.
5. Click `Save`.
6. Click `Continue`.
7. Repeat steps 1-6 for each App Service Environment requiring remediation.

## Default Value
TLS 1.0 and 1.1 are allowed by default.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/environment/app-service-app-service-environment-custom-settings
2. https://learn.microsoft.com/en-us/cli/azure/appservice/ase

## Profile
Level 1 | Automated
