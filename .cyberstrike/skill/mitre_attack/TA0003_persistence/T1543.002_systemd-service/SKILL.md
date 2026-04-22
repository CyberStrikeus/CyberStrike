---
name: "T1543.002_systemd-service"
description: "Adversaries may create or modify systemd services to repeatedly execute malicious payloads as part of persistence."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1543.002
  - persistence
  - privilege-escalation
  - linux
  - sub-technique
technique_id: "T1543.002"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1543/002"
tech_stack:
  - linux
cwe_ids:
  - CWE-276
chains_with:
  - T1543
  - T1543.001
  - T1543.003
  - T1543.004
  - T1543.005
prerequisites:
  - T1543
severity_boost:
  T1543: "Chain with T1543 for deeper attack path"
  T1543.001: "Chain with T1543.001 for deeper attack path"
  T1543.003: "Chain with T1543.003 for deeper attack path"
---

# T1543.002 Systemd Service

> **Sub-technique of:** T1543

## High-Level Description

Adversaries may create or modify systemd services to repeatedly execute malicious payloads as part of persistence. Systemd is a system and service manager commonly used for managing background daemon processes (also known as services) and other system resources. Systemd is the default initialization (init) system on many Linux distributions replacing legacy init systems, including SysVinit and Upstart, while remaining backwards compatible. 

Systemd utilizes unit configuration files with the `.service` file extension to encode information about a service's process. By default, system level unit files are stored in the `/systemd/system` directory of the root owned directories (`/`). User level unit files are stored in the `/systemd/user` directories of the user owned directories (`$HOME`). 

Inside the `.service` unit files, the following directives are used to execute commands: 

* `ExecStart`, `ExecStartPre`, and `ExecStartPost` directives execute when a service is started manually by `systemctl` or on system start if the service is set to automatically start.
* `ExecReload` directive executes when a service restarts. 
* `ExecStop`, `ExecStopPre`, and `ExecStopPost` directives execute when a service is stopped. 

Adversaries have created new service files, altered the commands a `.service` file’s directive executes, and modified the user directive a `.service` file executes as, which could result in privilege escalation. Adversaries may also place symbolic links in these directories, enabling systemd to find these payloads regardless of where they reside on the filesystem. 

The `.service` file’s User directive can be used to run service as a specific user, which could result in privilege escalation based on specific user/group permissions. 

Systemd services can be created via systemd generators, which support the dynamic generation of unit files. Systemd generators are small executables that run during boot or configuration reloads to dynamically create or modify systemd unit files by converting non-native configurations into services, symlinks, or drop-ins (i.e., Boot or Logon Initialization Scripts).

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Linux

## What to Check

- [ ] Identify if Systemd Service technique is applicable to target environment
- [ ] Check Linux systems for indicators of Systemd Service
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Create Systemd Service

This test creates a Systemd service unit file and enables it as a service.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
echo "[Unit]" > #{systemd_service_path}/#{systemd_service_file}
echo "Description=Atomic Red Team Systemd Service" >> #{systemd_service_path}/#{systemd_service_file}
echo "" >> #{systemd_service_path}/#{systemd_service_file}
echo "[Service]" >> #{systemd_service_path}/#{systemd_service_file}
echo "Type=simple"
echo "ExecStart=#{execstart_action}" >> #{systemd_service_path}/#{systemd_service_file}
echo "ExecStartPre=#{execstartpre_action}" >> #{systemd_service_path}/#{systemd_service_file}
echo "ExecStartPost=#{execstartpost_action}" >> #{systemd_service_path}/#{systemd_service_file}
echo "ExecReload=#{execreload_action}" >> #{systemd_service_path}/#{systemd_service_file}
echo "ExecStop=#{execstop_action}" >> #{systemd_service_path}/#{systemd_service_file}
echo "ExecStopPost=#{execstoppost_action}" >> #{systemd_service_path}/#{systemd_service_file}
echo "" >> #{systemd_service_path}/#{systemd_service_file}
echo "[Install]" >> #{systemd_service_path}/#{systemd_service_file}
echo "WantedBy=default.target" >> #{systemd_service_path}/#{systemd_service_file}
systemctl daemon-reload
systemctl enable #{systemd_service_file}
systemctl start #{systemd_service_file}
```

### Atomic Test 2: Create SysV Service

This test creates a SysV service unit file and enables it as a service.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
echo '#\!/bin/sh' > #{rc_service_path}/#{rc_service_file}
echo ' ' >> #{rc_service_path}/#{rc_service_file}
echo '#' >> #{rc_service_path}/#{rc_service_file}
echo '# PROVIDE: art-test' >> #{rc_service_path}/#{rc_service_file}
echo '# REQUIRE: LOGIN' >> #{rc_service_path}/#{rc_service_file}
echo '# KEYWORD: shutdown' >> #{rc_service_path}/#{rc_service_file}
echo ' ' >> #{rc_service_path}/#{rc_service_file}
echo '. /etc/rc.subr' >> #{rc_service_path}/#{rc_service_file}
echo ' ' >> #{rc_service_path}/#{rc_service_file}
echo 'name="art_test"' >> #{rc_service_path}/#{rc_service_file}
echo 'rcvar=art_test_enable' >> #{rc_service_path}/#{rc_service_file}
echo 'load_rc_config ${name}' >> #{rc_service_path}/#{rc_service_file}
echo 'command="/usr/bin/touch"' >> #{rc_service_path}/#{rc_service_file}
echo 'start_cmd="art_test_start"' >> #{rc_service_path}/#{rc_service_file}
echo '' >> #{rc_service_path}/#{rc_service_file}
echo 'art_test_start()' >> #{rc_service_path}/#{rc_service_file}     
echo '{' >> #{rc_service_path}/#{rc_service_file}
echo '  ${command} /tmp/art-test.marker' >> #{rc_service_path}/#{rc_service_file}
echo '}' >> #{rc_service_path}/#{rc_service_file}
echo ' ' >> #{rc_service_path}/#{rc_service_file}     
echo 'run_rc_command "$1"' >> #{rc_service_path}/#{rc_service_file}
chmod +x #{rc_service_path}/#{rc_service_file}
service art-test enable
service art-test start
```

### Atomic Test 3: Create Systemd Service file,  Enable the service , Modify and Reload the service.

This test creates a systemd service unit file and enables it to autostart on boot. Once service is created and enabled, it also modifies this same service file showcasing both Creation and Modification of system process.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
echo "#!/bin/bash" > /etc/init.d/T1543.002
echo "### BEGIN INIT INFO" >> /etc/init.d/T1543.002
echo "# Provides : Atomic Test T1543.002" >> /etc/init.d/T1543.002
echo "# Required-Start: \$all" >> /etc/init.d/T1543.002
echo "# Required-Stop : " >> /etc/init.d/T1543.002
echo "# Default-Start: 2 3 4 5" >> /etc/init.d/T1543.002
echo "# Default-Stop: " >> /etc/init.d/T1543.002
echo "# Short Description: Atomic Test for Systemd Service Creation" >> /etc/init.d/T1543.002
echo "### END INIT INFO" >> /etc/init.d/T1543.002
echo "python3 -c \"import os, base64;exec(base64.b64decode('aW1wb3J0IG9zCm9zLnBvcGVuKCdlY2hvIGF0b21pYyB0ZXN0IGZvciBDcmVhdGluZyBTeXN0ZW1kIFNlcnZpY2UgVDE1NDMuMDAyID4gL3RtcC9UMTU0My4wMDIuc3lzdGVtZC5zZXJ2aWNlLmNyZWF0aW9uJykK')) \" " >> /etc/init.d/T1543.002
chmod +x /etc/init.d/T1543.002
if [ $(cat /etc/os-release | grep -i ID=ubuntu) ] || [ $(cat /etc/os-release | grep -i ID=kali) ]; then update-rc.d T1543.002 defaults; elif [ $(cat /etc/os-release | grep -i 'ID="centos"') ]; then chkconfig T1543.002 on ; else echo "Please run this test on Ubnutu , kali OR centos" ; fi
systemctl enable T1543.002
systemctl start T1543.002
echo "python3 -c \"import os, base64;exec(base64.b64decode('aW1wb3J0IG9zCm9zLnBvcGVuKCdlY2hvIGF0b21pYyB0ZXN0IGZvciBtb2RpZnlpbmcgYSBTeXN0ZW1kIFNlcnZpY2UgVDE1NDMuMDAyID4gL3RtcC9UMTU0My4wMDIuc3lzdGVtZC5zZXJ2aWNlLm1vZGlmaWNhdGlvbicpCg=='))\"" | sudo tee -a /etc/init.d/T1543.002
systemctl daemon-reload
systemctl restart T1543.002
```

**Dependencies:**
- System must be Ubuntu ,Kali OR CentOS.


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Systemd Service by examining the target platforms (Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1543.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1018 User Account Management
Limit user access to system utilities such as `systemctl` to only users who have a legitimate need.

### M1022 Restrict File and Directory Permissions
Restrict read/write access to systemd unit files to only select privileged users who have a legitimate need to manage system services.

### M1026 Privileged Account Management
The creation and modification of systemd service unit files is generally reserved for administrators such as the Linux root user and other users with superuser privileges.

### M1033 Limit Software Installation
Restrict software installation to trusted repositories only and be cautious of orphaned software packages.


## Detection

### Detection of Systemd Service Creation or Modification on Linux


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Systemd Service technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [airwalk backdoor unix systems](http://www.ouah.org/backdoors.html)
- [Anomali Rocke March 2019](https://www.anomali.com/blog/rocke-evolves-its-arsenal-with-a-new-malware-family-written-in-golang)
- [freedesktop systemd.service](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [Linux man-pages: systemd January 2014](http://man7.org/linux/man-pages/man1/systemd.1.html)
- [Pepe Berba Systemd 2022](https://pberba.github.io/security/2022/02/07/linux-threat-hunting-for-persistence-systemd-generators/)
- [Berba hunting linux systemd](https://pberba.github.io/security/2022/01/30/linux-threat-hunting-for-persistence-systemd-timers-cron/)
- [Rapid7 Service Persistence 22JUNE2016](https://www.rapid7.com/db/modules/exploit/linux/local/service_persistence)
- [Elastic Security Labs Linux Persistence 2024](https://www.elastic.co/security-labs/primer-on-persistence-mechanisms)
- [lambert systemd 2022](https://redcanary.com/blog/attck-t1501-understanding-systemd-service-persistence/)
- [Atomic Red Team - T1543.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1543.002)
- [MITRE ATT&CK - T1543.002](https://attack.mitre.org/techniques/T1543/002)
