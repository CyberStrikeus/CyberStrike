---
name: cis-azure-storage-15.1
description: "Ensure 'Public network access' is set to 'Disabled' on Azure Elastic SAN"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, elastic-san, networking]
cis_id: "15.1"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 15.1 Ensure 'Public network access' is set to 'Disabled' on Azure Elastic SAN (Automated)

## Description

Azure Elastic SAN is a scalable, high-performance cloud-based storage solution. Disabling public network access at the SAN level ensures that Elastic SAN resources are accessible only through private networks.

## Rationale

Disabling public network access for Azure Elastic SAN at the SAN level enhances security by preventing unauthorized external access to sensitive storage resources.

## Impact

Disabling public network access at the SAN level incurs no direct cost. However, there may be costs and configuration overhead associated with setting up and managing private network access to securely connect to Azure Elastic SAN resources.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Elastic SANs`.
2. Click the name of an Elastic SAN.
3. Under `Settings`, click `Networking`.
4. Ensure that `Public network access` is set to `Disabled`.
5. Repeat steps 1-4 for each Elastic SAN.

### Audit from Azure CLI

Run the following command to list Elastic SANs:

```bash
az elastic-san list
```

For each Elastic SAN, run the following command:

```bash
az elastic-san show --resource-group <resource-group> --name <elastic-san>
```

Ensure that `publicNetworkAccess` is set to `Disabled`.

### Audit from PowerShell

Run the following command to list Elastic SANs:

```powershell
Get-AzElasticSan
```

Run the following command to get the Elastic SAN in a resource group with a given name:

```powershell
$elasticsan = Get-AzElasticSan -ResourceGroupName <resource-group> -Name <elastic-san>
```

Run the following command to get the public network access setting for the Elastic SAN:

```powershell
$elasticsan.PublicNetworkAccess
```

Ensure that the command returns `Disabled`.

## Expected Result

For each Elastic SAN, `publicNetworkAccess` (CLI) or `PublicNetworkAccess` (PowerShell) should return `Disabled`. In the Azure Portal, the `Public network access` setting under `Networking` should be set to `Disabled`.

## Remediation

### Remediate from Azure Portal

1. Go to `Elastic SANs`.
2. Click the name of an Elastic SAN.
3. Under `Settings`, click `Networking`.
4. Under `Public network access`, click the radio button next to `Disabled`.
5. Click `Apply`.
6. Repeat steps 1-5 for each Elastic SAN.

### Remediate from Azure CLI

For each Elastic SAN requiring remediation, run the following command to disable public network access:

```bash
az elastic-san update --resource-group <resource-group> --name <elastic-san> --public-network-access Disabled
```

### Remediate from PowerShell

For each Elastic SAN requiring remediation, run the following command to disable public network access:

```powershell
Update-AzElasticSan -ResourceGroupName <resource-group> -Name <elastic-san> -PublicNetworkAccess Disabled
```

## Default Value

Public network access at the SAN level is enabled by default, but access to individual volume groups is denied unless explicitly configured.

## References

1. https://learn.microsoft.com/en-us/azure/storage/elastic-san/elastic-san-networking
2. https://learn.microsoft.com/en-us/cli/azure/elastic-san
3. https://learn.microsoft.com/en-us/powershell/module/az.elasticsan/get-azelasticsan
4. https://learn.microsoft.com/en-us/powershell/module/az.elasticsan/update-azelasticsan

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | **3.3 Configure Data Access Control Lists** - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | X | X | X |
| v7 | **14.6 Protect Information through Access Control Lists** - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | X | X | X |

## Profile

Level 2 | Automated
