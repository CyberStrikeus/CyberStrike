---
name: cis-azure-foundations-8.3.2
description: "Ensure that the Expiration Date is set for all Keys in Non-RBAC Key Vaults"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, key-vault, keys, expiration]
cis_id: "8.3.2"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.3.2 Ensure that the Expiration Date is set for all Keys in Non-RBAC Key Vaults (Automated)

## Description

Ensure that all cryptographic keys stored in Azure Key Vaults using Vault Access Policy authorization (non-RBAC) have an expiration date configured.

## Rationale

Cryptographic keys without expiration dates remain valid indefinitely, creating a security risk as the likelihood of key compromise increases over time. Non-RBAC Key Vaults use Vault Access Policies for authorization, but the key management best practices remain the same. Setting an expiration date ensures keys are periodically reviewed and rotated, limiting the impact of potential key compromise. This aligns with cryptographic best practices and compliance requirements.

## Impact

When keys expire, applications and services using those keys will fail until the keys are renewed or replaced. Organizations need to implement key rotation procedures and monitoring to ensure keys are renewed before expiration. Automation through Azure Key Vault key rotation policies can help manage this lifecycle.

## Audit Procedure

**From Azure Portal:**

1. Go to `Key vaults`.
2. For each Key Vault with RBAC authorization disabled (using Access Policies), click the vault name.
3. Under `Objects`, click `Keys`.
4. For each key, verify that the `Expiration date` column shows a date (not blank or 'Not set').

**From Azure CLI:**

```
az keyvault list --query "[?properties.enableRbacAuthorization!=\`true\`].name" -o tsv
```

For each non-RBAC Key Vault:

```
az keyvault key list --vault-name {vaultName} --query "[].{Name:name, Expires:attributes.expires}" -o table
```

Ensure `Expires` is set for all keys.

**From PowerShell:**

```
$vaults = Get-AzKeyVault | Where-Object { $_.EnableRbacAuthorization -ne $true }
foreach ($vault in $vaults) {
    Get-AzKeyVaultKey -VaultName $vault.VaultName | Select-Object Name, Expires
}
```

Ensure `Expires` is populated for all keys.

## Expected Result

All keys in non-RBAC Key Vaults should have an expiration date set.

## Remediation

**From Azure Portal:**

1. Go to `Key vaults`.
2. Click the name of a Key Vault.
3. Under `Objects`, click `Keys`.
4. Click the key that needs an expiration date.
5. Click the current version of the key.
6. Set the `Expiration date`.
7. Click `Save`.

**From Azure CLI:**

```
az keyvault key set-attributes --vault-name {vaultName} --name {keyName} --expires "2025-12-31T23:59:59Z"
```

**From PowerShell:**

```
$expires = (Get-Date).AddYears(1).ToUniversalTime()
Update-AzKeyVaultKey -VaultName {vaultName} -Name {keyName} -Expires $expires
```

## Default Value

By default, keys are created without an expiration date.

## References

1. https://learn.microsoft.com/en-us/azure/key-vault/keys/about-keys
2. https://learn.microsoft.com/en-us/azure/key-vault/general/best-practices
3. https://learn.microsoft.com/en-us/cli/azure/keyvault/key
4. https://learn.microsoft.com/en-us/powershell/module/az.keyvault/update-azkeyvaultkey

## Profile

- Level 1
