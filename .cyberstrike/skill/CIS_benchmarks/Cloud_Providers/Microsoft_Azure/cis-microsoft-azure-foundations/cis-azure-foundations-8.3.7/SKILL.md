---
name: cis-azure-foundations-8.3.7
description: "Ensure that Azure Key Vaults Use Azure RBAC for access management"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, key-vault, rbac]
cis_id: "8.3.7"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.3.7 Ensure that Azure Key Vaults Use Azure RBAC for access management (Automated)

## Description

Ensure that Azure Key Vaults use Azure Role-Based Access Control (RBAC) for access management instead of the legacy Vault Access Policy model.

## Rationale

Azure RBAC provides a unified and granular access management model for Azure resources, including Key Vault. The legacy Vault Access Policy model has limitations: it applies at the vault level (not individual keys/secrets), lacks conditional access support, and does not integrate with Azure Privileged Identity Management (PIM). Azure RBAC for Key Vault enables fine-grained access control at the individual key, secret, and certificate level, supports conditional access policies, and integrates with the broader Azure identity governance framework. This provides better security posture and auditability.

## Impact

Migrating from Vault Access Policies to Azure RBAC may require updating existing applications and scripts that rely on access policy-based permissions. The migration cannot be reversed once completed. Organizations should thoroughly test the migration in a non-production environment first and ensure all necessary RBAC role assignments are in place before switching.

## Audit Procedure

**From Azure Portal:**

1. Go to `Key vaults`.
2. Click the name of a Key Vault.
3. Under `Settings`, click `Access configuration`.
4. Verify that `Permission model` is set to `Azure role-based access control`.

**From Azure CLI:**

```
az keyvault list --query "[].{Name:name, RBACEnabled:properties.enableRbacAuthorization}" -o table
```

Ensure `RBACEnabled` is `true` for all Key Vaults.

For a specific vault:

```
az keyvault show --name {vaultName} --query "properties.enableRbacAuthorization"
```

**From PowerShell:**

```
Get-AzKeyVault | ForEach-Object {
    Get-AzKeyVault -VaultName $_.VaultName | Select-Object VaultName, EnableRbacAuthorization
}
```

Ensure `EnableRbacAuthorization` is `True` for all Key Vaults.

## Expected Result

All Key Vaults should have `enableRbacAuthorization` set to `true`.

## Remediation

**From Azure Portal:**

1. Go to `Key vaults`.
2. Click the name of a Key Vault.
3. Under `Settings`, click `Access configuration`.
4. Select `Azure role-based access control` for the `Permission model`.
5. Click `Save`.
6. Assign appropriate RBAC roles to users, groups, and service principals.

**From Azure CLI:**

```
az keyvault update --name {vaultName} --enable-rbac-authorization true
```

Then assign roles:

```
az role assignment create --role "Key Vault Secrets Officer" --assignee {principalId} --scope $(az keyvault show --name {vaultName} --query id -o tsv)
```

**From PowerShell:**

```
Update-AzKeyVault -VaultName {vaultName} -EnableRbacAuthorization $true
```

Then assign roles:

```
New-AzRoleAssignment -ObjectId {principalId} -RoleDefinitionName "Key Vault Secrets Officer" -Scope (Get-AzKeyVault -VaultName {vaultName}).ResourceId
```

## Default Value

New Key Vaults default to Vault Access Policy permission model. Azure RBAC must be explicitly enabled.

## References

1. https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide
2. https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-migration
3. https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles#key-vault
4. https://learn.microsoft.com/en-us/cli/azure/keyvault

## Profile

- Level 2
