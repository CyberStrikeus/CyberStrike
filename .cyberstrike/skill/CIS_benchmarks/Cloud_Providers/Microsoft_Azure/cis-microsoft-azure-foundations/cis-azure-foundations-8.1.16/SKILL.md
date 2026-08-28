---
name: cis-azure-foundations-8.1.16
description: "Ensure that Microsoft Cloud Security Benchmark policies are not set to 'Disabled'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, security-benchmark, policies]
cis_id: "8.1.16"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.16 Ensure that Microsoft Cloud Security Benchmark policies are not set to 'Disabled' (Automated)

## Description

Ensure that none of the policies within the Microsoft Cloud Security Benchmark (MCSB) initiative assigned to the subscription have been manually disabled, maintaining comprehensive security coverage.

## Rationale

The Microsoft Cloud Security Benchmark (MCSB) is the default security initiative automatically assigned to every subscription in Microsoft Defender for Cloud. It provides a comprehensive set of security policies aligned with industry standards. Disabling individual policies within MCSB reduces the security coverage and creates blind spots in the organization's security posture. All MCSB policies should remain enabled to ensure full compliance assessment and recommendation coverage.

## Impact

Keeping all MCSB policies enabled may generate recommendations for resources that are not in scope or not applicable to the organization's environment. However, the security benefits of comprehensive coverage outweigh the noise from inapplicable recommendations. Organizations can use exemptions for specific resources rather than disabling policies entirely.

## Audit Procedure

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Security policy` blade.
5. Click on `Microsoft Cloud Security Benchmark`.
6. Review the list of policies and ensure none have the `Effect` set to `Disabled`.

**From Azure CLI:**

```
az policy assignment list --scope "/subscriptions/{subscriptionId}" --query "[?displayName=='Microsoft Cloud Security Benchmark']"
```

Then check the policy parameters for any disabled effects:

```
az policy assignment show --name "{assignmentName}" --scope "/subscriptions/{subscriptionId}" --query "parameters"
```

Verify no policy effects are set to `Disabled`.

**From PowerShell:**

```
$assignment = Get-AzPolicyAssignment -Scope "/subscriptions/{subscriptionId}" | Where-Object {$_.Properties.DisplayName -eq "Microsoft Cloud Security Benchmark"}
$assignment.Properties.Parameters | ConvertTo-Json -Depth 10
```

Review the output and verify no policy effects are set to `Disabled`.

## Expected Result

All policies within the Microsoft Cloud Security Benchmark initiative should have their effects set to their default values (typically `Audit` or `AuditIfNotExists`), not `Disabled`.

## Remediation

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Security policy` blade.
5. Click on `Microsoft Cloud Security Benchmark`.
6. For any policy with `Effect` set to `Disabled`, click the policy.
7. Change the `Effect` back to its default value (e.g., `Audit`, `AuditIfNotExists`).
8. Click `Save`.

**From Azure CLI:**

```
az policy assignment update --name "{assignmentName}" --scope "/subscriptions/{subscriptionId}" --params '{"policyParameterName":{"value":"AuditIfNotExists"}}'
```

**From PowerShell:**

```
Set-AzPolicyAssignment -Name "{assignmentName}" -Scope "/subscriptions/{subscriptionId}" -PolicyParameter '{"policyParameterName":{"value":"AuditIfNotExists"}}'
```

## Default Value

The Microsoft Cloud Security Benchmark is automatically assigned to all subscriptions with all policies enabled by default.

## References

1. https://learn.microsoft.com/en-us/security/benchmark/azure/overview
2. https://learn.microsoft.com/en-us/azure/defender-for-cloud/security-policy-concept
3. https://learn.microsoft.com/en-us/azure/defender-for-cloud/update-regulatory-compliance-packages
4. https://learn.microsoft.com/en-us/azure/governance/policy/concepts/effects

## Profile

- Level 1
