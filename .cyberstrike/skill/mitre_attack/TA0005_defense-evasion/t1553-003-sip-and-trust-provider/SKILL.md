---
name: "T1553.003_sip-and-trust-provider-hijacking"
description: "Adversaries may tamper with SIP and trust provider components to mislead the operating system and application control tools when conducting signature validation checks."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1553.003
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1553.003"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1553/003"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1553
  - T1553.001
  - T1553.002
  - T1553.004
  - T1553.005
  - T1553.006
prerequisites:
  - T1553
severity_boost:
  T1553: "Chain with T1553 for deeper attack path"
  T1553.001: "Chain with T1553.001 for deeper attack path"
  T1553.002: "Chain with T1553.002 for deeper attack path"
---

# T1553.003 SIP and Trust Provider Hijacking

> **Sub-technique of:** T1553

## High-Level Description

Adversaries may tamper with SIP and trust provider components to mislead the operating system and application control tools when conducting signature validation checks. In user mode, Windows Authenticode digital signatures are used to verify a file's origin and integrity, variables that may be used to establish trust in signed code (ex: a driver with a valid Microsoft signature may be handled as safe). The signature validation process is handled via the WinVerifyTrust application programming interface (API) function, which accepts an inquiry and coordinates with the appropriate trust provider, which is responsible for validating parameters of a signature.

Because of the varying executable file types and corresponding signature formats, Microsoft created software components called Subject Interface Packages (SIPs) to provide a layer of abstraction between API functions and files. SIPs are responsible for enabling API functions to create, retrieve, calculate, and verify signatures. Unique SIPs exist for most file formats (Executable, PowerShell, Installer, etc., with catalog signing providing a catch-all ) and are identified by globally unique identifiers (GUIDs).

Similar to Code Signing, adversaries may abuse this architecture to subvert trust controls and bypass security policies that allow only legitimately signed code to execute on a system. Adversaries may hijack SIP and trust provider components to mislead operating system and application control tools to classify malicious (or any) code as signed by:

- Modifying the <code>Dll</code> and <code>FuncName</code> Registry values in <code>HKLM\SOFTWARE[\WOW6432Node\]Microsoft\Cryptography\OID\EncodingType 0\CryptSIPDllGetSignedDataMsg\{SIP_GUID}</code> that point to the dynamic link library (DLL) providing a SIP’s CryptSIPDllGetSignedDataMsg function, which retrieves an encoded digital certificate from a signed file. By pointing to a maliciously-crafted DLL with an exported function that always returns a known good signature value (ex: a Microsoft signature for Portable Executables) rather than the file’s real signature, an adversary can apply an acceptable signature value to all files using that SIP (although a hash mismatch will likely occur, invalidating the signature, since the hash returned by the function will not match the value computed from the file).
- Modifying the <code>Dll</code> and <code>FuncName</code> Registry values in <code>HKLM\SOFTWARE\[WOW6432Node\]Microsoft\Cryptography\OID\EncodingType 0\CryptSIPDllVerifyIndirectData\{SIP_GUID}</code> that point to the DLL providing a SIP’s CryptSIPDllVerifyIndirectData function, which validates a file’s computed hash against the signed hash value. By pointing to a maliciously-crafted DLL with an exported function that always returns TRUE (indicating that the validation was successful), an adversary can successfully validate any file (with a legitimate signature) using that SIP (with or without hijacking the previously mentioned CryptSIPDllGetSignedDataMsg function). This Registry value could also be redirected to a suitable exported function from an already present DLL, avoiding the requirement to drop and execute a new file on disk.
- Modifying the <code>DLL</code> and <code>Function</code> Registry values in <code>HKLM\SOFTWARE\[WOW6432Node\]Microsoft\Cryptography\Providers\Trust\FinalPolicy\{trust provider GUID}</code> that point to the DLL providing a trust provider’s FinalPolicy function, which is where the decoded and parsed signature is checked and the majority of trust decisions are made. Similar to hijacking SIP’s CryptSIPDllVerifyIndirectData function, this value can be redirected to a suitable exported function from an already present DLL or a maliciously-crafted DLL (though the implementation of a trust provider is complex).
- **Note:** The above hijacks are also possible without modifying the Registry via DLL search order hijacking.

Hijacking SIP or trust provider components can also enable persistent code execution, since these malicious components may be invoked by any application that performs code signing or signature validation.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if SIP and Trust Provider Hijacking technique is applicable to target environment
- [ ] Check Windows systems for indicators of SIP and Trust Provider Hijacking
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: SIP (Subject Interface Package) Hijacking via Custom DLL

Registers a DLL that logs signature checks, mimicking SIP hijacking. This test uses a DLL from
https://github.com/gtworek/PSBits/tree/master/SIP and registers it using regsvr32, thereby causing
the system to utilize it during signature checks, and logging said checks.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
regsvr32.exe #{dll_payload}
```

**Dependencies:**

- GTSIPProvider.dll must exist on disk at specified location (#{dll_payload})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to SIP and Trust Provider Hijacking by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1553.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention

Enable application control solutions such as AppLocker and/or Device Guard to block the loading of malicious SIP DLLs.

### M1024 Restrict Registry Permissions

Ensure proper permissions are set for Registry hives to prevent users from modifying keys related to SIP and trust provider components. Components may still be able to be hijacked to suitable functions already present on disk if malicious modifications to Registry keys are not prevented.

### M1022 Restrict File and Directory Permissions

Restrict storage and execution of SIP DLLs to protected directories, such as C:\\Windows, rather than user directories.

## Detection

### Detection Strategy for Subvert Trust Controls using SIP and Trust Provider Hijacking.

## Risk Assessment

| Finding                                               | Severity | Impact          |
| ----------------------------------------------------- | -------- | --------------- |
| SIP and Trust Provider Hijacking technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Entrust Enable CAPI2 Aug 2017](http://www.entrust.net/knowledge-base/technote.cfm?tn=8165)
- [GitHub SIP POC Sept 2017](https://github.com/mattifestation/PoCSubjectInterfacePackage)
- [SpectorOps Subverting Trust Sept 2017](https://specterops.io/assets/resources/SpecterOps_Subverting_Trust_in_Windows.pdf)
- [Microsoft Catalog Files and Signatures April 2017](https://docs.microsoft.com/windows-hardware/drivers/install/catalog-files)
- [Microsoft Audit Registry July 2012](<https://docs.microsoft.com/previous-versions/windows/it-pro/windows-server-2008-R2-and-2008/dd941614(v=ws.10)>)
- [Microsoft Registry Auditing Aug 2016](<https://docs.microsoft.com/previous-versions/windows/it-pro/windows-server-2012-R2-and-2012/dn311461(v=ws.11)>)
- [Microsoft Authenticode](https://msdn.microsoft.com/library/ms537359.aspx)
- [Microsoft WinVerifyTrust](https://msdn.microsoft.com/library/windows/desktop/aa388208.aspx)
- [EduardosBlog SIPs July 2008](https://blogs.technet.microsoft.com/eduardonavarro/2008/07/11/sips-subject-interface-package-and-authenticode/)
- [Atomic Red Team - T1553.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1553.003)
- [MITRE ATT&CK - T1553.003](https://attack.mitre.org/techniques/T1553/003)
