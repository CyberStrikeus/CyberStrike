---
name: "T1221_template-injection"
description: "Adversaries may create or modify references in user document templates to conceal malicious code or force authentication attempts."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1221
  - defense-evasion
  - windows
technique_id: "T1221"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1221"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1221 Template Injection

## High-Level Description

Adversaries may create or modify references in user document templates to conceal malicious code or force authentication attempts. For example, Microsoft’s Office Open XML (OOXML) specification defines an XML-based format for Office documents (.docx, xlsx, .pptx) to replace older binary formats (.doc, .xls, .ppt). OOXML files are packed together ZIP archives compromised of various XML files, referred to as parts, containing properties that collectively define how a document is rendered.

Properties within parts may reference shared public resources accessed via online URLs. For example, template properties may reference a file, serving as a pre-formatted document blueprint, that is fetched when the document is loaded.

Adversaries may abuse these templates to initially conceal malicious code to be executed via user documents. Template references injected into a document may enable malicious payloads to be fetched and executed when the document is loaded. These documents can be delivered via other techniques such as Phishing and/or Taint Shared Content and may evade static detections since no typical indicators (VBA macro, script, etc.) are present until after the malicious payload is fetched. Examples have been seen in the wild where template injection was used to load malicious code containing an exploit.

Adversaries may also modify the <code>\*\template</code> control word within an .rtf file to similarly conceal then download malicious code. This legitimate control word value is intended to be a file destination of a template file resource that is retrieved and loaded when an .rtf file is opened. However, adversaries may alter the bytes of an existing .rtf file to insert a template control word field to include a URL resource of a malicious payload.

This technique may also enable Forced Authentication by injecting a SMB/HTTPS (or other credential prompting) URL and triggering an authentication attempt.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Template Injection technique is applicable to target environment
- [ ] Check Windows systems for indicators of Template Injection
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: WINWORD Remote Template Injection

Open a .docx file that loads a remote .dotm macro enabled template from https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1221/src/opencalc.dotm
Executes the code specified within the .dotm template.
Requires download of WINWORD found in Microsoft Ofiice at Microsoft: https://www.microsoft.com/en-us/download/office.aspx.  
Default docs file opens Calculator.exe when test sucessfully executed, while AV turned off.

**Supported Platforms:** windows

```cmd
start "#{docx_file}"
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Template Injection by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1221 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1049 Antivirus/Antimalware

Network/Host intrusion prevention systems, antivirus, and detonation chambers can be employed to prevent documents from fetching and/or executing malicious payloads.

### M1031 Network Intrusion Prevention

Network/Host intrusion prevention systems, antivirus, and detonation chambers can be employed to prevent documents from fetching and/or executing malicious payloads.

### M1017 User Training

Train users to identify social engineering techniques and spearphishing emails that could be used to deliver malicious documents.

### M1042 Disable or Remove Feature or Program

Consider disabling Microsoft Office macros/active content to prevent the execution of malicious payloads in documents , though this setting may not mitigate the Forced Authentication use for this technique.

## Detection

### Template Injection Detection - Windows

## Risk Assessment

| Finding                                 | Severity | Impact          |
| --------------------------------------- | -------- | --------------- |
| Template Injection technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Microsoft Open XML July 2017](<https://docs.microsoft.com/previous-versions/office/developer/office-2007/aa338205(v=office.12)>)
- [SANS Brian Wiltse Template Injection](https://www.sans.org/reading-room/whitepapers/testing/template-injection-attacks-bypassing-security-controls-living-land-38780)
- [Redxorblue Remote Template Injection](http://blog.redxorblue.com/2018/07/executing-macros-from-docx-with-remote.html)
- [MalwareBytes Template Injection OCT 2017](https://blog.malwarebytes.com/threat-analysis/2017/10/decoy-microsoft-word-document-delivers-malware-through-rat/)
- [Proofpoint RTF Injection](https://www.proofpoint.com/us/blog/threat-insight/injection-new-black-novel-rtf-template-inject-technique-poised-widespread)
- [Ciberseguridad Decoding malicious RTF files](https://ciberseguridad.blog/decodificando-ficheros-rtf-maliciosos/)
- [Anomali Template Injection MAR 2018](https://forum.anomali.com/t/credential-harvesting-and-malicious-file-delivery-using-microsoft-office-template-injection/2104)
- [Talos Template Injection July 2017](https://blog.talosintelligence.com/2017/07/template-injection.html)
- [ryhanson phishery SEPT 2016](https://github.com/ryhanson/phishery)
- [Atomic Red Team - T1221](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1221)
- [MITRE ATT&CK - T1221](https://attack.mitre.org/techniques/T1221)
