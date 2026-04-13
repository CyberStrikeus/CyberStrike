---
name: cis-azure-foundations-9.1.3
description: "Ensure 'SMB channel encryption' is set to 'AES-256-GCM' or higher for SMB file shares"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, azure-files, storage, smb, channel-encryption, aes-256]
cis_id: "9.1.3"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'SMB channel encryption' is set to 'AES-256-GCM' or higher for SMB file shares

## Description

Implement SMB channel encryption with AES-256-GCM for SMB file shares to ensure data confidentiality and integrity in transit. This method offers strong protection against eavesdropping and man-in-the-middle attacks, safeguarding sensitive information.

## Rationale

AES-256-GCM encryption enhances the security of data transmitted over SMB channels by safeguarding it from unauthorized interception and tampering.

## Impact

Using the AES-256-GCM SMB channel encryption may impact client compatibility.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage accounts`.
2. Click the name of a storage account.
3. Under `Data storage`, click `File shares`.
4. Under `File share settings`, click the link next to `Security`.
5. Under `SMB channel encryption`, ensure that `AES-256-GCM`, or higher, is the only checked SMB channel encryption setting.
6. Repeat steps 1-5 for each storage account.

### Audit from Azure CLI

Run the following command to list storage accounts:

```bash
az storage account list
```

For each storage account, run the following command:

```bash
az storage account file-service-properties show --resource-group <resource-group> --account-name <storage-account>
```

Ensure that under `protocolSettings` > `smb`, `channelEncryption` is set to `AES-256-GCM;`, or higher, only.

### Audit from PowerShell

Run the following command to list storage accounts:

```powershell
Get-AzStorageAccount
```

Run the following command to get the file service properties for a storage account in a resource group with a given name:

```powershell
$storageaccountfileservice = Get-AzStorageFileServiceProperty -ResourceGroupName <resource-group> -AccountName <storage-account>
```

Run the following command to get the SMB channel encryption setting:

```powershell
$storageaccountfileservice.ProtocolSettings.Smb.ChannelEncryption
```

Ensure that the command returns `AES-256-GCM`, or higher, only.

## Expected Result

SMB channel encryption should be set to `AES-256-GCM` or higher only.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage accounts`.
2. Click the name of a storage account.
3. Under `Data storage`, click `File shares`.
4. Under `File share settings`, click the link next to `Security`.
5. If `Profile` is set to `Maximum compatibility`, click the drop-down menu and select `Maximum security` or `Custom`.
6. If selecting `Custom`, under `SMB channel encryption`, uncheck the boxes next to `AES-128-CCM` and `AES-128-GCM`.
7. Click `Save`.
8. Repeat steps 1-7 for each storage account requiring remediation.

### Remediate from Azure CLI

For each storage account requiring remediation, run the following command to set the SMB channel encryption:

```bash
az storage account file-service-properties update --resource-group <resource-group> --account-name <storage-account> --channel-encryption AES-256-GCM
```

### Remediate from PowerShell

For each storage account requiring remediation, run the following command to set the SMB channel encryption:

```powershell
Update-AzStorageFileServiceProperty -ResourceGroupName <resource-group> -StorageAccountName <storage-account> -SmbChannelEncryption AES-256-GCM
```

## Default Value

By default, the following SMB channel encryption algorithms are allowed: AES-128-CCM, AES-128-GCM, and AES-256-GCM.

## References

1. https://learn.microsoft.com/en-us/azure/well-architected/service-guides/azure-files#recommendations-for-smb-file-shares
2. https://learn.microsoft.com/en-us/azure/storage/files/files-smb-protocol#smb-security-settings
3. https://learn.microsoft.com/en-us/cli/azure/storage/account/file-service-properties
4. https://learn.microsoft.com/en-us/powershell/module/az.storage/get-azstoragefileserviceproperty
5. https://learn.microsoft.com/en-us/powershell/module/az.storage/update-azstoragefileserviceproperty

## Profile

Level 1
