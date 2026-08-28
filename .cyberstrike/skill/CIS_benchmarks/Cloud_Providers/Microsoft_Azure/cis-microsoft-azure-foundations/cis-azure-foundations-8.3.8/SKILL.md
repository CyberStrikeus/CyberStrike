---
name: cis-azure-foundations-8.3.8
description: "Ensure Automatic Key Rotation is Enabled Within Azure Key Vault for the Supported Services"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, key-vault, key-rotation]
cis_id: "8.3.8"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.3.8 Ensure Automatic Key Rotation is Enabled Within Azure Key Vault for the Supported Services (Automated)

## Description

Ensure that automatic key rotation is enabled for cryptographic keys stored in Azure Key Vault, so that keys are periodically rotated without manual intervention, reducing the risk of prolonged key compromise.

## Rationale

Cryptographic keys should be rotated regularly to limit the blast radius of a potential key compromise. Manual key rotation is error-prone and often neglected. Azure Key Vault supports automatic key rotation through rotation policies, which can generate new key versions at specified intervals and notify administrators via Event Grid. Automatic rotation ensures consistent adherence to key rotation schedules and reduces operational burden while improving security posture.

## Impact

Enabling automatic key rotation requires applications to use the latest key version or to reference the key without a specific version (versionless key identifier). Applications that reference specific key versions must be updated to support key rotation. Services that support automatic rotation (such as Azure Storage, Azure Disk Encryption) will seamlessly use the new key version. Custom applications may require testing to ensure compatibility with rotated keys.

## Audit Procedure

**From Azure Portal:**

1. Go to `Key vaults`.
2. Click the name of a Key Vault.
3. Under `Objects`, click `Keys`.
4. Click a key name.
5. Click `Rotation policy`.
6. Verify that a rotation policy is configured with an appropriate rotation interval.

**From Azure CLI:**

```
az keyvault key rotation-policy show --vault-name {vaultName} --name {keyName}
```

Verify that a rotation policy exists with `lifetimeActions` configured.

For all keys in a vault:

```
for key in $(az keyvault key list --vault-name {vaultName} --query "[].name" -o tsv); do
    echo "Key: $key"
    az keyvault key rotation-policy show --vault-name {vaultName} --name $key 2>/dev/null || echo "  No rotation policy"
done
```

**From PowerShell:**

```
$keys = Get-AzKeyVaultKey -VaultName {vaultName}
foreach ($key in $keys) {
    $policy = Get-AzKeyVaultKeyRotationPolicy -VaultName {vaultName} -Name $key.Name
    [PSCustomObject]@{
        KeyName = $key.Name
        RotationPolicy = if ($policy) { "Configured" } else { "Not configured" }
    }
}
```

## Expected Result

All keys in Key Vaults that support automatic rotation should have a rotation policy configured with appropriate rotation intervals.

## Remediation

**From Azure Portal:**

1. Go to `Key vaults`.
2. Click the name of a Key Vault.
3. Under `Objects`, click `Keys`.
4. Click a key name.
5. Click `Rotation policy`.
6. Configure the rotation type (time-based or on-demand).
7. Set the rotation interval (e.g., every 90 days).
8. Optionally configure Event Grid notifications for near-expiry alerts.
9. Click `Save`.

**From Azure CLI:**

```
az keyvault key rotation-policy update --vault-name {vaultName} --name {keyName} --value '{
  "lifetimeActions": [
    {
      "trigger": {"timeAfterCreate": "P90D"},
      "action": {"type": "Rotate"}
    },
    {
      "trigger": {"timeBeforeExpiry": "P30D"},
      "action": {"type": "Notify"}
    }
  ],
  "attributes": {"expiryTime": "P1Y"}
}'
```

**From PowerShell:**

```
$policy = New-AzKeyVaultKeyRotationPolicy -VaultName {vaultName} -Name {keyName} -ExpiresIn "P1Y" -LifetimeAction @{
    Action = "Rotate"
    TimeAfterCreate = "P90D"
}
Set-AzKeyVaultKeyRotationPolicy -VaultName {vaultName} -Name {keyName} -KeyRotationPolicy $policy
```

## Default Value

By default, no rotation policy is configured for keys in Azure Key Vault.

## References

1. https://learn.microsoft.com/en-us/azure/key-vault/keys/how-to-configure-key-rotation
2. https://learn.microsoft.com/en-us/azure/key-vault/keys/overview-key-rotation
3. https://learn.microsoft.com/en-us/cli/azure/keyvault/key/rotation-policy
4. https://learn.microsoft.com/en-us/powershell/module/az.keyvault/set-azkeyvaultkeyrotationpolicy

## Profile

- Level 2
