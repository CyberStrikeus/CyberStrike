---
name: cis-azure-foundations-8.3.1
description: "Ensure that the Expiration Date is set for all Keys in RBAC Key Vaults"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, key-vault, keys, expiration]
cis_id: "8.3.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.3.1 Ensure that the Expiration Date is set for all Keys in RBAC Key Vaults (Automated)

## Description

Ensure that all cryptographic keys stored in Azure Key Vaults using RBAC (Role-Based Access Control) authorization have an expiration date configured.

## Rationale

Cryptographic keys without expiration dates remain valid indefinitely, which violates the principle of key rotation and increases the risk of key compromise over time. Setting an expiration date ensures that keys are periodically reviewed and rotated, reducing the window of exposure if a key is compromised. This is a fundamental cryptographic hygiene practice required by most compliance frameworks including PCI DSS, HIPAA, and SOC 2.

## Impact

Setting expiration dates on keys requires organizations to implement key rotation processes. When a key expires, any application or service relying on that key will fail until the key is renewed or replaced. Organizations must plan for key rotation well before expiration to avoid service disruptions.

## Audit Procedure

**From Azure Portal:**

1. Go to `Key vaults`.
2. For each Key Vault with RBAC authorization enabled, click the vault name.
3. Under `Objects`, click `Keys`.
4. For each key, verify that the `Expiration date` column shows a date (not blank or 'Not set').

**From Azure CLI:**

```
az keyvault list --query "[?properties.enableRbacAuthorization==\`true\`].name" -o tsv
```

For each RBAC-enabled Key Vault:

```
az keyvault key list --vault-name {vaultName} --query "[].{Name:name, Expires:attributes.expires}" -o table
```

Ensure `Expires` is set for all keys.

**From PowerShell:**

```
$vaults = Get-AzKeyVault | Where-Object { $_.EnableRbacAuthorization -eq $true }
foreach ($vault in $vaults) {
    Get-AzKeyVaultKey -VaultName $vault.VaultName | Select-Object Name, Expires
}
```

Ensure `Expires` is populated for all keys.

## Expected Result

All keys in RBAC-enabled Key Vaults should have an expiration date set.

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
