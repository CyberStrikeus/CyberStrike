---
name: "T1505.004_iis-components"
description: "Adversaries may install malicious components that run on Internet Information Services (IIS) web servers to establish persistence."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1505.004
  - persistence
  - windows
  - sub-technique
technique_id: "T1505.004"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1505/004"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1505
  - T1505.001
  - T1505.002
  - T1505.003
  - T1505.005
  - T1505.006
prerequisites:
  - T1505
severity_boost:
  T1505: "Chain with T1505 for deeper attack path"
  T1505.001: "Chain with T1505.001 for deeper attack path"
  T1505.002: "Chain with T1505.002 for deeper attack path"
---

# T1505.004 IIS Components

> **Sub-technique of:** T1505

## High-Level Description

Adversaries may install malicious components that run on Internet Information Services (IIS) web servers to establish persistence. IIS provides several mechanisms to extend the functionality of the web servers. For example, Internet Server Application Programming Interface (ISAPI) extensions and filters can be installed to examine and/or modify incoming and outgoing IIS web requests. Extensions and filters are deployed as DLL files that export three functions: <code>Get{Extension/Filter}Version</code>, <code>Http{Extension/Filter}Proc</code>, and (optionally) <code>Terminate{Extension/Filter}</code>. IIS modules may also be installed to extend IIS web servers.

Adversaries may install malicious ISAPI extensions and filters to observe and/or modify traffic, execute commands on compromised machines, or proxy command and control traffic. ISAPI extensions and filters may have access to all IIS web requests and responses. For example, an adversary may abuse these mechanisms to modify HTTP responses in order to distribute malicious commands/content to previously comprised hosts.

Adversaries may also install malicious IIS modules to observe and/or modify traffic. IIS 7.0 introduced modules that provide the same unrestricted access to HTTP requests and responses as ISAPI extensions and filters. IIS modules can be written as a DLL that exports <code>RegisterModule</code>, or as a .NET application that interfaces with ASP.NET APIs to access IIS HTTP requests.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if IIS Components technique is applicable to target environment
- [ ] Check Windows systems for indicators of IIS Components
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Install IIS Module using AppCmd.exe

The following Atomic will utilize AppCmd.exe to install a new IIS Module. IIS must be installed.
This atomic utilizes a DLL on disk, but to test further suspiciousness, compile and load [IIS-Raid](https://www.mdsec.co.uk/2020/02/iis-raid-backdooring-iis-using-native-modules/).
A successful execution will install a module into IIS using AppCmd.exe.
[Managing and installing Modules Reference](https://learn.microsoft.com/en-us/iis/get-started/introduction-to-iis/iis-modules-overview#to-install-a-module-using-appcmdexe)
[IIS Modules](https://www.microsoft.com/en-us/security/blog/2022/12/12/iis-modules-the-evolution-of-web-shells-and-how-to-detect-them/)

**Supported Platforms:** windows

```cmd
%windir%\system32\inetsrv\appcmd.exe install module /name:#{module_name} /image:#{dll_path}
```

**Dependencies:**

- IIS must be installed in order to add a module to IIS.

### Atomic Test 2: Install IIS Module using PowerShell Cmdlet New-WebGlobalModule

The following Atomic will utilize PowerShell Cmdlet New-WebGlobalModule to install a new IIS Module. IIS must be installed.
This atomic utilizes a DLL on disk, but to test further suspiciousness, compile and load [IIS-Raid](https://www.mdsec.co.uk/2020/02/iis-raid-backdooring-iis-using-native-modules/).
A successful execution will install a module into IIS using New-WebGlobalModule.
[Managing IIS Modules with PowerShell](https://learn.microsoft.com/en-us/powershell/module/webadministration/set-webglobalmodule?view=windowsserver2022-ps)
[IIS Modules](https://www.microsoft.com/en-us/security/blog/2022/12/12/iis-modules-the-evolution-of-web-shells-and-how-to-detect-them/)

**Supported Platforms:** windows

```powershell
New-WebGlobalModule -Name #{module_name} -Image #{dll_path}
```

**Dependencies:**

- IIS must be installed in order to add a module to IIS.

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to IIS Components by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1505.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management

Do not allow administrator accounts that have permissions to add IIS components to be used for day-to-day operations that may expose these permissions to potential adversaries and/or other unprivileged systems.

### M1038 Execution Prevention

Restrict unallowed ISAPI extensions and filters from running by specifying a list of ISAPI extensions and filters that can run on IIS.

### M1047 Audit

Regularly check installed IIS components to verify the integrity of the web server and identify if unexpected changes have been made.

### M1045 Code Signing

Ensure IIS DLLs and binaries are signed by the correct application developers.

## Detection

### Detection Strategy for T1505.004 - Malicious IIS Components

## Risk Assessment

| Finding                             | Severity | Impact      |
| ----------------------------------- | -------- | ----------- |
| IIS Components technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Dell TG-3390](https://www.secureworks.com/research/threat-group-3390-targets-organizations-for-cyberespionage)
- [Unit 42 RGDoor Jan 2018](https://researchcenter.paloaltonetworks.com/2018/01/unit42-oilrig-uses-rgdoor-iis-backdoor-targets-middle-east/)
- [Trustwave IIS Module 2013](https://www.trustwave.com/en-us/resources/blogs/spiderlabs-blog/the-curious-case-of-the-malicious-iis-module/)
- [ESET IIS Malware 2021](https://i.blackhat.com/USA21/Wednesday-Handouts/us-21-Anatomy-Of-Native-Iis-Malware-wp.pdf)
- [IIS Backdoor 2011](https://web.archive.org/web/20170106175935/http:/esec-lab.sogeti.com/posts/2011/02/02/iis-backdoor.html)
- [Microsoft IIS Modules Overview 2007](https://docs.microsoft.com/en-us/iis/get-started/introduction-to-iis/iis-modules-overview)
- [Microsoft ISAPI Extension All Incoming 2017](<https://docs.microsoft.com/en-us/previous-versions/iis/6.0-sdk/ms525696(v=vs.90)>)
- [Microsoft ISAPI Extension Overview 2017](<https://docs.microsoft.com/en-us/previous-versions/iis/6.0-sdk/ms525172(v=vs.90)>)
- [Microsoft ISAPI Filter Overview 2017](<https://docs.microsoft.com/en-us/previous-versions/iis/6.0-sdk/ms524610(v=vs.90)>)
- [MMPC ISAPI Filter 2012](https://web.archive.org/web/20140804175025/http:/blogs.technet.com/b/mmpc/archive/2012/10/03/malware-signed-with-the-adobe-code-signing-certificate.aspx)
- [Atomic Red Team - T1505.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1505.004)
- [MITRE ATT&CK - T1505.004](https://attack.mitre.org/techniques/T1505/004)
