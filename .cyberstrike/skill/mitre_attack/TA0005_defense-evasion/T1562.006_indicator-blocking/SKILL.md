---
name: "T1562.006_indicator-blocking"
description: "An adversary may attempt to block indicators or events typically captured by sensors from being gathered and analyzed."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1562.006
  - defense-evasion
  - windows
  - macos
  - linux
  - esxi
  - sub-technique
technique_id: "T1562.006"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
  - macOS
  - Linux
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1562/006"
tech_stack:
  - windows
  - macos
  - linux
  - esxi
cwe_ids:
  - CWE-693
chains_with:
  - T1562
  - T1562.001
  - T1562.002
  - T1562.003
  - T1562.004
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
  T1562.001: "Chain with T1562.001 for deeper attack path"
  T1562.002: "Chain with T1562.002 for deeper attack path"
---

# T1562.006 Indicator Blocking

> **Sub-technique of:** T1562

## High-Level Description

An adversary may attempt to block indicators or events typically captured by sensors from being gathered and analyzed. This could include maliciously redirecting or even disabling host-based sensors, such as Event Tracing for Windows (ETW), by tampering settings that control the collection and flow of event telemetry. These settings may be stored on the system in configuration files and/or in the Registry as well as being accessible via administrative utilities such as PowerShell or Windows Management Instrumentation.

For example, adversaries may modify the `File` value in <code>HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\EventLog\Security</code> to hide their malicious actions in a new or different .evtx log file. This action does not require a system reboot and takes effect immediately. 

ETW interruption can be achieved multiple ways, however most directly by defining conditions using the PowerShell <code>Set-EtwTraceProvider</code> cmdlet or by interfacing directly with the Registry to make alterations.

In the case of network-based reporting of indicators, an adversary may block traffic associated with reporting to prevent central analysis. This may be accomplished by many means, such as stopping a local process responsible for forwarding telemetry and/or creating a host-based firewall rule to block traffic to specific hosts responsible for aggregating events, such as security information and event management (SIEM) products.

In Linux environments, adversaries may disable or reconfigure log processing tools such as syslog or nxlog to inhibit detection and monitoring capabilities to facilitate follow on behaviors. ESXi also leverages syslog, which can be reconfigured via commands such as `esxcli system syslog config set` and `esxcli system syslog config reload`.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows, macOS, Linux, ESXi

## What to Check

- [ ] Identify if Indicator Blocking technique is applicable to target environment
- [ ] Check Windows systems for indicators of Indicator Blocking
- [ ] Check macOS systems for indicators of Indicator Blocking
- [ ] Check Linux systems for indicators of Indicator Blocking
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Auditing Configuration Changes on Linux Host

Emulates modification of auditd configuration files

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sed -i '$ a #art_test_1562_006_1' /etc/audisp/#{audisp_config_file_name}
if [ -f "/etc/#{auditd_config_file_name}" ];
then sed -i '$ a #art_test_1562_006_1' /etc/#{auditd_config_file_name}
else sed -i '$ a #art_test_1562_006_1' /etc/audit/#{auditd_config_file_name}
fi 
sed -i '$ a #art_test_1562_006_1' /etc/#{libaudit_config_file_name}
```

### Atomic Test 2: Auditing Configuration Changes on FreeBSD Host

Emulates modification of auditd configuration files

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
echo '#art_test_1562_006_1' >> /etc/security/#{auditd_config_file_name}
```

### Atomic Test 3: Logging Configuration Changes on Linux Host

Emulates modification of syslog configuration.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
if [ -f "/etc/#{syslog_config_file_name}" ];
then sed -i '$ a #art_test_1562_006_2' /etc/#{syslog_config_file_name}
fi
if [ -f "/etc/#{rsyslog_config_file_name}" ];
then sed -i '$ a #art_test_1562_006_2' /etc/#{rsyslog_config_file_name}
fi
if [ -f "/etc/syslog-ng/#{syslog_ng_config_file_name}" ];
then sed -i '$ a #art_test_1562_006_2' /etc/syslog-ng/#{syslog_ng_config_file_name}
fi
```

### Atomic Test 4: Logging Configuration Changes on FreeBSD Host

Emulates modification of syslog configuration.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
if [ -f "/etc/#{syslog_config_file_name}" ];
then echo '#art_test_1562_006_2' >> /etc/#{syslog_config_file_name}
fi
```

### Atomic Test 5: Disable Powershell ETW Provider - Windows

This test was created to disable the Microsoft Powershell ETW provider by using the built-in Windows tool, logman.exe. This provider is used as a common source of telemetry in AV/EDR solutions.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
cmd /c "#{ps_exec_location}" -accepteula -i -s cmd.exe /c logman update trace "#{session}" --p "#{provider}" -ets
```

**Dependencies:**
- PSExec must be installed on the machine.


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Indicator Blocking by examining the target platforms (Windows, macOS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1562.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1022 Restrict File and Directory Permissions
Ensure event tracers/forwarders , firewall policies, and other associated mechanisms are secured with appropriate permissions and access controls.

### M1054 Software Configuration
Consider automatically relaunching forwarding mechanisms at recurring intervals (ex: temporal, on-logon, etc.) as well as applying appropriate change management to firewall rules and other related system configurations.

### M1018 User Account Management
Ensure event tracers/forwarders , firewall policies, and other associated mechanisms are secured with appropriate permissions and access controls and cannot be manipulated by user accounts.


## Detection

### Detection Strategy for Impair Defenses Indicator Blocking


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Indicator Blocking technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Google Cloud Threat Intelligence ESXi VIBs 2022](https://cloud.google.com/blog/topics/threat-intelligence/esxi-hypervisors-malware-persistence)
- [Broadcom Configuring syslog on ESXi](https://knowledge.broadcom.com/external/article/318939/configuring-syslog-on-esxi.html)
- [disable_win_evt_logging](https://ptylu.github.io/content/report/report.html?report=25)
- [LemonDuck](https://www.crowdstrike.com/blog/lemonduck-botnet-targets-docker-for-cryptomining-operations/)
- [Microsoft Lamin Sept 2017](https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?name=Backdoor:Win32/Lamin.A)
- [Microsoft About Event Tracing 2018](https://docs.microsoft.com/en-us/windows/desktop/etw/consuming-events)
- [Medium Event Tracing Tampering 2018](https://medium.com/palantir/tampering-with-windows-event-tracing-background-offense-and-defense-4be7ac62ac63)
- [Atomic Red Team - T1562.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1562.006)
- [MITRE ATT&CK - T1562.006](https://attack.mitre.org/techniques/T1562/006)
