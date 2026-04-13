---
name: cis-azure-compute-20.5
description: "Ensure 'Enable Data Access Authentication Mode' is 'Checked'"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, virtual-machines, vm, disks, encryption]
cis_id: "20.5"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Enable Data Access Authentication Mode' is 'Checked'

## Description

Data Access Authentication Mode provides a method of uploading or exporting Virtual Machine Disks.

## Rationale

Enabling `data access authentication mode` adds a layer of protection using an Entra ID role to further restrict users from creating and using Secure Access Signature (SAS) tokens for exporting a detached managed disk or virtual machine state. Users will need the `Data operator for managed disk` role within Entra ID in order to download a VHD or VM Guest state using a secure URL.

## Impact

To apply this setting, the virtual machine to which the disk or disks are attached will need to be powered down and have its disk detached. Users without the `Data operator for managed disk` role within Entra ID will not be able to export VHD or VM guest state using the secure download URL.

The following restrictions apply and must be considered when determining if this recommendation is appropriate for your environment:

- VHDs can't be uploaded to empty snapshots.
- Azure Backup doesn't currently support disks secured with Microsoft Entra ID.
- Azure Site Recovery doesn't currently support disks secured with Microsoft Entra ID.

## Audit Procedure

### Using Azure Portal

Part A. Select the Virtual Machine to Evaluate

1. Using the search bar, search for and open the `Virtual Machines` service.
2. Click on the name of the Virtual Machine to be audited.

Part B. Evaluate each Virtual Machine Disk individually

1. From the selected Virtual Machine resource window, expand the `Settings` menu item and click `Disks`.
2. For each disk, click the name of the disk to open the disk resource window.
3. From the selected Disk resource window, expand the `Settings` menu item, and click `Disk Export`.

Ensure that `Enable Data Access Authentication Mode` is `checked`.

Repeat Part B for each Disk attached to a VM.
Repeat Parts A and B to evaluate all Disks in all VMs.

### Using Azure PowerShell

Run the following command for each disk:

```powershell
Get-AzDisk -ResourceGroupName <resource_group_name> -DiskName <disk_name>
```

Ensure the `DataAccessAuthMode` setting displays `AzureActiveDirectory` next to it.

### Using Azure CLI

Run the following command for each disk:

```bash
az disk show --disk-name <disk_name> --resource-group <resource_group_name>
```

Ensure the `dataAccessAuthMode` setting is set to `AzureActiveDirectory`.

## Expected Result

The `dataAccessAuthMode` setting should be set to `AzureActiveDirectory` for all VM disks.

## Remediation

### Using Azure Portal

Part A. Select the Virtual Machine to Remediate

1. Using the search bar, search for and open the `Virtual Machines` service.
2. Click on the name of the Virtual Machine to be remediated.

Part B. Remediate each Virtual Machine Disk individually

1. From the selected Virtual Machine resource window, expand the `Settings` menu item and click `Disks`.
2. For each disk, click the name of the disk to open the disk resource window.
3. From the selected Disk resource window, expand the `Settings` menu item, and click `Disk Export`.

`check` the checkbox next to `Enable Data Access Authentication Mode`.

Repeat Part B for each Disk attached to a VM.
Repeat Parts A and B to remediate all Disks in all VMs.

### Using Azure PowerShell

Ensure that each disk is detached from its associated `Virtual Machine` before proceeding. Once detached, run the following for each disk:

```powershell
$disk = Get-AzDisk -ResourceGroupName <resource_group_name> -DiskName <disk_name>
$disk.DataAccessAuthMode = 'AzureActiveDirectory'
Update-AzDisk -ResourceGroup <resource_group_name> -DiskName $disk.Name -Disk $disk
```

### Using Azure CLI

Ensure that each disk is detached from its associated `Virtual Machine` before proceeding. Once detached, run the following for each disk:

```bash
az disk update --name <disk_name> --resource-group <resource_group_name> --data-access-auth-mode AzureActiveDirectory
```

## Default Value

By default, Data Access Authentication Mode is `Disabled`.

## References

1. https://learn.microsoft.com/en-us/azure/virtual-machines/linux/download-vhd?tabs=azure-portal#secure-downloads-and-uploads-with-microsoft-entra-id
2. https://learn.microsoft.com/en-us/azure/virtual-machines/windows/download-vhd?tabs=azure-portal#secure-downloads-and-uploads-with-microsoft-entra-id

## Profile

Level 1 | Automated
