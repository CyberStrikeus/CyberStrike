---
name: "T1140_deobfuscatedecode-files-or-information"
description: "Adversaries may use Obfuscated Files or Information to hide artifacts of an intrusion from analysis."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1140
  - defense-evasion
  - esxi
  - linux
  - macos
  - windows
technique_id: "T1140"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1140"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1140 Deobfuscate/Decode Files or Information

## High-Level Description

Adversaries may use Obfuscated Files or Information to hide artifacts of an intrusion from analysis. They may require separate mechanisms to decode or deobfuscate that information depending on how they intend to use it. Methods for doing that include built-in functionality of malware or by using utilities present on the system.

One such example is the use of certutil to decode a remote access tool portable executable file that has been hidden inside a certificate file. Another example is using the Windows <code>copy /b</code> or <code>type</code> command to reassemble binary fragments into a malicious payload.

Sometimes a user's action may be required to open it for deobfuscation or decryption as part of User Execution. The user may also be required to input a password to open a password protected compressed/encrypted file that was provided by the adversary.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Deobfuscate/Decode Files or Information technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Deobfuscate/Decode Files or Information
- [ ] Check Linux systems for indicators of Deobfuscate/Decode Files or Information
- [ ] Check macOS systems for indicators of Deobfuscate/Decode Files or Information
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Deobfuscate/Decode Files Or Information

Encode/Decode executable
Upon execution a file named T1140_calc_decoded.exe will be placed in the temp folder

**Supported Platforms:** windows

```cmd
certutil -encode #{executable} %temp%\T1140_calc.txt
certutil -decode %temp%\T1140_calc.txt %temp%\T1140_calc_decoded.exe
```

### Atomic Test 2: Certutil Rename and Decode

Rename certutil and decode a file. This is in reference to latest research by FireEye [here](https://www.fireeye.com/blog/threat-research/2018/09/apt10-targeting-japanese-corporations-using-updated-ttps.html)

**Supported Platforms:** windows

```cmd
copy %windir%\system32\certutil.exe %temp%\tcm.tmp
%temp%\tcm.tmp -encode #{executable} %temp%\T1140_calc2.txt
%temp%\tcm.tmp -decode %temp%\T1140_calc2.txt %temp%\T1140_calc2_decoded.exe
```

### Atomic Test 3: Base64 decoding with Python

Use Python to decode a base64-encoded text string and echo it to the console

**Supported Platforms:** linux, macos

```bash
ENCODED=$(python3 -c 'import base64;enc=base64.b64encode("#{message}".encode());print(enc.decode())')
python3 -c "import base64;dec=base64.b64decode(\"$ENCODED\");print(dec.decode())"
python3 -c "import base64 as d;dec=d.b64decode(\"$ENCODED\");print(dec.decode())"
python3 -c "from base64 import b64decode;dec=b64decode(\"$ENCODED\");print(dec.decode())"
python3 -c "from base64 import b64decode as d;dec=d(\"$ENCODED\");print(dec.decode())"
echo $ENCODED | python3 -c "import base64,sys;dec=base64.b64decode(sys.stdin.read());print(dec.decode())"
echo $ENCODED > #{encoded_file} && python3 -c "import base64;dec=base64.b64decode(open('#{encoded_file}').read());print(dec.decode())"
```

**Dependencies:**
- Python must be present

### Atomic Test 4: Base64 decoding with Perl

Use Perl to decode a base64-encoded text string and echo it to the console

**Supported Platforms:** linux, macos

```bash
ENCODED=$(perl -e "use MIME::Base64;print(encode_base64('#{message}'));")
perl -le "use MIME::Base64;print(decode_base64('$ENCODED'));"
echo $ENCODED | perl -le 'use MIME::Base64;print(decode_base64(<STDIN>));'
echo $ENCODED > #{encoded_file} && perl -le 'use MIME::Base64;open($f,"<","#{encoded_file}");print(decode_base64(<$f>));'
```

**Dependencies:**
- Perl must be present

### Atomic Test 5: Base64 decoding with shell utilities

Use common shell utilities to decode a base64-encoded text string and echo it to the console

**Supported Platforms:** linux, macos

```bash
ENCODED=$(echo '#{message}' | base64)
printf $ENCODED | base64 -d
echo $ENCODED | base64 -d
echo $(echo $ENCODED) | base64 -d
echo $ENCODED > #{encoded_file} && base64 -d #{encoded_file}
echo $ENCODED > #{encoded_file} && base64 -d < #{encoded_file}
echo $ENCODED > #{encoded_file} && cat #{encoded_file} | base64 -d
echo $ENCODED > #{encoded_file} && cat < #{encoded_file} | base64 -d
bash -c "{echo,\"$(echo $ENCODED)\"}|{base64,-d}"
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Deobfuscate/Decode Files or Information by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1140 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detect Adversary Deobfuscation or Decoding of Files and Payloads


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Deobfuscate/Decode Files or Information technique applicable | Medium | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Volexity PowerDuke November 2016](https://www.volexity.com/blog/2016/11/09/powerduke-post-election-spear-phishing-campaigns-targeting-think-tanks-and-ngos/)
- [Sentinel One Tainted Love 2023](https://www.sentinelone.com/labs/operation-tainted-love-chinese-apts-target-telcos-in-new-attacks/)
- [Malwarebytes Targeted Attack against Saudi Arabia](https://blog.malwarebytes.com/cybercrime/social-engineering-cybercrime/2017/03/new-targeted-attack-saudi-arabia-government/)
- [Carbon Black Obfuscation Sept 2016](https://www.carbonblack.com/2016/09/23/security-advisory-variants-well-known-adware-families-discovered-include-sophisticated-obfuscation-techniques-previously-associated-nation-state-attacks/)
- [Atomic Red Team - T1140](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1140)
- [MITRE ATT&CK - T1140](https://attack.mitre.org/techniques/T1140)
