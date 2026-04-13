---
name: cis-azure-foundations-8.3.4
description: "Ensure that the Expiration Date is set for all Secrets in Non-RBAC Key Vaults"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, key-vault, secrets, expiration]
cis_id: "8.3.4"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.3.4 Ensure that the Expiration Date is set for all Secrets in Non-RBAC Key Vaults (Automated)

## Description

Ensure that all secrets stored in Azure Key Vaults using Vault Access Policy authorization (non-RBAC) have an expiration date configured.

## Rationale

Secrets in non-RBAC Key Vaults follow the same security principles as those in RBAC-enabled vaults. Secrets without expiration dates remain valid indefinitely, increasing the risk that compromised credentials can be abused for extended periods. Setting expiration dates enforces regular rotation cycles and ensures that stale or potentially compromised secrets are automatically invalidated. This is essential for maintaining a strong credential hygiene posture.

## Impact

Expired secrets will cause applications relying on them to fail. Organizations must establish secret rotation procedures and set up notifications (via Azure Event Grid) to alert administrators before secrets expire. Automation through Azure Automation or Azure Functions can help streamline the rotation process.

## Audit Procedure

**From Azure Portal:**
1. Go to `Key vaults`.
2. For each Key Vault with RBAC authorization disabled (using Access Policies), click the vault name.
3. Under `Objects`, click `Secrets`.
4. For each secret, verify that the `Expiration date` column shows a date (not blank or 'Not set').

**From Azure CLI:**
```
az keyvault list --query "[?properties.enableRbacAuthorization!=\`true\`].name" -o tsv
```
For each non-RBAC Key Vault:
```
az keyvault secret list --vault-name {vaultName} --query "[].{Name:name, Expires:attributes.expires}" -o table
```
Ensure `Expires` is set for all secrets.

**From PowerShell:**
```
$vaults = Get-AzKeyVault | Where-Object { $_.EnableRbacAuthorization -ne $true }
foreach ($vault in $vaults) {
    Get-AzKeyVaultSecret -VaultName $vault.VaultName | Select-Object Name, Expires
}
```
Ensure `Expires` is populated for all secrets.

## Expected Result

All secrets in non-RBAC Key Vaults should have an expiration date set.

## Remediation

**From Azure Portal:**
1. Go to `Key vaults`.
2. Click the name of a Key Vault.
3. Under `Objects`, click `Secrets`.
4. Click the secret that needs an expiration date.
5. Click the current version of the secret.
6. Set the `Expiration date`.
7. Click `Save`.

**From Azure CLI:**
```
az keyvault secret set-attributes --vault-name {vaultName} --name {secretName} --expires "2025-12-31T23:59:59Z"
```

**From PowerShell:**
```
$expires = (Get-Date).AddYears(1).ToUniversalTime()
Update-AzKeyVaultSecret -VaultName {vaultName} -Name {secretName} -Expires $expires
```

## Default Value

By default, secrets are created without an expiration date.

## References

1. https://learn.microsoft.com/en-us/azure/key-vault/secrets/about-secrets
2. https://learn.microsoft.com/en-us/azure/key-vault/general/best-practices
3. https://learn.microsoft.com/en-us/cli/azure/keyvault/secret
4. https://learn.microsoft.com/en-us/powershell/module/az.keyvault/update-azkeyvaultsecret

## Profile

- Level 1
