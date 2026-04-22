---
name: "T1574.001_dll"
description: "Adversaries may abuse dynamic-link library files (DLLs) in order to achieve persistence, escalate privileges, and evade defenses."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1574.001
  - persistence
  - privilege-escalation
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1574.001"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1574/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1574
  - T1574.004
  - T1574.005
  - T1574.006
  - T1574.007
  - T1574.008
  - T1574.009
  - T1574.010
  - T1574.011
  - T1574.012
  - T1574.013
  - T1574.014
prerequisites:
  - T1574
severity_boost:
  T1574: "Chain with T1574 for deeper attack path"
  T1574.004: "Chain with T1574.004 for deeper attack path"
  T1574.005: "Chain with T1574.005 for deeper attack path"
---

# T1574.001 DLL

> **Sub-technique of:** T1574

## High-Level Description

Adversaries may abuse dynamic-link library files (DLLs) in order to achieve persistence, escalate privileges, and evade defenses. DLLs are libraries that contain code and data that can be simultaneously utilized by multiple programs. While DLLs are not malicious by nature, they can be abused through mechanisms such as side-loading, hijacking search order, and phantom DLL hijacking.

Specific ways DLLs are abused by adversaries include:

### DLL Sideloading
Adversaries may execute their own malicious payloads by side-loading DLLs. Side-loading involves hijacking which DLL a program loads by planting and then invoking a legitimate application that executes their payload(s).

Side-loading positions both the victim application and malicious payload(s) alongside each other. Adversaries likely use side-loading as a means of masking actions they perform under a legitimate, trusted, and potentially elevated system or software process. Benign executables used to side-load payloads may not be flagged during delivery and/or execution. Adversary payloads may also be encrypted/packed or otherwise obfuscated until loaded into the memory of the trusted process.

Adversaries may also side-load other packages, such as BPLs (Borland Package Library).

Adversaries may chain DLL sideloading multiple times to fragment functionality hindering analysis. Adversaries using multiple DLL files can split the loader functions across different DLLs, with a main DLL loading the separated export functions. Spreading loader functions across multiple DLLs makes analysis harder, since all files must be collected to fully understand the malware’s behavior. Another method implements a “loader-for-a-loader”, where a malicious DLL’s sole role is to load a second DLL (or a chain of DLLs) that contain the real payload. 

### DLL Search Order Hijacking
Adversaries may execute their own malicious payloads by hijacking the search order that Windows uses to load DLLs. This search order is a sequence of special and standard search locations that a program checks when loading a DLL. An adversary can plant a trojan DLL in a directory that will be prioritized by the DLL search order over the location of a legitimate library. This will cause Windows to load the malicious DLL when it is called for by the victim program.

### DLL Redirection
Adversaries may directly modify the search order via DLL redirection, which after being enabled (in the Registry or via the creation of a redirection file) may cause a program to load a DLL from a different location.

### Phantom DLL Hijacking
Adversaries may leverage phantom DLL hijacking by targeting references to non-existent DLL files. They may be able to load their own malicious DLL by planting it with the correct name in the location of the missing module.

### DLL Substitution
Adversaries may target existing, valid DLL files and substitute them with their own malicious DLLs, planting them with the same name and in the same location as the valid DLL file.

Programs that fall victim to DLL hijacking may appear to behave normally because malicious DLLs may be configured to also load the legitimate DLLs they were meant to replace, evading defenses.

Remote DLL hijacking can occur when a program sets its current directory to a remote location, such as a Web share, before loading a DLL.

If a valid DLL is configured to run at a higher privilege level, then the adversary-controlled DLL that is loaded will also be executed at the higher level. In this case, the technique could be used for privilege escalation.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)
- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if DLL technique is applicable to target environment
- [ ] Check Windows systems for indicators of DLL
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: DLL Search Order Hijacking - amsi.dll

Adversaries can take advantage of insecure library loading by PowerShell to load a vulnerable version of amsi.dll in order to bypass AMSI (Anti-Malware Scanning Interface)
https://enigma0x3.net/2017/07/19/bypassing-amsi-via-com-server-hijacking/

Upon successful execution, powershell.exe will be copied and renamed to updater.exe and load amsi.dll from a non-standard path.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
copy %windir%\System32\windowspowershell\v1.0\powershell.exe %APPDATA%\updater.exe
copy %windir%\System32\amsi.dll %APPDATA%\amsi.dll
%APPDATA%\updater.exe -Command exit
```

### Atomic Test 2: Phantom Dll Hijacking - WinAppXRT.dll

.NET components (a couple of DLLs loaded anytime .NET apps are executed) when they are loaded they look for an environment variable called APPX_PROCESS
Setting the environmental variable and dropping the phantom WinAppXRT.dll in e.g. c:\windows\system32 (or any other location accessible via PATH) will ensure the 
WinAppXRT.dll is loaded everytime user launches an application using .NET.

Upon successful execution, amsi.dll will be copied and renamed to WinAppXRT.dll and then WinAppXRT.dll will be copied to system32 folder for loading during execution of any .NET application.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
copy %windir%\System32\amsi.dll %APPDATA%\amsi.dll
ren %APPDATA%\amsi.dll WinAppXRT.dll
copy %APPDATA%\WinAppXRT.dll %windir%\System32\WinAppXRT.dll
reg add "HKEY_CURRENT_USER\Environment" /v APPX_PROCESS /t REG_EXPAND_SZ /d "1" /f
```

### Atomic Test 3: Phantom Dll Hijacking - ualapi.dll

Re-starting the Print Spooler service leads to C:\Windows\System32\ualapi.dll being loaded
A malicious ualapi.dll placed in the System32 directory will lead to its execution whenever the system starts

Upon successful execution, amsi.dll will be copied and renamed to ualapi.dll and then ualapi.dll will be copied to system32 folder for loading during system restart.
Print Spooler service is also configured to auto start. Reboot of system is required

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
copy %windir%\System32\amsi.dll %APPDATA%\amsi.dll
ren %APPDATA%\amsi.dll ualapi.dll
copy %APPDATA%\ualapi.dll %windir%\System32\ualapi.dll
sc config Spooler start=auto
```

### Atomic Test 4: DLL Side-Loading using the Notepad++ GUP.exe binary

GUP is an open source signed binary used by Notepad++ for software updates, and is vulnerable to DLL Side-Loading, thus enabling the libcurl dll to be loaded.
Upon execution, calc.exe will be opened.

**Supported Platforms:** windows

```cmd
"#{gup_executable}"
```

**Dependencies:**
- Gup.exe binary must exist on disk at specified location (#{gup_executable})

### Atomic Test 5: DLL Side-Loading using the dotnet startup hook environment variable

Utilizing the dotnet_startup_hooks environment variable, this method allows for registering a global method in an assembly that will be executed whenever a .net core application is started. This unlocks a whole range of scenarios, from injecting a profiler to tweaking a static context in a given environment. [blog post](https://medium.com/criteo-engineering/c-have-some-fun-with-net-core-startup-hooks-498b9ad001e1)

**Supported Platforms:** windows

```cmd
set DOTNET_STARTUP_HOOKS="#{preloader_dll}"
dotnet -h > nul
echo.
```

**Dependencies:**
- .Net SDK must be installed
- preloader must exist


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to DLL by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1574.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention
Identify and block potentially malicious software executed through DLL hijacking by using application control solutions capable of blocking DLLs loaded by legitimate software.

### M1044 Restrict Library Loading
Disallow loading of remote DLLs. This is included by default in Windows Server 2012+ and is available by patch for XP+ and Server 2003+.

Enable Safe DLL Search Mode to move the user's current folder later in the search order. This is included by default in modern versions of Windows; the associated Windows Registry key is located at <code>HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\SafeDLLSearchMode</code>.

### M1051 Update Software
Update software regularly to include patches that fix DLL side-loading vulnerabilities.

### M1047 Audit
Use auditing tools capable of detecting DLL search order hijacking opportunities on systems within an enterprise and correct them. Toolkits like the PowerSploit framework contain PowerUp modules that can be used to explore systems for DLL hijacking weaknesses.

Use the program `sxstrace.exe` that is included with Windows, along with manual inspection, to check manifest files for side-by-side problems in software.

### M1013 Application Developer Guidance
When possible, include hash values in manifest files to help prevent side-loading of malicious libraries.


## Detection

### Detection Strategy for Hijack Execution Flow for DLLs


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| DLL technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Hijack DLLs CrowdStrike](https://www.crowdstrike.com/en-us/blog/4-ways-adversaries-hijack-dlls/)
- [kroll bpl](https://www.kroll.com/en/insights/publications/cyber/idatloader-distribution)
- [Sophos](https://news.sophos.com/en-us/2023/05/03/doubled-dll-sideloading-dragon-breath/)
- [Hexacorn DLL Hijacking](https://www.hexacorn.com/blog/2013/12/08/beyond-good-ol-run-key-part-5/)
- [microsoft remote preloading](https://learn.microsoft.com/en-us/security-updates/securityadvisories/2010/2269637)
- [Microsoft - manifests/assembly](https://learn.microsoft.com/en-us/windows/win32/sbscs/manifests?redirectedfrom=MSDN)
- [Microsoft redirection](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-redirection?redirectedfrom=MSDN)
- [dll pre load owasp](https://owasp.org/www-community/attacks/Binary_planting)
- [Virus Bulletin](https://www.virusbulletin.com/conference/vb2023/abstracts/unveiling-activities-tropic-trooper-2023-deep-analysis-xiangoop-loader-and-entryshell-payload/)
- [unit 42](https://unit42.paloaltonetworks.com/dll-hijacking-techniques/)
- [Wietze Beukema DLL Hijacking](https://www.wietzebeukema.nl/blog/hijacking-dlls-in-windows)
- [Atomic Red Team - T1574.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1574.001)
- [MITRE ATT&CK - T1574.001](https://attack.mitre.org/techniques/T1574/001)
