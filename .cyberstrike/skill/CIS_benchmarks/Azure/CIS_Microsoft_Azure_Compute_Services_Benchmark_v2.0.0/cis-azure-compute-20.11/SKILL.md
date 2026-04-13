---
name: cis-azure-compute-20.11
description: "Ensure that encryption at host is enabled"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, virtual-machines, vm, disks, encryption]
cis_id: "20.11"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that encryption at host is enabled

## Description

Encryption at host enhances Azure Disk Storage Server-Side Encryption to ensure that all temporary disks and disk caches are encrypted at rest and flow encrypted to the storage clusters.

## Rationale

Encryption at host provides an additional layer of security to protect sensitive information.

## Impact

- Virtual machines must be deallocated for encryption at host to be enabled.
- Encryption at host does not use virtual machine CPU, and does not impact virtual machine performance.
- Encryption at host cannot be enabled on virtual machines that have ever had Azure Disk Encryption enabled.

## Audit Procedure

### Using Azure Portal

1. Go to `Virtual machines`.
2. Click the name of a virtual machine.
3. In the `Properties` pane, under `Disk`, ensure that `Encryption at host` is set to `Enabled`.
4. Repeat steps 1-3 for each virtual machine.

### Using Azure CLI

Run the following command to list VM names and security profile settings:

```bash
az vm list --query [*].[name,securityProfile]
```

For each VM, ensure that `encryptionAtHost` is set to `true`.

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

Ensure that `EncryptionAtHost` is set to `True`.
Repeat for each VM.

## Expected Result

All VMs should have `encryptionAtHost` set to `true` in the security profile.

## Remediation

**Note:** Encryption at host must first be enabled in a subscription before it can be used for virtual machines.

1. From Azure Portal, select the Cloud Shell icon.
2. Run the following command to set the context to the current subscription:

```powershell
Set-AzContext -SubscriptionId <subscription-id>
```

3. Run the following command to register the encryption at host feature for the subscription:

```powershell
Register-AzProviderFeature -FeatureName "EncryptionAtHost" -ProviderNamespace "Microsoft.Compute"
```

4. Run the following command to confirm that the `RegistrationState` is `Registered`:

```powershell
Get-AzProviderFeature -FeatureName "EncryptionAtHost" -ProviderNamespace "Microsoft.Compute"
```

### Using Azure Portal

**Note:** Ensure that it is safe to change the state of the VM.

1. Go to `Virtual machines`.
2. Click the name of a virtual machine.
3. Click `Stop`.
4. Click `Yes`.
5. Under `Settings`, click `Disks`.
6. Click `Additional settings`.
7. Next to `Encryption at host`, select `Yes`.
8. Click `Save`.
9. Click `Overview`.
10. Click `Start`.
11. Repeat steps 1-10 for each virtual machine requiring remediation.

### Using Azure CLI

**Note:** Ensure that it is safe to change the state of the VM.

Run the following command to deallocate the VM:

```bash
az vm deallocate --resource-group <resource-group> --name <vm>
```

Run the following command to update the VM, enabling `encryptionAtHost`:

```bash
az vm update --resource-group <resource-group> --name <vm> --set securityProfile.encryptionAtHost=true
```

Run the following command to restart the VM:

```bash
az vm start --resource-group <resource-group> --name <vm>
```

Repeat for each VM requiring remediation.

### Using Azure PowerShell

**Note:** Ensure that it is safe to change the state of the VM.

Run the following command to stop the VM:

```powershell
Stop-AzVm -ResourceGroupName <resource-group> -Name <vm> -Force
```

Run the following command to get the VM in a resource group with a given name:

```powershell
$vm = Get-AzVM -ResourceGroupName <resource-group> -Name <vm>
```

Run the following command to update the VM, enabling `encryptionAtHost`:

```powershell
Update-AzVm -ResourceGroupName <resource-group> -VM $vm -EncryptionAtHost 1
```

Run the following command to start the VM:

```powershell
Start-AzVm -ResourceGroupName <resource-group> -Name <vm>
```

Repeat for each VM requiring remediation.

## Default Value

Encryption at host is disabled by default.

## References

1. https://learn.microsoft.com/en-us/azure/virtual-machines/disk-encryption-overview
2. https://learn.microsoft.com/en-us/azure/virtual-machines/disk-encryption#encryption-at-host---end-to-end-encryption-for-your-vm-data
3. https://learn.microsoft.com/en-us/azure/virtual-machines/disks-enable-host-based-encryption-portal

## Profile

Level 1 | Automated
