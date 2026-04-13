---
name: cis-azure-foundations-8.3.11
description: "Ensure Azure Resource Manager CanNotDelete Locks are considered for Key Vaults"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, key-vault, resource-locks]
cis_id: "8.3.11"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.3.11 Ensure Azure Resource Manager CanNotDelete Locks are considered for Key Vaults (Manual)

## Description

Ensure that Azure Resource Manager `CanNotDelete` locks are applied to Key Vault resources to prevent accidental or unauthorized deletion of critical Key Vault instances.

## Rationale

Azure Key Vaults contain critical cryptographic keys, secrets, and certificates that are essential for application security and operations. Accidental or malicious deletion of a Key Vault can cause catastrophic service outages and data loss. While soft delete and purge protection provide recovery capabilities, a `CanNotDelete` resource lock adds an additional layer of protection by preventing the deletion of the Key Vault resource entirely. The lock must be explicitly removed before the resource can be deleted, providing an additional administrative barrier against both accidental and intentional destruction.

## Impact

Applying `CanNotDelete` locks means that the Key Vault cannot be deleted until the lock is removed. This requires explicit administrative action to remove the lock before deletion, which adds an additional step to any legitimate decommissioning process. Users with the `Microsoft.Authorization/locks/*` permission can remove locks. Organizations should ensure that lock management permissions are restricted to authorized personnel only.

## Audit Procedure

**From Azure Portal:**

1. Go to `Key vaults`.
2. Click the name of a Key Vault.
3. Under `Settings`, click `Locks`.
4. Verify that a lock of type `Delete` (CanNotDelete) exists.

**From Azure CLI:**

```
az keyvault list --query "[].{Name:name, ResourceGroup:resourceGroup, Id:id}" -o tsv | while IFS=$'\t' read -r name rg id; do
    echo "Key Vault: $name"
    az lock list --resource-group "$rg" --resource-name "$name" --resource-type Microsoft.KeyVault/vaults --query "[?properties.level=='CanNotDelete'].{Name:name, Level:properties.level}" -o table
done
```

Ensure each Key Vault has a `CanNotDelete` lock.

For a specific vault:

```
az lock list --resource-group {resourceGroup} --resource-name {vaultName} --resource-type Microsoft.KeyVault/vaults --query "[?properties.level=='CanNotDelete']"
```

**From PowerShell:**

```
Get-AzKeyVault | ForEach-Object {
    $locks = Get-AzResourceLock -ResourceName $_.VaultName -ResourceGroupName $_.ResourceGroupName -ResourceType Microsoft.KeyVault/vaults | Where-Object { $_.Properties.Level -eq "CanNotDelete" }
    [PSCustomObject]@{
        VaultName = $_.VaultName
        HasDeleteLock = if ($locks) { "Yes" } else { "No" }
    }
}
```

## Expected Result

All Key Vaults should have a `CanNotDelete` resource lock applied.

## Remediation

**From Azure Portal:**

1. Go to `Key vaults`.
2. Click the name of a Key Vault.
3. Under `Settings`, click `Locks`.
4. Click `+ Add`.
5. Enter a name for the lock (e.g., `DoNotDelete`).
6. Set `Lock type` to `Delete`.
7. Optionally add a note explaining why the lock is in place.
8. Click `OK`.

**From Azure CLI:**

```
az lock create --name DoNotDelete --lock-type CanNotDelete --resource-group {resourceGroup} --resource-name {vaultName} --resource-type Microsoft.KeyVault/vaults --notes "Prevent accidental deletion of Key Vault"
```

**From PowerShell:**

```
New-AzResourceLock -LockName "DoNotDelete" -LockLevel CanNotDelete -ResourceName {vaultName} -ResourceGroupName {resourceGroup} -ResourceType Microsoft.KeyVault/vaults -LockNotes "Prevent accidental deletion of Key Vault"
```

## Default Value

By default, no resource locks are applied to Key Vaults.

## References

1. https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/lock-resources
2. https://learn.microsoft.com/en-us/azure/key-vault/general/best-practices
3. https://learn.microsoft.com/en-us/cli/azure/lock
4. https://learn.microsoft.com/en-us/powershell/module/az.resources/new-azresourcelock

## Profile

- Level 1
