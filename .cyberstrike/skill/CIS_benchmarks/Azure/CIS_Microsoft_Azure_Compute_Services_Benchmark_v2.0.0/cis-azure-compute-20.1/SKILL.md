---
name: cis-azure-compute-20.1
description: "Ensure Virtual Machines are utilizing Managed Disks"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, virtual-machines, vm, disks, encryption]
cis_id: "20.1"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Virtual Machines are utilizing Managed Disks

## Description

Migrate blob-based VHDs to Managed Disks on Virtual Machines to exploit the default features of this configuration. The features include:

1. Default Disk Encryption
2. Resilience, as Microsoft will manage the disk storage and move around if underlying hardware goes faulty
3. Reduction of costs over storage accounts

## Rationale

Managed disks are by default encrypted on the underlying hardware, so no additional encryption is required for basic protection. It is available if additional encryption is required. Managed disks are by design more resilient than storage accounts.

For ARM-deployed Virtual Machines, Azure Adviser will at some point recommend moving VHDs to managed disks both from a security and cost management perspective.

## Impact

There are additional costs for managed disks based off of disk space allocated. When converting to managed disks, VMs will be powered off and back on.

## Audit Procedure

### Using Azure Portal

1. Using the search feature, go to `Virtual Machines`
2. Click the `Manage view` dropdown, then select `Edit columns`
3. Add `Uses managed disks` to the selected columns
4. Select `Save`
5. Ensure all virtual machines listed are using managed disks

### Using Azure PowerShell

```powershell
Get-AzVM | ForEach-Object {"Name: " + $_.Name;"ManagedDisk Id: " + $_.StorageProfile.OsDisk.ManagedDisk.Id;""}
```

Example output:

```
Name: vm1
ManagedDisk Id: /disk1/id

Name: vm2
ManagedDisk Id: /disk2/id
```

If the 'ManagedDisk Id' field is empty the os disk for that vm is not managed.

## Expected Result

All Virtual Machines should have a non-empty `ManagedDisk Id` value, indicating they are using managed disks.

## Remediation

### Using Azure Portal

1. Using the search feature, go to `Virtual Machines`
2. Select the virtual machine you would like to convert
3. Select `Disks` in the menu for the VM
4. At the top select `Migrate to managed disks`
5. You may follow the prompts to convert the disk and finish by selecting `Migrate` to start the process

**NOTE** VMs will be stopped and restarted after migration is complete.

### Using Azure PowerShell

```powershell
Stop-AzVM -ResourceGroupName $rgName -Name $vmName -Force
ConvertTo-AzVMManagedDisk -ResourceGroupName $rgName -VMName $vmName
Start-AzVM -ResourceGroupName $rgName -Name $vmName
```

## Default Value

Managed disks or are an option upon the creation of VMs.

## References

1. https://docs.microsoft.com/en-us/azure/virtual-machines/windows/convert-unmanaged-to-managed-disks
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-4-enable-data-at-rest-encryption-by-default
3. https://docs.microsoft.com/en-us/azure/virtual-machines/faq-for-disks
4. https://azure.microsoft.com/en-us/pricing/details/managed-disks/

## Profile

Level 1 | Automated
