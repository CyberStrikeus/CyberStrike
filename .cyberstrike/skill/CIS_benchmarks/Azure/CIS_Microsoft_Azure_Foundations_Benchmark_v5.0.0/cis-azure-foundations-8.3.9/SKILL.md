---
name: cis-azure-foundations-8.3.9
description: "Ensure Azure Key Vault Managed HSM is Used for Key Encryption"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, key-vault, managed-hsm, encryption]
cis_id: "8.3.9"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.3.9 Ensure Azure Key Vault Managed HSM is Used for Key Encryption (Manual)

## Description

Ensure that Azure Key Vault Managed HSM (Hardware Security Module) is used for key encryption operations that require the highest level of security, providing FIPS 140-2 Level 3 validated hardware protection for cryptographic keys.

## Rationale

Standard Azure Key Vault protects keys using software-backed or HSM-backed mechanisms at FIPS 140-2 Level 2. For organizations with stringent regulatory or compliance requirements (such as financial services, healthcare, or government), FIPS 140-2 Level 3 validation is required. Azure Key Vault Managed HSM provides dedicated, single-tenant HSM instances that are fully managed by the customer, offering the highest level of key protection. Keys never leave the HSM boundary, and the customer has full administrative control over the HSM security domain.

## Impact

Azure Key Vault Managed HSM has significantly higher costs than standard Key Vault. It requires additional operational setup including security domain initialization with multiple administrators. Not all applications and services support Managed HSM integration. Organizations should evaluate their compliance requirements and application compatibility before adopting Managed HSM. Recovery procedures are more complex and require the security domain backup.

## Audit Procedure

**From Azure Portal:**
1. Go to `Key Vault Managed HSMs` (search in the portal search bar).
2. Verify that Managed HSM instances exist for workloads requiring FIPS 140-2 Level 3 compliance.
3. Click a Managed HSM instance to verify it is in a `Provisioned` state.

**From Azure CLI:**
```
az keyvault list --hsm-name --query "[].{Name:name, Location:location, State:properties.provisioningState}" -o table
```
Verify that Managed HSM instances exist and are in `Succeeded` provisioning state.

**Note:** This is a manual assessment. Organizations must determine which workloads require Managed HSM based on their compliance and security requirements.

## Expected Result

Organizations with FIPS 140-2 Level 3 compliance requirements should have Azure Key Vault Managed HSM instances provisioned and in use for critical key encryption operations.

## Remediation

**From Azure Portal:**
1. Search for `Key Vault Managed HSMs` in the portal.
2. Click `Create managed HSM`.
3. Configure the HSM with the appropriate subscription, resource group, name, and region.
4. Configure the initial administrators.
5. Click `Review + Create`, then `Create`.
6. After provisioning, download and activate the security domain.
7. Migrate keys that require FIPS 140-2 Level 3 protection to the Managed HSM.

**From Azure CLI:**
```
az keyvault create --hsm-name {hsmName} --resource-group {resourceGroup} --location {location} --administrators {objectId1} {objectId2} {objectId3}
```
After creation, activate the security domain:
```
az keyvault security-domain download --hsm-name {hsmName} --sd-wrapping-keys cert1.pem cert2.pem cert3.pem --sd-quorum 2 --security-domain-file {hsmName}-SD.json
```

**From PowerShell:**
```
New-AzKeyVaultManagedHsm -Name {hsmName} -ResourceGroupName {resourceGroup} -Location {location} -Administrator {objectId1},{objectId2},{objectId3}
```

## Default Value

Azure Key Vault Managed HSM is not provisioned by default. Organizations use standard Key Vault by default.

## References

1. https://learn.microsoft.com/en-us/azure/key-vault/managed-hsm/overview
2. https://learn.microsoft.com/en-us/azure/key-vault/managed-hsm/quick-create-cli
3. https://learn.microsoft.com/en-us/azure/key-vault/managed-hsm/security-domain
4. https://learn.microsoft.com/en-us/azure/key-vault/managed-hsm/best-practices
5. https://azure.microsoft.com/en-us/pricing/details/key-vault/

## Profile

- Level 2
