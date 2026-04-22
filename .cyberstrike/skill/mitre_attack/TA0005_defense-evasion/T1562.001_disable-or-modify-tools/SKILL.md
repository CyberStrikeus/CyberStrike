---
name: "T1562.001_disable-or-modify-tools"
description: "Adversaries may modify and/or disable security tools to avoid possible detection of their malware/tools and activities."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1562.001
  - defense-evasion
  - containers
  - iaas
  - linux
  - macos
  - network-devices
  - windows
  - sub-technique
technique_id: "T1562.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Containers
  - IaaS
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1562/001"
tech_stack:
  - containers
  - cloud
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1562
  - T1562.002
  - T1562.003
  - T1562.004
  - T1562.006
  - T1562.007
  - T1562.008
  - T1562.009
  - T1562.010
  - T1562.011
  - T1562.012
  - T1562.013
prerequisites:
  - T1562
severity_boost:
  T1562: "Chain with T1562 for deeper attack path"
  T1562.002: "Chain with T1562.002 for deeper attack path"
  T1562.003: "Chain with T1562.003 for deeper attack path"
---

# T1562.001 Disable or Modify Tools

> **Sub-technique of:** T1562

## High-Level Description

Adversaries may modify and/or disable security tools to avoid possible detection of their malware/tools and activities. This may take many forms, such as killing security software processes or services, modifying / deleting Registry keys or configuration files so that tools do not operate properly, or other methods to interfere with security tools scanning or reporting information. Adversaries may also disable updates to prevent the latest security patches from reaching tools on victim systems.

Adversaries may trigger a denial-of-service attack via legitimate system processes. It has been previously observed that the Windows Time Travel Debugging (TTD) monitor driver can be used to initiate a debugging session for a security tool (e.g., an EDR) and render the tool non-functional. By hooking the debugger into the EDR process, all child processes from the EDR will be automatically suspended. The attacker can terminate any EDR helper processes (unprotected by Windows Protected Process Light) by abusing the Process Explorer driver. In combination this will halt any attempt to restart services and cause the tool to crash.

Adversaries may also tamper with artifacts deployed and utilized by security tools. Security tools may make dynamic changes to system components in order to maintain visibility into specific events. For example, security products may load their own modules and/or modify those loaded by processes to facilitate data collection. Similar to Indicator Blocking, adversaries may unhook or otherwise modify these features added by tools (especially those that exist in userland or are otherwise potentially accessible to adversaries) to avoid detection. For example, adversaries may abuse the Windows process mitigation policy to block certain endpoint detection and response (EDR) products from loading their user-mode code via DLLs. By spawning a process with the PROCESS_CREATION_MITIGATION_POLICY_BLOCK_NON_MICROSOFT_BINARIES_ALWAYS_ON attribute using API calls like UpdateProcThreadAttribute, adversaries may evade detection by endpoint security solutions that rely on DLLs that are not signed by Microsoft. Alternatively, they may add new directories to an EDR tool’s exclusion list, enabling them to hide malicious files via File/Path Exclusions.

Adversaries may also focus on specific applications such as Sysmon. For example, the “Start” and “Enable” values in <code>HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\WMI\Autologger\EventLog-Microsoft-Windows-Sysmon-Operational</code> may be modified to tamper with and potentially disable Sysmon logging.

On network devices, adversaries may attempt to skip digital signature verification checks by altering startup configuration files and effectively disabling firmware verification that typically occurs at boot.

In cloud environments, tools disabled by adversaries may include cloud monitoring agents that report back to services such as AWS CloudWatch or Google Cloud Monitor.

Furthermore, although defensive tools may have anti-tampering mechanisms, adversaries may abuse tools such as legitimate rootkit removal kits to impair and/or disable these tools. For example, adversaries have used tools such as GMER to find and shut down hidden processes and antivirus software on infected systems.

Additionally, adversaries may exploit legitimate drivers from anti-virus software to gain access to kernel space (i.e. Exploitation for Privilege Escalation), which may lead to bypassing anti-tampering features.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Containers, IaaS, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Disable or Modify Tools technique is applicable to target environment
- [ ] Check Containers systems for indicators of Disable or Modify Tools
- [ ] Check IaaS systems for indicators of Disable or Modify Tools
- [ ] Check Linux systems for indicators of Disable or Modify Tools
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Disable syslog

Disables syslog collection

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
#{flavor_command}
```

**Dependencies:**

- Package with rsyslog must be on system

### Atomic Test 2: Disable syslog (freebsd)

Disables syslog collection

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
service syslogd stop
sysrc syslogd_enable="NO"
```

### Atomic Test 3: Disable Cb Response

Disable the Cb Response service

**Supported Platforms:** linux

```bash
if [ $(rpm -q --queryformat '%{VERSION}' centos-release) -eq "6" ];
then
  service cbdaemon stop
  chkconfig off cbdaemon
else if [ $(rpm -q --queryformat '%{VERSION}' centos-release) -eq "7" ];
  systemctl stop cbdaemon
  systemctl disable cbdaemon
fi
```

### Atomic Test 4: Disable SELinux

Disables SELinux enforcement

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
setenforce 0
```

**Dependencies:**

- SELinux must be installed

### Atomic Test 5: Stop Crowdstrike Falcon on Linux

Stop and disable Crowdstrike Falcon on Linux

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo systemctl stop falcon-sensor.service
sudo systemctl disable falcon-sensor.service
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Disable or Modify Tools by examining the target platforms (Containers, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1562.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention

Use application control where appropriate, especially regarding the execution of tools outside of the organization's security policies (such as rootkit removal tools) that have been abused to impair system defenses. Ensure that only approved security applications are used and running on enterprise systems.

### M1024 Restrict Registry Permissions

Ensure proper Registry permissions are in place to prevent adversaries from disabling or interfering with security services.

### M1018 User Account Management

Ensure proper user permissions are in place to prevent adversaries from disabling or interfering with security services.

### M1022 Restrict File and Directory Permissions

Ensure proper process and file permissions are in place to prevent adversaries from disabling or interfering with security services.

### M1047 Audit

Periodically verify that tools are functioning appropriately – for example, that all expected hosts with EDRs or monitoring agents are checking in to the central console. Check EDRs to ensure that no unexpected exclusion paths have been added. In Microsoft Defender for Endpoint, exclusions can be reviewed with the `Get-MpPreference` cmdlet.

## Detection

### Detection of Impair Defenses through Disabled or Modified Tools across OS Platforms.

## Risk Assessment

| Finding                                      | Severity | Impact          |
| -------------------------------------------- | -------- | --------------- |
| Disable or Modify Tools technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Analysis of FG-IR-22-369](https://www.fortinet.com/blog/psirt-blogs/fg-ir-22-369-psirt-analysis)
- [Fortinet Zero-Day and Custom Malware Used by Suspected Chinese Actor in Espionage Operation](https://www.mandiant.com/resources/blog/fortinet-malware-ecosystem)
- [BlackBerry WhisperGate 2022](https://blogs.blackberry.com/en/2022/02/threat-spotlight-whispergate-wiper-wreaks-havoc-in-ukraine)
- [Cocomazzi FIN7 Reboot](https://www.sentinelone.com/labs/fin7-reboot-cybercrime-gang-enhances-ops-with-new-edr-bypasses-and-automated-attacks/)
- [OutFlank System Calls](https://outflank.nl/blog/2019/06/19/red-team-tactics-combining-direct-system-calls-and-srdi-to-bypass-av-edr/)
- [disable_win_evt_logging](https://ptylu.github.io/content/report/report.html?report=25)
- [chasing_avaddon_ransomware](https://www.mandiant.com/resources/chasing-avaddon-ransomware)
- [doppelpaymer_crowdstrike](https://www.crowdstrike.com/blog/how-doppelpaymer-hunts-and-kills-windows-processes/)
- [avoslocker_ransomware](https://thehackernews.com/2022/05/avoslocker-ransomware-variant-using-new.html)
- [dharma_ransomware](https://www.crowdstrike.com/blog/targeted-dharma-ransomware-intrusions-exhibit-consistent-techniques/)
- [MDSec System Calls](https://www.mdsec.co.uk/2020/12/bypassing-user-mode-hooks-and-direct-invocation-of-system-calls-for-red-teams/)
- [SCADAfence_ransomware](https://cdn.logic-control.com/docs/scadafence/Anatomy-Of-A-Targeted-Ransomware-Attack-WP.pdf)
- [demystifying_ryuk](https://techcommunity.microsoft.com/t5/core-infrastructure-and-security/demystifying-ransomware-attacks-against-microsoft-defender/ba-p/1928947)
- [Google Cloud Threat Intelligence FIN13 2021](https://cloud.google.com/blog/topics/threat-intelligence/fin13-cybercriminal-mexico/)
- [Atomic Red Team - T1562.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1562.001)
- [MITRE ATT&CK - T1562.001](https://attack.mitre.org/techniques/T1562/001)
