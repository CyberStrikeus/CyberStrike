---
name: cis-azure-compute-20.6
description: "Ensure that Only Approved Extensions Are Installed"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, virtual-machines, vm, disks, encryption]
cis_id: "20.6"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that Only Approved Extensions Are Installed

## Description

For added security, only install organization-approved extensions on VMs.

## Rationale

Azure virtual machine extensions are small applications that provide post-deployment configuration and automation tasks on Azure virtual machines. These extensions run with administrative privileges and could potentially access anything on a virtual machine. The Azure Portal and community provide several such extensions. Each organization should carefully evaluate these extensions and ensure that only those that are approved for use are actually implemented.

## Impact

Functionality by unsupported extensions will be disabled.

## Audit Procedure

### Using Azure Portal

1. Go to `Virtual machines`.
2. For each virtual machine, click on the server name to select it.
3. In the new column menu, under `Settings` Click on `Extensions + applications`.
4. Ensure that all the listed extensions are approved by your organization for use.

### Using Azure CLI

Use the below command to list the extensions attached to a VM, and ensure the listed extensions are approved for use.

```bash
az vm extension list --vm-name <vmName> --resource-group <sourceGroupName> --query [*].name
```

### Using Azure PowerShell

Get a list of VMs.

```powershell
Get-AzVM
```

For each VM run the following command.

```powershell
Get-AzVMExtension -ResourceGroupName <VM Resource Group> -VMName <VM Name>
```

Review each `Name`, `ExtensionType`, and `ProvisioningState` to make sure no unauthorized extensions are installed on any virtual machines.

## Expected Result

Only organization-approved extensions should be installed on virtual machines. No unauthorized or unapproved extensions should be present.

## Remediation

### Using Azure Portal

1. Go to `Virtual machines`.
2. For each virtual machine, go to `Settings`.
3. Click on `Extensions + applications`.
4. If there are unapproved extensions, uninstall them.

### Using Azure CLI

From the audit command identify the unapproved extensions, and use the below CLI command to remove an unapproved extension attached to VM.

```bash
az vm extension delete --resource-group <resourceGroupName> --vm-name <vmName> --name <extensionName>
```

### Using Azure PowerShell

For each VM and each insecure extension from the Audit Procedure run the following command.

```powershell
Remove-AzVMExtension -ResourceGroupName <ResourceGroupName> -Name <ExtensionName> -VMName <VirtualMachineName>
```

## Default Value

By default, no extensions are added to the virtual machines.

## References

1. https://docs.microsoft.com/en-us/azure/virtual-machines/windows/extensions-features
2. https://docs.microsoft.com/en-us/powershell/module/az.compute/?view=azps-7.5.0#vm-extensions
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-asset-management#am-2-use-only-approved-services
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-asset-management#am-5-use-only-approved-applications-in-virtual-machine

## Profile

Level 1 | Manual
