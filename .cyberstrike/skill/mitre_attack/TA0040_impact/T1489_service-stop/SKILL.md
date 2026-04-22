---
name: "T1489_service-stop"
description: "Adversaries may stop or disable services on a system to render those services unavailable to legitimate users."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1489
  - impact
  - esxi
  - iaas
  - linux
  - macos
  - windows
technique_id: "T1489"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - ESXi
  - IaaS
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1489"
tech_stack:
  - esxi
  - cloud
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-400
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1489 Service Stop

## High-Level Description

Adversaries may stop or disable services on a system to render those services unavailable to legitimate users. Stopping critical services or processes can inhibit or stop response to an incident or aid in the adversary's overall objectives to cause damage to the environment. 

Adversaries may accomplish this by disabling individual services of high importance to an organization, such as <code>MSExchangeIS</code>, which will make Exchange content inaccessible. In some cases, adversaries may stop or disable many or all services to render systems unusable. Services or processes may not allow for modification of their data stores while running. Adversaries may stop services or processes in order to conduct Data Destruction or Data Encrypted for Impact on the data stores of services like Exchange and SQL Server, or on virtual machines hosted on ESXi infrastructure.

Threat actors may also disable or stop service in cloud environments. For example, by leveraging the `DisableAPIServiceAccess` API in AWS, a threat actor may prevent the service from creating service-linked roles on new accounts in the AWS Organization.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** ESXi, IaaS, Linux, macOS, Windows

## What to Check

- [ ] Identify if Service Stop technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Service Stop
- [ ] Check IaaS systems for indicators of Service Stop
- [ ] Check Linux systems for indicators of Service Stop
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Windows - Stop service using Service Controller

Stops a specified service using the sc.exe command. Upon execution, if the spooler service was running infomration will be displayed saying
it has changed to a state of STOP_PENDING. If the spooler service was not running "The service has not been started." will be displayed and it can be
started by running the cleanup command.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
sc.exe stop #{service_name}
```

### Atomic Test 2: Windows - Stop service using net.exe

Stops a specified service using the net.exe command. Upon execution, if the service was running "The Print Spooler service was stopped successfully."
will be displayed. If the service was not running, "The Print Spooler service is not started." will be displayed and it can be
started by running the cleanup command.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
net.exe stop #{service_name}
```

### Atomic Test 3: Windows - Stop service by killing process

Stops a specified service killng the service's process.
This technique was used by WannaCry. Upon execution, if the spoolsv service was running "SUCCESS: The process "spoolsv.exe" with PID 2316 has been terminated."
will be displayed. If the service was not running "ERROR: The process "spoolsv.exe" not found." will be displayed and it can be
started by running the cleanup command.

**Supported Platforms:** windows

```cmd
taskkill.exe /f /im #{process_name}
```

### Atomic Test 4: Linux - Stop service using systemctl

Stops a specified service using the systemctl command.
Upon execution, if the specified service was running, it will change to a state of inactive and it can be restarted by running the cleanup command.
You can list all available services with following command: "systemctl list-units --type=service"

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo systemctl stop #{service_name}
```

### Atomic Test 5: Linux - Stop service by killing process using killall

Stops a specified service by sending a SIGTERM signal to the linked process using the killall command.
Upon execution, if the service's main process was running, it will be terminated.
If the service was not running, no process will be found to kill and it can be restarted by running the cleanup command.
You can list all available services with following command: "systemctl list-units --type=service"

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo killall -SIGTERM #{process_name}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Service Stop by examining the target platforms (ESXi, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1489 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1030 Network Segmentation
Operate intrusion detection, analysis, and response systems on a separate network from the production environment to lessen the chances that an adversary can see and interfere with critical response functions.

### M1018 User Account Management
Limit privileges of user accounts and groups so that only authorized administrators can interact with service changes and service configurations.

### M1060 Out-of-Band Communications Channel
Develop and enforce security policies that include the use of out-of-band communication channels for critical communications during a security incident.

### M1024 Restrict Registry Permissions
Ensure proper registry permissions are in place to inhibit adversaries from disabling or interfering with critical services.

### M1022 Restrict File and Directory Permissions
Ensure proper process and file permissions are in place to inhibit adversaries from disabling or interfering with critical services.


## Detection

### Behavioral Detection for Service Stop across Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Service Stop technique applicable | Low | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [AWS DisableAWSServiceAccess](https://docs.aws.amazon.com/organizations/latest/APIReference/API_DisableAWSServiceAccess.html)
- [SecureWorks WannaCry Analysis](https://www.secureworks.com/research/wcry-ransomware-analysis)
- [Datadog Security Labs Cloud Persistence 2025](https://securitylabs.datadoghq.com/articles/tales-from-the-cloud-trenches-the-attacker-doth-persist-too-much/)
- [Talos Olympic Destroyer 2018](https://blog.talosintelligence.com/2018/02/olympic-destroyer.html)
- [Crowdstrike Hypervisor Jackpotting Pt 2 2021](https://www.crowdstrike.com/en-us/blog/hypervisor-jackpotting-ecrime-actors-increase-targeting-of-esxi-servers/)
- [Novetta Blockbuster](https://web.archive.org/web/20160226161828/https://www.operationblockbuster.com/wp-content/uploads/2016/02/Operation-Blockbuster-Report.pdf)
- [Atomic Red Team - T1489](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1489)
- [MITRE ATT&CK - T1489](https://attack.mitre.org/techniques/T1489)
