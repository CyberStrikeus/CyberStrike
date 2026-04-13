---
name: cis-azure-foundations-8.3.5
description: "Ensure the Key Vault is Recoverable"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, key-vault, soft-delete, purge-protection]
cis_id: "8.3.5"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.3.5 Ensure the Key Vault is Recoverable (Automated)

## Description

Ensure that Azure Key Vaults are configured with both soft delete and purge protection enabled, making the Key Vault and its objects recoverable in the event of accidental or malicious deletion.

## Rationale

Azure Key Vault stores critical cryptographic keys, secrets, and certificates. Accidental or malicious deletion of a Key Vault or its contents can have catastrophic consequences, including data loss and service outages. Soft delete enables recovery of deleted vaults and vault objects for a configurable retention period (default 90 days). Purge protection prevents permanent deletion during the retention period, even by administrators. Together, these features provide a safety net against both accidental and malicious destruction of key material.

## Impact

Enabling soft delete and purge protection means that deleted Key Vaults and their objects cannot be permanently removed until the retention period expires. This may impact organizations that need to rapidly reclaim Key Vault names or immediately remove sensitive data. The retention period is configurable between 7 and 90 days. Note that soft delete is now enforced by Azure for all new Key Vaults and cannot be disabled.

## Audit Procedure

**From Azure Portal:**

1. Go to `Key vaults`.
2. Click the name of a Key Vault.
3. Under `Settings`, click `Properties`.
4. Verify that `Soft delete` is shown as enabled.
5. Verify that `Purge protection` is shown as enabled.

**From Azure CLI:**

```
az keyvault list --query "[].{Name:name, SoftDelete:properties.enableSoftDelete, PurgeProtection:properties.enablePurgeProtection}" -o table
```

Ensure both `SoftDelete` and `PurgeProtection` are `true` for all Key Vaults.

For a specific vault:

```
az keyvault show --name {vaultName} --query "{SoftDelete:properties.enableSoftDelete, PurgeProtection:properties.enablePurgeProtection}"
```

**From PowerShell:**

```
Get-AzKeyVault | ForEach-Object {
    Get-AzKeyVault -VaultName $_.VaultName | Select-Object VaultName, EnableSoftDelete, EnablePurgeProtection
}
```

Ensure both `EnableSoftDelete` and `EnablePurgeProtection` are `True`.

## Expected Result

All Key Vaults should have both soft delete and purge protection enabled.

## Remediation

**From Azure Portal:**

1. Go to `Key vaults`.
2. Click the name of a Key Vault.
3. Under `Settings`, click `Properties`.
4. If purge protection is not enabled, click `Enable purge protection`.
5. Click `Save`.

**From Azure CLI:**

```
az keyvault update --name {vaultName} --enable-purge-protection true
```

Note: Soft delete is now enforced by Azure and cannot be disabled.

**From PowerShell:**

```
Update-AzKeyVault -VaultName {vaultName} -EnablePurgeProtection
```

## Default Value

Soft delete is enabled by default and enforced for all new Key Vaults. Purge protection is not enabled by default and must be explicitly configured.

## References

1. https://learn.microsoft.com/en-us/azure/key-vault/general/soft-delete-overview
2. https://learn.microsoft.com/en-us/azure/key-vault/general/key-vault-recovery
3. https://learn.microsoft.com/en-us/cli/azure/keyvault
4. https://learn.microsoft.com/en-us/powershell/module/az.keyvault/update-azkeyvault

## Profile

- Level 1
