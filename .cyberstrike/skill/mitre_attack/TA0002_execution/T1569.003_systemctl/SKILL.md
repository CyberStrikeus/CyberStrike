---
name: "T1569.003_systemctl"
description: "Adversaries may abuse systemctl to execute commands or programs."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1569.003
  - execution
  - linux
  - sub-technique
technique_id: "T1569.003"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1569/003"
tech_stack:
  - linux
cwe_ids:
  - CWE-94
chains_with:
  - T1569
  - T1569.001
  - T1569.002
prerequisites:
  - T1569
severity_boost:
  T1569: "Chain with T1569 for deeper attack path"
  T1569.001: "Chain with T1569.001 for deeper attack path"
  T1569.002: "Chain with T1569.002 for deeper attack path"
---

# T1569.003 Systemctl

> **Sub-technique of:** T1569

## High-Level Description

Adversaries may abuse systemctl to execute commands or programs. Systemctl is the primary interface for systemd, the Linux init system and service manager. Typically invoked from a shell, Systemctl can also be integrated into scripts or applications. 

Adversaries may use systemctl to execute commands or programs as Systemd Services. Common subcommands include: `systemctl start`, `systemctl stop`, `systemctl enable`, `systemctl disable`, and `systemctl status`.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Linux

## What to Check

- [ ] Identify if Systemctl technique is applicable to target environment
- [ ] Check Linux systems for indicators of Systemctl
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Create and Enable a Malicious systemd Service Unit

Creates a new systemd service unit file in /etc/systemd/system/ and enables it using
systemctl enable followed by systemctl start. Adversaries commonly abuse this workflow
to establish persistence or execute arbitrary commands under the context of systemd.

This simulates the full attacker workflow: writing the unit file, reloading the systemd
daemon, enabling the service to survive reboots, and starting it immediately. This is
consistent with techniques observed in ransomware precursor activity and post-exploitation
frameworks targeting Linux infrastructure.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
echo "[Unit]" > /etc/systemd/system/#{service_name}.service
echo "Description=Atomic Test Service" >> /etc/systemd/system/#{service_name}.service
echo "After=network.target" >> /etc/systemd/system/#{service_name}.service
echo "" >> /etc/systemd/system/#{service_name}.service
echo "[Service]" >> /etc/systemd/system/#{service_name}.service
echo "ExecStart=#{command_to_run}" >> /etc/systemd/system/#{service_name}.service
echo "Restart=on-failure" >> /etc/systemd/system/#{service_name}.service
echo "" >> /etc/systemd/system/#{service_name}.service
echo "[Install]" >> /etc/systemd/system/#{service_name}.service
echo "WantedBy=multi-user.target" >> /etc/systemd/system/#{service_name}.service
systemctl daemon-reload
systemctl enable #{service_name}.service
systemctl start #{service_name}.service
systemctl status #{service_name}.service
```

**Dependencies:**
- systemctl must be available on the system
- The test must be run as root or with sudo privileges
- /etc/systemd/system/ directory must exist and be writable

### Atomic Test 2: Create systemd Service Unit from /tmp (Unusual Location)

Creates a systemd service unit file in /tmp and loads it using systemctl start with
an absolute path. Adversaries may write service unit files to world-writable directories
such as /tmp to avoid triggering alerts on new file creation in standard service
directories, or to execute payloads transiently without permanently installing a service.

Loading a service unit from an arbitrary path rather than a standard systemd directory
is unusual behaviour that should be detectable by monitoring systemctl command arguments.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
echo "[Unit]" > #{service_path}
echo "Description=Atomic Tmp Service" >> #{service_path}
echo "" >> #{service_path}
echo "[Service]" >> #{service_path}
echo "ExecStart=#{command_to_run}" >> #{service_path}
echo "" >> #{service_path}
echo "[Install]" >> #{service_path}
echo "WantedBy=multi-user.target" >> #{service_path}
systemctl link #{service_path}
systemctl start $(basename #{service_path})
systemctl status $(basename #{service_path})
```

**Dependencies:**
- systemctl must be available on the system
- /tmp must exist and be writable
- The test must be run as root or with sudo privileges

### Atomic Test 3: Create systemd Service Unit from /dev/shm (Unusual Location)

Creates a systemd service unit file in /dev/shm and loads it using systemctl.
/dev/shm is a memory-backed filesystem that is world-writable on most Linux systems
and does not persist across reboots, making it particularly attractive to adversaries
seeking to execute transient payloads while evading file-based forensic detection.

This technique has been observed in post-exploitation scenarios where attackers
deliberately avoid writing to disk-backed locations to limit forensic artefacts.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
echo "[Unit]" > #{service_path}
echo "Description=Atomic SHM Service" >> #{service_path}
echo "" >> #{service_path}
echo "[Service]" >> #{service_path}
echo "ExecStart=#{command_to_run}" >> #{service_path}
echo "" >> #{service_path}
echo "[Install]" >> #{service_path}
echo "WantedBy=multi-user.target" >> #{service_path}
systemctl link #{service_path}
systemctl start $(basename #{service_path})
systemctl status $(basename #{service_path})
```

**Dependencies:**
- systemctl must be available on the system
- /dev/shm must exist and be writable
- The test must be run as root or with sudo privileges

### Atomic Test 4: Modify Existing systemd Service to Execute Malicious Command

Creates a service unit file that initially runs a benign command, then modifies the
ExecStart directive using sed to substitute a malicious command before reloading and
restarting the service. Adversaries may hijack existing services to blend in with normal
service activity and avoid triggering detections focused solely on new service creation.

This technique reflects the tradecraft observed in more sophisticated intrusions where
blending into existing process trees is a priority over creating net-new services.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
echo "[Unit]" > /etc/systemd/system/#{service_name}.service
echo "Description=Legitimate Looking Service" >> /etc/systemd/system/#{service_name}.service
echo "" >> /etc/systemd/system/#{service_name}.service
echo "[Service]" >> /etc/systemd/system/#{service_name}.service
echo "ExecStart=/bin/true" >> /etc/systemd/system/#{service_name}.service
echo "" >> /etc/systemd/system/#{service_name}.service
echo "[Install]" >> /etc/systemd/system/#{service_name}.service
echo "WantedBy=multi-user.target" >> /etc/systemd/system/#{service_name}.service
systemctl daemon-reload
sed -i 's|ExecStart=.*|ExecStart=#{malicious_command}|' /etc/systemd/system/#{service_name}.service
systemctl daemon-reload
systemctl start #{service_name}.service
systemctl status #{service_name}.service
```

**Dependencies:**
- systemctl must be available on the system
- sed must be available on the system
- The test must be run as root or with sudo privileges
- /etc/systemd/system/ directory must exist and be writable

### Atomic Test 5: Execute Command via Transient systemd Service (systemd-run)

Uses systemd-run to execute a command as a transient systemd service without creating
a persistent unit file on disk. Adversaries may use systemd-run to execute arbitrary
commands under the context of systemd while bypassing controls that monitor for new
unit file creation, since transient services exist only in memory for their lifetime.

This is a particularly stealthy technique as it leaves minimal on-disk artefacts and
the service disappears from systemctl list-units once execution completes.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
systemd-run --unit=#{unit_name} --wait #{command_to_run}
systemctl status #{unit_name}.service 2>/dev/null || echo "Transient service has already completed and exited."
```

**Dependencies:**
- systemd-run must be available on the system
- The test must be run as root or with sudo privileges


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Systemctl by examining the target platforms (Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1569.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1018 User Account Management
Limit user access to `systemctl` to only users who have a legitimate need.


## Detection

### Detection Strategy for System Services: Systemctl


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Systemctl technique applicable | Low | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [Red Hat Systemctl 2022](https://www.redhat.com/en/blog/linux-systemctl-manage-services)
- [Atomic Red Team - T1569.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1569.003)
- [MITRE ATT&CK - T1569.003](https://attack.mitre.org/techniques/T1569/003)
