---
name: cis-azure-compute-20.8
description: "[Legacy] Ensure that VHDs are Encrypted"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, virtual-machines, vm, disks, encryption]
cis_id: "20.8"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# [Legacy] Ensure that VHDs are Encrypted

## Description

**NOTE: This is a legacy recommendation. Managed Disks are encrypted by default and recommended for all new VM implementations.**

VHD (Virtual Hard Disks) are stored in blob storage and are the old-style disks that were attached to Virtual Machines. The blob VHD was then leased to the VM. By default, storage accounts are not encrypted, and Microsoft Defender will then recommend that the OS disks should be encrypted. Storage accounts can be encrypted as a whole using PMK or CMK. This should be turned on for storage accounts containing VHDs.

## Rationale

While it is recommended to use Managed Disks which are encrypted by default, "legacy" VHDs may exist for a variety of reasons and may need to remain in VHD format. VHDs are not encrypted by default, so this recommendation intends to address the security of these disks. In these niche cases, VHDs should be encrypted using the procedures in this recommendation to encrypt and protect the data content.

If a virtual machine is using a VHD and can be converted to a managed disk, instructions for this procedure can be found in the resources section of this recommendation under the title "Convert VHD to Managed Disk."

## Impact

Depending on how the encryption is implemented will change the size of the impact. If provider-managed keys(PMK) are utilized, the impact is relatively low, but processes need to be put in place to regularly rotate the keys. If Customer-managed keys(CMK) are utilized, a key management process needs to be implemented to store and manage key rotation, thus the impact is medium to high depending on user maturity with key management.

## Audit Procedure

### Using Azure CLI

For each virtual machine identify if the VM is using a legacy VHD by reviewing the *VHD* parameter in the output of the following command. The *VHD* parameter will contain the Storage Account name used for the VHD.

```bash
az vm show --name <MyVM> --resource-group <MyResourceGroup>
```

Next, identify if the storage account from the *VHD* parameter is encrypted by reviewing the *encryption --> services --> blob --> enabled* within the output of the following command and make sure its value is *True*.

```bash
az storage account show --name <storage account name> --resource-group <resource group>
```

### Using Azure PowerShell

Determine whether the VM is using a VHD for the OS Disk and any Data disks.

```powershell
$virtualMachine = Get-AzVM --Name <vm name> --ResourceGroup <resource group name> |Select-Object -ExpandProperty StorageProfile

$virtualMachine.OsDisk
$virtualMachine.DataDisks
```

Next, use the value from *VHD* to see if the storage blob holding the VHD is encrypted.

```powershell
$storageAccount = Get-AzStorageAccount -Name <storage account name from VHD setting> -ResourceGroupName <resource group name>

$storageAccount.Encryption.Services.Blob
```

## Expected Result

If the VM uses a VHD, the storage account holding the VHD should have blob encryption enabled (`enabled` = `True`).

## Remediation

### Using Azure Portal

1. Navigate to the `storage account` that you wish to encrypt
2. Select `encryption`
3. Select the `encryption type` that you wish to use

If you wish to use a Microsoft-managed key (the default), you can save at this point and encryption will be applied to the account.

If you select `Customer-managed keys`, it will ask for the location of the key (The default is an Azure Key Vault) and the key name. Once these are captured, save the configuration and the account will be encrypted using the provided key.

### Using Azure CLI

Create the Key Vault:

```bash
az keyvault create --name <name> --resource-group <resourceGroup> --location <location> --enabled-for-disk-encryption
```

Encrypt the disk and store the key in Key Vault:

```bash
az vm encryption enable -g <resourceGroup> --name <name> --disk-encryption-keyvault myKV
```

### Using Azure PowerShell

This process uses a Key Vault to store the keys.

Create the Key Vault:

```powershell
New-AzKeyvault -name <name> -ResourceGroupName <resourceGroup> -Location <location> -EnabledForDiskEncryption
```

Encrypt the disk and store the key in Key Vault:

```powershell
$KeyVault = Get-AzKeyVault -VaultName <name> -ResourceGroupName <resourceGroup>
Set-AzVMDiskEncryptionExtension -ResourceGroupName <resourceGroup> -VMName <name> -DiskEncryptionKeyVaultUrl $KeyVault.VaultUri -DiskEncryptionKeyVaultId $KeyVault.ResourceId
```

## Default Value

The default value for encryption is "NO Encryption"

## References

1. CLI: https://docs.microsoft.com/en-us/azure/virtual-machines/windows/disk-encryption-cli-quickstart
2. Powershell: https://docs.microsoft.com/en-us/azure/virtual-machines/windows/disk-encryption-powershell-quickstart
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-4-enable-data-at-rest-encryption-by-default
4. Convert VHD to Managed Disk: https://docs.microsoft.com/en-us/previous-versions/azure/virtual-machines/scripts/virtual-machines-powershell-sample-create-managed-disk-from-vhd

## Profile

Level 2 | Manual
