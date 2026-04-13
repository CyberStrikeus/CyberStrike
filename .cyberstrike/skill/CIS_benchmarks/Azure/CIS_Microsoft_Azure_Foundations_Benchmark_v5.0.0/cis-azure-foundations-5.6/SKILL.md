---
name: cis-azure-foundations-5.6
description: "Ensure account 'Lockout threshold' is less than or equal to '10'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, account-lockout, brute-force, password-protection]
cis_id: "5.6"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.7, cis-azure-foundations-5.8]
prerequisites: []
severity_boost: {}
---

# Ensure account 'Lockout threshold' is less than or equal to '10'

## Description

The account lockout threshold determines how many failed login attempts are permitted prior to placing the account in a locked-out state and initiating a variable lockout duration.

## Rationale

Account lockout is a method of protecting against brute-force and password spray attacks. Once the lockout threshold has been exceeded, the account enters a locked-out state which prevents all login attempts for a variable duration. The lockout in combination with a reasonable duration reduces the total number of failed login attempts that a malicious actor can execute in a given period of time.

## Impact

If account lockout threshold is set too low (less than 3), users may experience frequent lockout events and the resulting security alerts may contribute to alert fatigue. If account lockout threshold is set too high (more than 10), malicious actors can programmatically execute more password attempts in a given period of time.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu.
2. Select `Microsoft Entra ID`.
3. Under `Manage`, select `Security`.
4. Under `Manage`, select `Authentication methods`.
5. Under `Manage`, select `Password protection`.
6. Ensure that `Lockout threshold` is set to `10` or fewer.

### Using PowerShell

```powershell
Connect-MgGraph -Scopes "Policy.ReadWrite.AuthenticationMethod"
$p = (Get-MgPolicyAuthenticationMethodsPolicy).PasswordProtection
if ($p.LockoutThreshold -gt 10) {
    Update-MgPolicyAuthenticationMethodsPolicy -BodyParameter @{
        passwordProtection = @{
            lockoutThreshold = 10
            lockoutDuration = [Math]::Max($p.LockoutDuration, 60)
        }
    }
}
Disconnect-MgGraph
```

### Using Azure CLI

```bash
az rest --method get \
  --url 'https://graph.microsoft.com/v1.0/policies/authenticationMethodsPolicy' \
  --query 'passwordProtection.lockoutThreshold'
```

## Expected Result

`Lockout threshold` should be `10` or fewer.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu.
2. Select `Microsoft Entra ID`.
3. Under `Manage`, select `Security`.
4. Under `Manage`, select `Authentication methods`.
5. Under `Manage`, select `Password protection`.
6. Set `Lockout threshold` to `10` or fewer.
7. Click `Save`.

### Using PowerShell

```powershell
Connect-MgGraph -Scopes "Policy.ReadWrite.AuthenticationMethod"
Update-MgPolicyAuthenticationMethodsPolicy -PasswordProtection @{
    LockoutThreshold = 10
    LockoutDuration = "PT1M"
}
```

### Using Azure CLI

```bash
az rest --method patch \
  --url 'https://graph.microsoft.com/v1.0/policies/authenticationMethodsPolicy' \
  --headers 'Content-Type=application/json' \
  --body '{"passwordProtection":{"lockoutThreshold":10,"lockoutDuration":"PT1M"}}'
```

## Default Value

By default, Lockout threshold is set to `10`.

## References

1. https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout#manage-microsoft-entra-smart-lockout-values

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.10 Enforce Automatic Device Lockout on Portable End-User Devices | | x | x |

## Profile

Level 1 | Manual
