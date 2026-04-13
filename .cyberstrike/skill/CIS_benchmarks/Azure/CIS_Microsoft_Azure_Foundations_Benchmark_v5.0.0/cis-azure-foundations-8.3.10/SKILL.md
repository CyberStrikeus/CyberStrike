---
name: cis-azure-foundations-8.3.10
description: "Ensure 'Public network access' for Key Vault is set to 'Disabled'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, key-vault, networking, public-access]
cis_id: "8.3.10"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.3.10 Ensure 'Public network access' for Key Vault is set to 'Disabled' (Automated)

## Description

Ensure that public network access to Azure Key Vault is disabled, restricting access to only private endpoints and trusted Azure services.

## Rationale

By default, Azure Key Vault is accessible from the public internet. Even with proper authentication and authorization, exposing Key Vault publicly increases the attack surface and the risk of brute-force attacks, credential stuffing, or exploitation of potential authentication vulnerabilities. Disabling public network access ensures that Key Vault can only be accessed through private endpoints within the virtual network or by trusted Azure services, significantly reducing the attack surface and the risk of unauthorized access to sensitive secrets, keys, and certificates.

## Impact

Disabling public network access requires that all clients accessing Key Vault do so through private endpoints or trusted Azure services. This means applications outside the virtual network, including developer workstations, CI/CD pipelines, and external services, will not be able to access Key Vault unless they are connected via VPN, ExpressRoute, or other private network connectivity. Organizations must ensure private endpoints are properly configured before disabling public access to avoid service disruptions.

## Audit Procedure

**From Azure Portal:**
1. Go to `Key vaults`.
2. Click the name of a Key Vault.
3. Under `Settings`, click `Networking`.
4. Under the `Firewalls and virtual networks` tab, verify that `Public network access` is set to `Disabled`.

**From Azure CLI:**
```
az keyvault list --query "[].{Name:name, PublicAccess:properties.publicNetworkAccess}" -o table
```
Ensure `PublicAccess` is `Disabled` for all Key Vaults.

For a specific vault:
```
az keyvault show --name {vaultName} --query "properties.publicNetworkAccess"
```

**From PowerShell:**
```
Get-AzKeyVault | ForEach-Object {
    Get-AzKeyVault -VaultName $_.VaultName | Select-Object VaultName, PublicNetworkAccess
}
```
Ensure `PublicNetworkAccess` is `Disabled` for all Key Vaults.

## Expected Result

All Key Vaults should have `publicNetworkAccess` set to `Disabled`.

## Remediation

**From Azure Portal:**
1. Go to `Key vaults`.
2. Click the name of a Key Vault.
3. Under `Settings`, click `Networking`.
4. Under the `Firewalls and virtual networks` tab, set `Public network access` to `Disabled`.
5. Click `Apply`.

**From Azure CLI:**
```
az keyvault update --name {vaultName} --public-network-access Disabled
```

**From PowerShell:**
```
Update-AzKeyVault -VaultName {vaultName} -PublicNetworkAccess "Disabled"
```

**Important:** Before disabling public network access, ensure that:
1. Private endpoints are configured and working.
2. All applications and services can access Key Vault through private endpoints.
3. Trusted Azure services that need access have been configured appropriately.

## Default Value

By default, public network access is enabled for Azure Key Vault.

## References

1. https://learn.microsoft.com/en-us/azure/key-vault/general/network-security
2. https://learn.microsoft.com/en-us/azure/key-vault/general/private-link-service
3. https://learn.microsoft.com/en-us/azure/key-vault/general/overview-vnet-service-endpoints
4. https://learn.microsoft.com/en-us/cli/azure/keyvault

## Profile

- Level 1
