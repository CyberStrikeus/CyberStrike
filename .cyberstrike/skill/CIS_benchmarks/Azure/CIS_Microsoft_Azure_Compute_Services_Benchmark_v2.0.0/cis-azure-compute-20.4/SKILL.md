---
name: cis-azure-compute-20.4
description: "Ensure that 'Disk Network Access' is NOT set to 'Enable public access from all networks'"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, virtual-machines, vm, disks, encryption]
cis_id: "20.4"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that 'Disk Network Access' is NOT set to 'Enable public access from all networks'

## Description

Virtual Machine Disks and snapshots can be configured to allow access from different network resources.

## Rationale

The setting 'Enable public access from all networks' is, in many cases, an overly permissive setting on Virtual Machine Disks that presents atypical attack, data infiltration, and data exfiltration vectors. If a disk to network connection is required, the preferred setting is to 'Disable public access and enable private access.'

## Impact

The setting 'Disable public access and enable private access' will require configuring a private link (URL in references below).

The setting 'Disable public and private access' is most secure and preferred where disk network access is not needed.

## Audit Procedure

### Using Azure Portal

Part A. Select the Virtual Machine to Evaluate

1. Using the search bar, search for and open the `Virtual Machines` service.
2. Click on the name of the Virtual Machine to be audited.

Part B. Evaluate each Virtual Machine Disk individually

1. From the selected Virtual Machine resource window, expand the `Settings` menu item and click `Disks`.
2. For each disk, click the name of the disk to open the disk resource window.
3. From the selected Disk resource window, expand the `Settings` menu item, and click `Networking`.

Ensure that Network access is **NOT** set to `Enable public access from all networks`.

Repeat Part B for each Disk attached to a VM.
Repeat Parts A and B to evaluate all Disks in all VMs.

### Using Azure PowerShell

For each managed disk, run the following PowerShell command:

```powershell
Get-AzDisk -ResourceGroupName '<resource group name>' -DiskName '<disk name>'
```

Ensure the `PublicNetworkAccess` setting is `Disabled` and the `NetworkAccessPolicy` is set to `AllowPrivate` or `DenyAll`.

### Using Azure CLI

For each managed disk, run the following command:

```bash
az disk show --disk-name '<disk name>' --resource-group '<resource group name>'
```

Ensure the `publicNetworkAccess` setting is set to `Disabled` and the `networkAccessPolicy` setting is set to `AllowPrivate` or `DenyAll`.

## Expected Result

All VM disks should have `publicNetworkAccess` set to `Disabled` and `networkAccessPolicy` set to either `AllowPrivate` or `DenyAll`.

## Remediation

### Using Azure Portal

Part A. Select the Virtual Machine to Remediate

1. Using the search bar, search for and open the `Virtual Machines` service.
2. Click on the name of the Virtual Machine to be remediated.

Part B. Remediate each Virtual Machine Disk individually

1. From the selected Virtual Machine resource window, expand the `Settings` menu item and click `Disks`.
2. For each disk, click the name of the disk to open the disk resource window.
3. From the selected Disk resource window, expand the `Settings` menu item, and click `Networking`.

Under Network access, select the radio button for either:

- Disable public access and enable private access
- Disable public and private access

Repeat Part B for each Disk attached to a VM.
Repeat Parts A and B to remediate all Disks in all VMs.

### Using Azure PowerShell

To disable `PublicNetworkAccess` and to set a `DenyAll` setting for the disk's `NetworkAccessPolicy` for each managed disk, run the following command:

```powershell
$disk = Get-AzDisk -ResourceGroupName '<resource group name>' -DiskName '<disk name>'
$disk.NetworkAccessPolicy = 'DenyAll'
$disk.PublicNetworkAccess = 'Disabled'
Update-AzDisk -ResourceGroup '<resource group name>' -DiskName $disk.Name -Disk $disk
```

To disable `PublicNetworkAccess` and to set an `AllowPrivate` setting for the disk's `NetworkAccessPolicy` for each managed disk, run the following command:

```powershell
$disk = Get-AzDisk -ResourceGroupName '<resource group name>' -DiskName '<disk name>'
$disk.NetworkAccessPolicy = 'AllowPrivate'
$disk.PublicNetworkAccess = 'Disabled'
$disk.DiskAccessId = '/subscriptions/<subscription ID>/resourceGroups/<resource group name>/providers/Microsoft.Compute/diskAccesses/<private disk access name>'
Update-AzDisk -ResourceGroup '<resource group name>' -DiskName $disk.Name -Disk $disk
```

### Using Azure CLI

To configure a disk to allow private access only, run the following command making sure you have the `Disk Access ID` from a private disk access end point.

```bash
az disk update --name <managed disk name> --resource-group <resource group name> --network-access-policy AllowPrivate --disk-access <disk access ID>
```

To completely disable public and private access for a disk, run the following command (still in preview) for each disk:

```bash
az disk update --name <managed disk name> --resource-group <resource group name> --public-network-access Disabled --network-access-policy DenyAll
```

## Default Value

By default, Disk Network access is set to `Enable public access from all networks`.

## References

1. https://learn.microsoft.com/en-us/azure/virtual-machines/disks-enable-private-links-for-import-export-portal
2. https://learn.microsoft.com/en-us/azure/virtual-machines/linux/disks-export-import-private-links-cli
3. https://learn.microsoft.com/en-us/azure/virtual-machines/disks-restrict-import-export-overview

## Profile

Level 1 | Automated
