---
name: "T1218.004_installutil"
description: "Adversaries may use InstallUtil to proxy execution of code through a trusted Windows utility."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1218.004
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1218.004"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1218/004"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1218
  - T1218.001
  - T1218.002
  - T1218.003
  - T1218.005
  - T1218.007
  - T1218.008
  - T1218.009
  - T1218.010
  - T1218.011
  - T1218.012
  - T1218.013
  - T1218.014
  - T1218.015
prerequisites:
  - T1218
severity_boost:
  T1218: "Chain with T1218 for deeper attack path"
  T1218.001: "Chain with T1218.001 for deeper attack path"
  T1218.002: "Chain with T1218.002 for deeper attack path"
---

# T1218.004 InstallUtil

> **Sub-technique of:** T1218

## High-Level Description

Adversaries may use InstallUtil to proxy execution of code through a trusted Windows utility. InstallUtil is a command-line utility that allows for installation and uninstallation of resources by executing specific installer components specified in .NET binaries. The InstallUtil binary may also be digitally signed by Microsoft and located in the .NET directories on a Windows system: <code>C:\Windows\Microsoft.NET\Framework\v<version>\InstallUtil.exe</code> and <code>C:\Windows\Microsoft.NET\Framework64\v<version>\InstallUtil.exe</code>.

InstallUtil may also be used to bypass application control through use of attributes within the binary that execute the class decorated with the attribute <code>[System.ComponentModel.RunInstaller(true)]</code>.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if InstallUtil technique is applicable to target environment
- [ ] Check Windows systems for indicators of InstallUtil
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: CheckIfInstallable method call

Executes the CheckIfInstallable class constructor runner instead of executing InstallUtil. Upon execution, the InstallUtil test harness will be executed.
If no output is displayed the test executed successfuly.

**Supported Platforms:** windows

```powershell
# Import the required test harness function, Invoke-BuildAndInvokeInstallUtilAssembly
. "#{test_harness}"

$InstallerAssemblyDir = "#{assembly_dir}"
$InstallerAssemblyFileName = "#{assembly_filename}"
$InstallerAssemblyFullPath = Join-Path -Path $InstallerAssemblyDir -ChildPath $InstallerAssemblyFileName

$ExpectedOutput = 'Constructor_'

$TestArgs = @{
    OutputAssemblyDirectory = $InstallerAssemblyDir
    OutputAssemblyFileName = $InstallerAssemblyFileName
    InvocationMethod = '#{invocation_method}'
}

$ActualOutput = Invoke-BuildAndInvokeInstallUtilAssembly @TestArgs -MinimumViableAssembly

if ($ActualOutput -ne $ExpectedOutput) {
    throw @"
CheckIfInstallable method execution test failure. Installer assembly execution output did not match the expected output.
Expected: $ExpectedOutput
Actual: $ActualOutput
"@
}
```

**Dependencies:**
- InstallUtil test harness script must be installed at specified location (#{test_harness})

### Atomic Test 2: InstallHelper method call

Executes the InstallHelper class constructor runner instead of executing InstallUtil. Upon execution, no output will be displayed if the test
executed successfuly.

**Supported Platforms:** windows

```powershell
# Import the required test harness function, Invoke-BuildAndInvokeInstallUtilAssembly
. "#{test_harness}"

$InstallerAssemblyDir = "#{assembly_dir}"
$InstallerAssemblyFileName = "#{assembly_filename}"
$InstallerAssemblyFullPath = Join-Path -Path $InstallerAssemblyDir -ChildPath $InstallerAssemblyFileName

$CommandLine = "/logfile= /logtoconsole=false `"$InstallerAssemblyFullPath`""
$ExpectedOutput = 'Constructor_'

$TestArgs = @{
    OutputAssemblyDirectory = $InstallerAssemblyDir
    OutputAssemblyFileName = $InstallerAssemblyFileName
    InvocationMethod = '#{invocation_method}'
    CommandLine = $CommandLine
}

$ActualOutput = Invoke-BuildAndInvokeInstallUtilAssembly @TestArgs -MinimumViableAssembly

if ($ActualOutput -ne $ExpectedOutput) {
    throw @"
InstallHelper method execution test failure. Installer assembly execution output did not match the expected output.
Expected: $ExpectedOutput
Actual: $ActualOutput
"@
}
```

**Dependencies:**
- InstallUtil test harness script must be installed at specified location (#{test_harness})

### Atomic Test 3: InstallUtil class constructor method call

Executes the installer assembly class constructor. Upon execution, version information will be displayed the .NET framework install utility.

**Supported Platforms:** windows

```powershell
# Import the required test harness function, Invoke-BuildAndInvokeInstallUtilAssembly
. "#{test_harness}"

$InstallerAssemblyDir = "#{assembly_dir}"
$InstallerAssemblyFileName = "#{assembly_filename}"
$InstallerAssemblyFullPath = Join-Path -Path $InstallerAssemblyDir -ChildPath $InstallerAssemblyFileName

$CommandLine = "/logfile= /logtoconsole=false `"$InstallerAssemblyFullPath`""
$ExpectedOutput = 'Constructor_'

$TestArgs = @{
    OutputAssemblyDirectory = $InstallerAssemblyDir
    OutputAssemblyFileName = $InstallerAssemblyFileName
    InvocationMethod = '#{invocation_method}'
    CommandLine = $CommandLine
}

$ActualOutput = Invoke-BuildAndInvokeInstallUtilAssembly @TestArgs -MinimumViableAssembly

if ($ActualOutput -ne $ExpectedOutput) {
    throw @"
InstallUtil class constructor execution test failure. Installer assembly execution output did not match the expected output.
Expected: $ExpectedOutput
Actual: $ActualOutput
"@
}
```

**Dependencies:**
- InstallUtil test harness script must be installed at specified location (#{test_harness})

### Atomic Test 4: InstallUtil Install method call

Executes the Install Method. Upon execution, version information will be displayed the .NET framework install utility.

**Supported Platforms:** windows

```powershell
# Import the required test harness function, Invoke-BuildAndInvokeInstallUtilAssembly
. "#{test_harness}"

$InstallerAssemblyDir = "#{assembly_dir}"
$InstallerAssemblyFileName = "#{assembly_filename}"
$InstallerAssemblyFullPath = Join-Path -Path $InstallerAssemblyDir -ChildPath $InstallerAssemblyFileName

$CommandLine = "/logfile= /logtoconsole=false /installtype=notransaction /action=install `"$InstallerAssemblyFullPath`""
$ExpectedOutput = 'Constructor_Install_'

$TestArgs = @{
    OutputAssemblyDirectory = $InstallerAssemblyDir
    OutputAssemblyFileName = $InstallerAssemblyFileName
    InvocationMethod = '#{invocation_method}'
    CommandLine = $CommandLine
}

$ActualOutput = Invoke-BuildAndInvokeInstallUtilAssembly @TestArgs

if ($ActualOutput -ne $ExpectedOutput) {
    throw @"
InstallUtil Install method execution test failure. Installer assembly execution output did not match the expected output.
Expected: $ExpectedOutput
Actual: $ActualOutput
"@
}
```

**Dependencies:**
- InstallUtil test harness script must be installed at specified location (#{test_harness})

### Atomic Test 5: InstallUtil Uninstall method call - /U variant

Executes the Uninstall Method. Upon execution, version information will be displayed the .NET framework install utility.

**Supported Platforms:** windows

```powershell
# Import the required test harness function, Invoke-BuildAndInvokeInstallUtilAssembly
. "#{test_harness}"

$InstallerAssemblyDir = "#{assembly_dir}"
$InstallerAssemblyFileName = "#{assembly_filename}"
$InstallerAssemblyFullPath = Join-Path -Path $InstallerAssemblyDir -ChildPath $InstallerAssemblyFileName

$CommandLine = "/logfile= /logtoconsole=false /U `"$InstallerAssemblyFullPath`""
$ExpectedOutput = 'Constructor_Uninstall_'

$TestArgs = @{
    OutputAssemblyDirectory = $InstallerAssemblyDir
    OutputAssemblyFileName = $InstallerAssemblyFileName
    InvocationMethod = '#{invocation_method}'
    CommandLine = $CommandLine
}

$ActualOutput = Invoke-BuildAndInvokeInstallUtilAssembly @TestArgs

if ($ActualOutput -ne $ExpectedOutput) {
    throw @"
InstallUtil Uninstall method execution test failure. Installer assembly execution output did not match the expected output.
Expected: $ExpectedOutput
Actual: $ActualOutput
"@
}
```

**Dependencies:**
- InstallUtil test harness script must be installed at specified location (#{test_harness})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to InstallUtil by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1218.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention
Use application control configured to block execution of InstallUtil.exe if it is not required for a given system or network to prevent potential misuse by adversaries.

### M1042 Disable or Remove Feature or Program
InstallUtil may not be necessary within a given environment.


## Detection

### Detection of Malicious Code Execution via InstallUtil.exe


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| InstallUtil technique applicable | Medium | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [MSDN InstallUtil](https://msdn.microsoft.com/en-us/library/50614e95.aspx)
- [LOLBAS Installutil](https://lolbas-project.github.io/lolbas/Binaries/Installutil/)
- [Atomic Red Team - T1218.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1218.004)
- [MITRE ATT&CK - T1218.004](https://attack.mitre.org/techniques/T1218/004)
