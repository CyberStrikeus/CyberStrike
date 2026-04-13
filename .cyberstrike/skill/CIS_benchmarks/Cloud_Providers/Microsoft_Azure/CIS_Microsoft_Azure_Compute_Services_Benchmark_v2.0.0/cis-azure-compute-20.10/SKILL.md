---
name: cis-azure-compute-20.10
description: "Ensure Trusted Launch is enabled on Virtual Machines"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, virtual-machines, vm, disks, encryption]
cis_id: "20.10"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Trusted Launch is enabled on Virtual Machines

## Description

When **Secure Boot** and **vTPM** are enabled together, they provide a strong foundation for protecting your VM from boot attacks. For example, if an attacker attempts to replace the bootloader with a malicious version, Secure Boot will prevent the VM from booting. If the attacker is able to bypass Secure Boot and install a malicious bootloader, vTPM can be used to detect the intrusion and alert you.

## Rationale

Secure Boot and vTPM work together to protect your VM from a variety of boot attacks, including bootkits, rootkits, and firmware rootkits. Not enabling Trusted Launch in Azure VM can lead to increased vulnerability to rootkits and boot-level malware, reduced ability to detect and prevent unauthorized changes to the boot process, and a potential compromise of system integrity and data security.

## Impact

Secure Boot and vTPM are not currently supported for Azure Generation 1 VMs.

**IMPORTANT:** Before enabling Secure Boot and vTPM on a Generation 2 VM which does not already have both enabled, it is highly recommended to create a restore point of the VM prior to remediation.

## Audit Procedure

### Using Azure Portal

1. Go to Virtual Machines
2. For each VM, under Settings, click on Configuration on the left blade
3. Under Security Type, make sure security type is not standard and if it is Trusted Launch Virtual Machines then make sure Enable Secure Boot & Enable vTPM are checked

### Using Azure CLI

Run the following command to list VM names and security profile settings:

```bash
az vm list --query [*].[name,securityProfile]
```

For each VM, ensure that `securityType` is set to `TrustedLaunch`, `uefiSettings.secureBootEnabled` is set to `true`, and `uefiSettings.vTpmEnabled` is set to `true`.

### Using Azure PowerShell

Run the following command to list VMs:

```powershell
Get-AzVm
```

Run the following command to get the VM in a resource group with a given name:

```powershell
$vm = Get-AzVm -ResourceGroupName <resource-group> -Name <vm>
```

Run the following command to get the security profile settings for the VM:

```powershell
$vm.SecurityProfile
```

Ensure that `SecurityType` is set to `TrustedLaunch`.

Run the following command to get the UEFI settings for the VM:

```powershell
$vm.SecurityProfile.UefiSettings
```

Ensure that `SecureBootEnabled` and `VTpmEnabled` are set to `True`.
Repeat for each VM.

## Expected Result

All VMs should have `securityType` set to `TrustedLaunch` with both `secureBootEnabled` and `vTpmEnabled` set to `true`.

## Remediation

**Note:** Trusted launch on existing virtual machines (VMs) is currently not supported for Azure Generation 1 VMs.

### Using Azure Portal

1. Go to Virtual Machines.
2. For each VM, under Settings, click on Configuration on the left blade.
3. Under Security Type, select 'Trusted Launch Virtual Machines'.
4. Make sure Enable Secure Boot & Enable vTPM are checked.
5. Click on Apply.

### Using Azure CLI

Ensure that it is safe to change the state of the VM.

Run the following command to deallocate the VM:

```bash
az vm deallocate --resource-group <resource-group> --name <vm>
```

Run the following command to update the VM, setting security type to `TrustedLaunch` and enabling `secure boot` and `vTPM`:

```bash
az vm update --resource-group <resource-group> --name <vm> --enable-secure-boot true --enable-vtpm true --security-type TrustedLaunch
```

Run the following command to restart the VM:

```bash
az vm start --resource-group <resource-group> --name <vm>
```

Repeat for each VM requiring remediation.

### Using Azure PowerShell

Ensure it is safe to change the state of the VM.

Run the following command to stop the VM:

```powershell
Stop-AzVm -ResourceGroupName <resource-group> -Name <vm> -Force
```

Run the following command to get the VM in a resource group with a given name:

```powershell
$vm = Get-AzVM -ResourceGroupName <resource-group> -Name <vm>
```

Run the following command to update the VM, setting security type to `TrustedLaunch` and enabling `secure boot` and `vTPM`:

```powershell
Update-AzVm -ResourceGroupName <resource-group> -VM $vm -EnableSecureBoot 1 -EnableVtpm 1 -SecurityType TrustedLaunch
```

Run the following command to start the VM:

```powershell
Start-AzVm -ResourceGroupName <resource-group> -Name <vm>
```

Repeat for each VM requiring remediation.

## Default Value

On Azure Generation 2 VMs, vTPM is enabled by default. Secure Boot is not enabled by default.

## References

1. https://learn.microsoft.com/en-us/azure/virtual-machines/trusted-launch-existing-vm?tabs=portal
2. https://learn.microsoft.com/en-us/azure/virtual-machines/trusted-launch-existing-vm?tabs=portal#enable-trusted-launch-on-existing-vm
3. https://learn.microsoft.com/en-us/azure/virtual-machines/trusted-launch#secure-boot
4. https://learn.microsoft.com/en-us/cli/azure/vm
5. https://learn.microsoft.com/en-us/powershell/module/az.compute/get-azvm
6. https://learn.microsoft.com/en-us/powershell/module/az.compute/stop-azvm
7. https://learn.microsoft.com/en-us/powershell/module/az.compute/update-azvm
8. https://learn.microsoft.com/en-us/powershell/module/az.compute/start-azvm

## Profile

Level 1 | Automated
