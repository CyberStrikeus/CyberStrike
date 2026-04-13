---
name: cis-azure-foundations-8.3.3
description: "Ensure that the Expiration Date is set for all Secrets in RBAC Key Vaults"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, key-vault, secrets, expiration]
cis_id: "8.3.3"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.3.3 Ensure that the Expiration Date is set for all Secrets in RBAC Key Vaults (Automated)

## Description

Ensure that all secrets stored in Azure Key Vaults using RBAC (Role-Based Access Control) authorization have an expiration date configured.

## Rationale

Secrets (such as passwords, connection strings, API keys, and certificates) without expiration dates remain valid indefinitely. This increases the risk that a compromised secret can be used by an attacker for an extended period without detection. Setting expiration dates on secrets enforces periodic rotation, reduces the window of exposure, and ensures compliance with security policies that mandate credential lifecycle management.

## Impact

When secrets expire, any application or service using those secrets will fail until the secret is renewed or replaced. Organizations must implement secret rotation processes and monitoring to ensure continuity. Azure Key Vault supports integration with Azure Event Grid to notify when secrets are near expiration.

## Audit Procedure

**From Azure Portal:**
1. Go to `Key vaults`.
2. For each Key Vault with RBAC authorization enabled, click the vault name.
3. Under `Objects`, click `Secrets`.
4. For each secret, verify that the `Expiration date` column shows a date (not blank or 'Not set').

**From Azure CLI:**
```
az keyvault list --query "[?properties.enableRbacAuthorization==\`true\`].name" -o tsv
```
For each RBAC-enabled Key Vault:
```
az keyvault secret list --vault-name {vaultName} --query "[].{Name:name, Expires:attributes.expires}" -o table
```
Ensure `Expires` is set for all secrets.

**From PowerShell:**
```
$vaults = Get-AzKeyVault | Where-Object { $_.EnableRbacAuthorization -eq $true }
foreach ($vault in $vaults) {
    Get-AzKeyVaultSecret -VaultName $vault.VaultName | Select-Object Name, Expires
}
```
Ensure `Expires` is populated for all secrets.

## Expected Result

All secrets in RBAC-enabled Key Vaults should have an expiration date set.

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
3. https://learn.microsoft.com/en-us/azure/key-vault/general/event-grid-overview
4. https://learn.microsoft.com/en-us/cli/azure/keyvault/secret
5. https://learn.microsoft.com/en-us/powershell/module/az.keyvault/update-azkeyvaultsecret

## Profile

- Level 1
