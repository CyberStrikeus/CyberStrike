---
name: cis-azure-storage-8.2
description: "Ensure root squash for NFS file shares is configured"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, azure-files, nfs, soft-delete]
cis_id: "8.2"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.2 Ensure root squash for NFS file shares is configured (Automated)

## Description

Permissions for NFS file shares are enforced by the client OS rather than by the Azure Files service. Root squash is an administrative security feature in NFS that prevents unauthorized root-level access to the NFS server by client machines. This functionality is an important part of protecting user data and system settings from manipulation by untrusted or compromised clients.

## Rationale

Administrators should enable root squash in environments where multiple users or systems access the NFS share, especially in scenarios where client machines are not fully trusted. By converting root users to anonymous users, root squash ensures that even if a client machine is compromised, the attacker cannot exploit root privileges to access or modify critical files on the NFS server.

## Impact

There is no additional cost associated with enabling root squash; however, there may be some minor administrative overhead involved in configuring and managing permissions with root squash enabled.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage accounts`.
2. For each storage account with NFS file shares, under `Data storage`, click `File shares`.
3. Click the name of an NFS file share.
4. Click `Properties`.
5. Under `ROOT SQUASH`, ensure that `Root Squash` is selected.
6. Repeat steps 1-5 for each NFS file share in each storage account.

### Audit from Azure CLI

Run the following command to list storage accounts:

```bash
az storage account list
```

For each storage account, run the following command to list file shares:

```bash
az storage share list --account-name <storage-account>
```

For each file share with `"protocols": [ "NFS" ]`, ensure that `rootSquash` is set to `RootSquash`.

### Audit from PowerShell

Run the following command to list storage accounts:

```powershell
Get-AzStorageAccount -ResourceGroupName <resource-group>
```

For each storage account, run the following command to list file shares:

```powershell
Get-AzRmStorageShare -ResourceGroupName <resource-group> -StorageAccountName <storage-account>
```

For each NFS file share, run the following command to get the root squash configuration:

```powershell
Get-AzRmStorageShare -ResourceGroupName <resource-group> -StorageAccountName <storage-account> -Name <nfs-file-share> | fl -Property RootSquash
```

Ensure that `RootSquash` is set to `RootSquash`.

## Expected Result

Root squash is set to `RootSquash` for all NFS file shares.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage accounts`.
2. For each storage account with NFS file shares, under `Data storage`, click `File shares`.
3. Click the name of an NFS file share.
4. Click `Properties`.
5. Under `ROOT SQUASH`, select `Root Squash` from the drop-down menu.
6. Click `Save`.
7. Repeat steps 1-6 for each NFS file share requiring remediation in each storage account.

### Remediate from Azure CLI

For each NFS file share requiring remediation, run the following command to enable root squash:

```bash
az storage share-rm update --resource-group <resource-group> --storage-account <storage-account> --name <nfs-file-share> --root-squash RootSquash
```

### Remediate from PowerShell

For each NFS file share requiring remediation, run the following command to enable root squash:

```powershell
Update-AzRmStorageShare -ResourceGroupName <resource-group> -StorageAccountName <storage-account> -Name <nfs-file-share> -RootSquash RootSquash
```

## Default Value

Root squash is disabled by default on NFS Azure file shares.

## References

1. https://learn.microsoft.com/en-us/azure/storage/files/nfs-root-squash
2. https://learn.microsoft.com/en-us/cli/azure/storage/account
3. https://learn.microsoft.com/en-us/cli/azure/storage/share
4. https://learn.microsoft.com/en-us/cli/azure/storage/share-rm
5. https://learn.microsoft.com/en-us/powershell/module/az.storage/get-azstorageaccount
6. https://learn.microsoft.com/en-us/powershell/module/az.storage/get-azrmstorageshare
7. https://learn.microsoft.com/en-us/powershell/module/az.storage/update-azrmstorageshare

## Additional Information

There are three root squash settings:

- **No root squash:** Turn off root squashing. This option is mainly useful for diskless clients or workloads as specified by workload documentation. This is the default setting when creating a new NFS Azure file share.
- **All squash:** Map all UIDs and GIDs to the anonymous user. This is useful for shares that require read-only access by all clients.
- **Root squash:** Map requests from UID/GID 0 (root) to the anonymous UID/GID. This does not apply to any other UIDs or GIDs that might be equally sensitive, such as the user bin or group staff.

`All squash` may be appropriate for highly restricted environments where no client-side user (including root) should have specific privileges on the NFS file share.

## Profile

Level 1 | Automated
