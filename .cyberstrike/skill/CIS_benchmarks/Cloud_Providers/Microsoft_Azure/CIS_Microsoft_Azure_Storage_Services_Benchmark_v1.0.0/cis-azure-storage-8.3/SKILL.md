---
name: cis-azure-storage-8.3
description: "Ensure 'SMB protocol version' is set to 'SMB 3.1.1' or higher for SMB file shares"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, azure-files, smb, encryption]
cis_id: "8.3"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.3 Ensure 'SMB protocol version' is set to 'SMB 3.1.1' or higher for SMB file shares (Automated)

## Description

Ensure that SMB file shares are configured to use the latest supported SMB protocol version. Keeping the SMB protocol updated helps mitigate risks associated with older SMB versions, which may contain vulnerabilities and lack essential security controls.

## Rationale

Using the latest supported SMB protocol version enhances the security of SMB file shares by preventing the exploitation of known vulnerabilities in outdated SMB versions.

## Impact

Using the latest SMB protocol version may impact client compatibility.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage accounts`.
2. Click the name of a storage account.
3. Under `Data storage`, click `File shares`.
4. Under `File share settings`, click the link next to `Security`.
5. Under `SMB protocol versions`, ensure that `SMB3.1.1` is the only checked protocol version.
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

Ensure that under `protocolSettings` > `smb`, `versions` is set to `SMB3.1.1;` only.

### Audit from PowerShell

Run the following command to list storage accounts:

```powershell
Get-AzStorageAccount
```

Run the following command to get the file service properties for a storage account in a resource group with a given name:

```powershell
$storageaccountfileservice = Get-AzStorageFileServiceProperty -ResourceGroupName <resource-group> -AccountName <storage-account>
```

Run the following command to get the SMB protocol version setting:

```powershell
$storageaccountfileservice.ProtocolSettings.Smb.Versions
```

Ensure that the command returns `SMB3.1.1` only. Repeat for each storage account.

## Expected Result

Under `protocolSettings` > `smb`, `versions` is set to `SMB3.1.1;` only.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage accounts`.
2. Click the name of a storage account.
3. Under `Data storage`, click `File shares`.
4. Under `File share settings`, click the link next to `Security`.
5. If `Profile` is set to `Maximum compatibility`, click the drop-down menu and select `Maximum security` or `Custom`.
6. If selecting `Custom`, under `SMB protocol versions`, uncheck the boxes next to `SMB 2.1` and `SMB 3.0`.
7. Click `Save`.
8. Repeat steps 1-7 for each storage account requiring remediation.

### Remediate from Azure CLI

For each storage account requiring remediation, run the following command to set the SMB protocol version:

```bash
az storage account file-service-properties update --resource-group <resource-group> --account-name <storage-account> --versions SMB3.1.1
```

### Remediate from PowerShell

For each storage account requiring remediation, run the following command to set the SMB protocol version:

```powershell
Update-AzStorageFileServiceProperty -ResourceGroupName <resource-group> -StorageAccountName <storage-account> -SmbProtocolVersion SMB3.1.1
```

## Default Value

By default, all SMB versions are allowed.

## References

1. https://learn.microsoft.com/en-us/azure/well-architected/service-guides/azure-files#recommendations-for-smb-file-shares
2. https://learn.microsoft.com/en-us/azure/storage/files/files-smb-protocol#smb-security-settings
3. https://learn.microsoft.com/en-us/cli/azure/storage/account/file-service-properties
4. https://learn.microsoft.com/en-us/powershell/module/az.storage/get-azstoragefileserviceproperty
5. https://learn.microsoft.com/en-us/powershell/module/az.storage/update-azstoragefileserviceproperty

## Profile

Level 1 | Automated
