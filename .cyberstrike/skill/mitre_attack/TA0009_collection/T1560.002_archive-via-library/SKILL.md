---
name: "T1560.002_archive-via-library"
description: "An adversary may compress or encrypt data that is collected prior to exfiltration using 3rd party libraries."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1560.002
  - collection
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1560.002"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1560/002"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1560
  - T1560.001
  - T1560.003
prerequisites:
  - T1560
severity_boost:
  T1560: "Chain with T1560 for deeper attack path"
  T1560.001: "Chain with T1560.001 for deeper attack path"
  T1560.003: "Chain with T1560.003 for deeper attack path"
---

# T1560.002 Archive via Library

> **Sub-technique of:** T1560

## High-Level Description

An adversary may compress or encrypt data that is collected prior to exfiltration using 3rd party libraries. Many libraries exist that can archive data, including Python rarfile , libzip , and zlib . Most libraries include functionality to encrypt and/or compress data.

Some archival libraries are preinstalled on systems, such as bzip2 on macOS and Linux, and zip on Windows. Note that the libraries are different from the utilities. The libraries can be linked against when compiling, while the utilities require spawning a subshell, or a similar execution mechanism.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Archive via Library technique is applicable to target environment
- [ ] Check Linux systems for indicators of Archive via Library
- [ ] Check macOS systems for indicators of Archive via Library
- [ ] Check Windows systems for indicators of Archive via Library
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Compressing data using GZip in Python (FreeBSD/Linux)

Uses GZip from Python to compress files

**Supported Platforms:** linux

```bash
which_python=`which python || which python3`
$which_python -c "import gzip;input_file=open('#{path_to_input_file}', 'rb');content=input_file.read();input_file.close();output_file=gzip.GzipFile('#{path_to_output_file}','wb',compresslevel=6);output_file.write(content);output_file.close();"
```

**Dependencies:**

- Requires Python

### Atomic Test 2: Compressing data using bz2 in Python (FreeBSD/Linux)

Uses bz2 from Python to compress files

**Supported Platforms:** linux

```bash
which_python=`which python || which python3`
$which_python -c "import bz2;input_file=open('#{path_to_input_file}','rb');content=input_file.read();input_file.close();bz2content=bz2.compress(content,compresslevel=9);output_file=open('#{path_to_output_file}','w+');output_file.write(str(bz2content));output_file.close();"
```

**Dependencies:**

- Requires Python

### Atomic Test 3: Compressing data using zipfile in Python (FreeBSD/Linux)

Uses zipfile from Python to compress files

**Supported Platforms:** linux

```bash
which_python=`which python || which python3`
$which_python -c "from zipfile import ZipFile; ZipFile('#{path_to_output_file}', mode='w').write('#{path_to_input_file}')"
```

**Dependencies:**

- Requires Python

### Atomic Test 4: Compressing data using tarfile in Python (FreeBSD/Linux)

Uses tarfile from Python to compress files

**Supported Platforms:** linux

```bash
which_python=`which python || which python3`
$which_python -c "import tarfile; output_file = tarfile.open('#{path_to_output_file}','w'); output_file.add('#{path_to_input_file}'); output_file.close()"
```

**Dependencies:**

- Requires Python

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Archive via Library by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1560.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detect Archiving via Library (T1560.002)

## Risk Assessment

| Finding                                  | Severity | Impact     |
| ---------------------------------------- | -------- | ---------- |
| Archive via Library technique applicable | Low      | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [libzip](https://libzip.org/)
- [Zlib Github](https://github.com/madler/zlib)
- [PyPI RAR](https://pypi.org/project/rarfile/)
- [Wikipedia File Header Signatures](https://en.wikipedia.org/wiki/List_of_file_signatures)
- [Atomic Red Team - T1560.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1560.002)
- [MITRE ATT&CK - T1560.002](https://attack.mitre.org/techniques/T1560/002)
