---
name: cis-azure-compute-2.8
description: "Ensure App Service Environment has internal encryption enabled"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, app-service-environment, ase]
cis_id: "2.8"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure App Service Environment has internal encryption enabled

## Description
The App Service Environment operates as a black box system where you cannot see the internal components or the communication within the system. To enable higher throughput, encryption is not enabled by default between internal components. The system is secure as the traffic is inaccessible to being monitored or accessed.

However, if you have a compliance requirement that requires complete encryption of the data path from end to end, you can enable encryption of the complete data path with a clusterSetting.

## Rationale
Setting InternalEncryption to true encrypts internal network traffic in your App Service Environment between the front ends and workers, encrypts the pagefile, and also encrypts the worker disks.

## Impact
At the point that this setting becomes desirable, an architectural review to evaluate a move to Azure Confidential Computing should be considered.

After the InternalEncryption clusterSetting is enabled, there can be an impact to your system performance and the additional resource demand will likely also increase the associated cost. When you make the change to enable InternalEncryption, your App Service Environment will be in an unstable state until the change is fully propagated. Complete propagation of the change can take a few hours to complete, depending on how many instances you have in your App Service Environment. Azure recommends that you do not enable InternalEncryption on an App Service Environment while it is in use. If you need to enable InternalEncryption on an actively used App Service Environment, Azure recommends that you divert traffic to a backup environment until the operation completes.

## Audit Procedure

### Using Azure Portal
1. Go to `App Service Environments`.
2. Click the name of an App Service Environment.
3. Under `Settings`, click `Configuration`.
4. Ensure that `Internal encryption` is set to `On`.
5. Repeat steps 1-4 for each App Service Environment.

### Using Azure CLI
Run the following command to list App Service Environments:
```bash
az appservice ase list
```

For each App Service Environment, ensure that `clusterSettings` includes:
```json
{
  "name": "InternalEncryption",
  "value": "true"
}
```

## Expected Result
The `clusterSettings` should include an `InternalEncryption` setting with value `"true"`. In the portal, `Internal encryption` should be set to `On`.

## Remediation

### Using Azure Portal
1. Go to `App Service Environments`.
2. Click the name of an App Service Environment.
3. Under `Settings`, click `Configuration`.
4. Next to `Internal encryption`, click the radio button next to `On`.
5. Click `Save`.
6. Click `Continue`.
7. Repeat steps 1-6 for each App Service Environment requiring remediation.

## Default Value
Internal encryption is disabled by default.

## References
1. https://learn.microsoft.com/en-us/azure/app-service/environment/app-service-app-service-environment-custom-settings
2. https://learn.microsoft.com/en-us/cli/azure/appservice/ase

## Profile
Level 2 | Automated
