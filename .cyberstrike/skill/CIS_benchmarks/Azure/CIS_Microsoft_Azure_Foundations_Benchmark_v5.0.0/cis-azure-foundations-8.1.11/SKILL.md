---
name: cis-azure-foundations-8.1.11
description: "Ensure That Microsoft Defender Recommendation for 'Apply system updates' status is 'Completed'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, system-updates]
cis_id: "8.1.11"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.11 Ensure That Microsoft Defender Recommendation for 'Apply system updates' status is 'Completed' (Automated)

## Description

Ensure that the Microsoft Defender for Cloud recommendation for applying system updates has been resolved and its status shows as 'Completed', indicating all virtual machines have the latest security and critical updates installed.

## Rationale

Keeping virtual machines up to date with the latest security and critical updates is essential for maintaining a strong security posture. Unpatched systems are a primary attack vector for adversaries. Microsoft Defender for Cloud continuously assesses the update status of machines and generates recommendations when updates are missing. Ensuring the 'Apply system updates' recommendation is completed confirms that all monitored machines have been patched.

## Impact

Applying system updates may require maintenance windows and can cause temporary service disruption during reboots. Organizations should plan update schedules to minimize impact on production workloads. Automatic update mechanisms (e.g., Azure Update Management) can help streamline this process.

## Audit Procedure

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `General`, click `Recommendations`.
3. In the search box, type `Apply system updates`.
4. Verify that the recommendation status shows `Completed` (green checkmark).
5. If the status is `Not Completed`, click the recommendation to see which resources are missing updates.

**From Azure CLI:**
```
az security assessment list --query "[?displayName=='System updates should be installed on your machines'].{Name:displayName, Status:status.code}" -o table
```
Ensure `Status` shows `Healthy` for all assessments.

**From PowerShell:**
```
Get-AzSecurityAssessment | Where-Object {$_.DisplayName -like "*System updates*"} | Select-Object DisplayName, @{N="Status";E={$_.Status.Code}}
```
Ensure all results show `Healthy`.

## Expected Result

The 'Apply system updates' recommendation should show status `Completed` or all assessments should return `Healthy`.

## Remediation

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `General`, click `Recommendations`.
3. Search for `Apply system updates`.
4. Click the recommendation to view affected resources.
5. For each affected resource, follow the remediation steps to install the missing updates.
6. Alternatively, use Azure Update Management to automate the process.

**Using Azure Update Management:**
1. Go to `Azure Automation` or `Azure Update Manager`.
2. Configure update schedules for all virtual machines.
3. Enable periodic assessment to automatically check for missing updates.
4. Deploy updates during scheduled maintenance windows.

## Default Value

By default, Microsoft Defender for Cloud monitors update status but does not automatically apply updates.

## References

1. https://learn.microsoft.com/en-us/azure/defender-for-cloud/recommendations-reference
2. https://learn.microsoft.com/en-us/azure/defender-for-cloud/apply-security-recommendations
3. https://learn.microsoft.com/en-us/azure/update-manager/overview
4. https://learn.microsoft.com/en-us/azure/automation/update-management/overview

## Profile

- Level 1
