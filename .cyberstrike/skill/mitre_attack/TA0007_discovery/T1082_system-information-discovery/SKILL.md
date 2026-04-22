---
name: "T1082_system-information-discovery"
description: "An adversary may attempt to get detailed information about the operating system and hardware, including version, patches, hotfixes, service packs, and architecture."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1082
  - discovery
  - esxi
  - iaas
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1082"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - ESXi
  - IaaS
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1082"
tech_stack:
  - esxi
  - cloud
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1082 System Information Discovery

## High-Level Description

An adversary may attempt to get detailed information about the operating system and hardware, including version, patches, hotfixes, service packs, and architecture. Adversaries may use this information to shape follow-on behaviors, including whether or not the adversary fully infects the target and/or attempts specific actions. This behavior is distinct from Local Storage Discovery which is an adversary's discovery of local drive, disks and/or volumes.

Tools such as Systeminfo can be used to gather detailed system information. If running with privileged access, a breakdown of system data can be gathered through the <code>systemsetup</code> configuration tool on macOS. Adversaries may leverage a Network Device CLI on network devices to gather detailed system information (e.g. <code>show version</code>). On ESXi servers, threat actors may gather system information from various esxcli utilities, such as `system hostname get` and `system version get`.

Infrastructure as a Service (IaaS) cloud providers such as AWS, GCP, and Azure allow access to instance and virtual machine information via APIs. Successful authenticated API calls can return data such as the operating system platform and status of a particular instance or the model view of a virtual machine.

System Information Discovery combined with information gathered from other forms of discovery and reconnaissance can drive payload development and concealment.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** ESXi, IaaS, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if System Information Discovery technique is applicable to target environment
- [ ] Check ESXi systems for indicators of System Information Discovery
- [ ] Check IaaS systems for indicators of System Information Discovery
- [ ] Check Linux systems for indicators of System Information Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: System Information Discovery

Identify System Info. Upon execution, system info and time info will be displayed.

**Supported Platforms:** windows

```cmd
systeminfo
reg query HKLM\SYSTEM\CurrentControlSet\Services\Disk\Enum
```

### Atomic Test 2: System Information Discovery

Identify System Info

**Supported Platforms:** macos

```bash
system_profiler
ls -al /Applications
```

### Atomic Test 3: List OS Information

Identify System Info

**Supported Platforms:** linux, macos

```bash
uname -a >> #{output_file}
if [ -f /etc/lsb-release ]; then cat /etc/lsb-release >> #{output_file}; fi
if [ -f /etc/redhat-release ]; then cat /etc/redhat-release >> #{output_file}; fi   
if [ -f /etc/issue ]; then cat /etc/issue >> #{output_file}; fi
if [ -f /etc/os-release ]; then cat /etc/os-release >> #{output_file}; fi
uptime >> #{output_file}
cat #{output_file} 2>/dev/null
```

### Atomic Test 4: Linux VM Check via Hardware

Identify virtual machine hardware. This technique is used by the Pupy RAT and other malware.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
if [ -f /sys/class/dmi/id/bios_version ]; then cat /sys/class/dmi/id/bios_version | grep -i amazon; fi
if [ -f /sys/class/dmi/id/product_name ]; then cat /sys/class/dmi/id/product_name | grep -i "Droplet\|HVM\|VirtualBox\|VMware"; fi
if [ -f /sys/class/dmi/id/chassis_vendor ]; then cat /sys/class/dmi/id/chassis_vendor | grep -i "Xen\|Bochs\|QEMU"; fi
if [ -x "$(command -v dmidecode)" ]; then sudo dmidecode | grep -i "microsoft\|vmware\|virtualbox\|quemu\|domu"; fi
if [ -f /proc/scsi/scsi ]; then cat /proc/scsi/scsi | grep -i "vmware\|vbox"; fi
if [ -f /proc/ide/hd0/model ]; then cat /proc/ide/hd0/model | grep -i "vmware\|vbox\|qemu\|virtual"; fi
if [ -x "$(command -v lspci)" ]; then sudo lspci | grep -i "vmware\|virtualbox"; fi
if [ -x "$(command -v lscpu)" ]; then sudo lscpu | grep -i "Xen\|KVM\|Microsoft"; fi
```

### Atomic Test 5: Linux VM Check via Kernel Modules

Identify virtual machine guest kernel modules. This technique is used by the Pupy RAT and other malware.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo lsmod | grep -i "vboxsf\|vboxguest"
sudo lsmod | grep -i "vmw_baloon\|vmxnet"
sudo lsmod | grep -i "xen-vbd\|xen-vnif"
sudo lsmod | grep -i "virtio_pci\|virtio_net"
sudo lsmod | grep -i "hv_vmbus\|hv_blkvsc\|hv_netvsc\|hv_utils\|hv_storvsc"
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to System Information Discovery by examining the target platforms (ESXi, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1082 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### System Discovery via Native and Remote Utilities


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| System Information Discovery technique applicable | High | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Amazon Describe Instance](https://docs.aws.amazon.com/cli/latest/reference/ssm/describe-instance-information.html)
- [Google Instances Resource](https://cloud.google.com/compute/docs/reference/rest/v1/instances)
- [Varonis](https://www.varonis.com/blog/vmware-esxi-in-the-line-of-ransomware-fire)
- [Crowdstrike Hypervisor Jackpotting Pt 2 2021](https://www.crowdstrike.com/en-us/blog/hypervisor-jackpotting-ecrime-actors-increase-targeting-of-esxi-servers/)
- [Microsoft Virutal Machine API](https://docs.microsoft.com/en-us/rest/api/compute/virtualmachines/get)
- [20 macOS Common Tools and Techniques](https://labs.sentinelone.com/20-common-tools-techniques-used-by-macos-threat-actors-malware/)
- [OSX.FairyTale](https://www.sentinelone.com/blog/trail-osx-fairytale-adware-playing-malware/)
- [US-CERT-TA18-106A](https://www.us-cert.gov/ncas/alerts/TA18-106A)
- [Atomic Red Team - T1082](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1082)
- [MITRE ATT&CK - T1082](https://attack.mitre.org/techniques/T1082)
