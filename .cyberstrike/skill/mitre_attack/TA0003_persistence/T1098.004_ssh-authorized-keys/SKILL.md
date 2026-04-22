---
name: "T1098.004_ssh-authorized-keys"
description: "Adversaries may modify the SSH <code>authorized_keys</code> file to maintain persistence on a victim host."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1098.004
  - persistence
  - privilege-escalation
  - linux
  - macos
  - iaas
  - network-devices
  - esxi
  - sub-technique
technique_id: "T1098.004"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Linux
  - macOS
  - IaaS
  - Network Devices
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1098/004"
tech_stack:
  - linux
  - macos
  - cloud
  - network devices
  - esxi
cwe_ids:
  - CWE-276
chains_with:
  - T1098
  - T1098.001
  - T1098.002
  - T1098.003
  - T1098.005
  - T1098.006
  - T1098.007
prerequisites:
  - T1098
severity_boost:
  T1098: "Chain with T1098 for deeper attack path"
  T1098.001: "Chain with T1098.001 for deeper attack path"
  T1098.002: "Chain with T1098.002 for deeper attack path"
---

# T1098.004 SSH Authorized Keys

> **Sub-technique of:** T1098

## High-Level Description

Adversaries may modify the SSH <code>authorized_keys</code> file to maintain persistence on a victim host. Linux distributions, macOS, and ESXi hypervisors commonly use key-based authentication to secure the authentication process of SSH sessions for remote management. The <code>authorized_keys</code> file in SSH specifies the SSH keys that can be used for logging into the user account for which the file is configured. This file is usually found in the user's home directory under <code>&lt;user-home&gt;/.ssh/authorized_keys</code> (or, on ESXi, `/etc/ssh/keys-<username>/authorized_keys`). Users may edit the system’s SSH config file to modify the directives `PubkeyAuthentication` and `RSAAuthentication` to the value `yes` to ensure public key and RSA authentication are enabled, as well as modify the directive `PermitRootLogin` to the value `yes` to enable root authentication via SSH. The SSH config file is usually located under <code>/etc/ssh/sshd_config</code>.

Adversaries may modify SSH <code>authorized_keys</code> files directly with scripts or shell commands to add their own adversary-supplied public keys. In cloud environments, adversaries may be able to modify the SSH authorized_keys file of a particular virtual machine via the command line interface or rest API. For example, by using the Google Cloud CLI’s “add-metadata” command an adversary may add SSH keys to a user account. Similarly, in Azure, an adversary may update the authorized_keys file of a virtual machine via a PATCH request to the API. This ensures that an adversary possessing the corresponding private key may log in as an existing user via SSH. It may also lead to privilege escalation where the virtual machine or instance has distinct permissions from the requesting user.

Where authorized_keys files are modified via cloud APIs or command line interfaces, an adversary may achieve privilege escalation on the target virtual machine if they add a key to a higher-privileged user. 

SSH keys can also be added to accounts on network devices, such as with the `ip ssh pubkey-chain` Network Device CLI command.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Linux, macOS, IaaS, Network Devices, ESXi

## What to Check

- [ ] Identify if SSH Authorized Keys technique is applicable to target environment
- [ ] Check Linux systems for indicators of SSH Authorized Keys
- [ ] Check macOS systems for indicators of SSH Authorized Keys
- [ ] Check IaaS systems for indicators of SSH Authorized Keys
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Modify SSH Authorized Keys

Modify contents of <user-home>/.ssh/authorized_keys to maintain persistence on victim host. 
If the user is able to save the same contents in the authorized_keys file, it shows user can modify the file.

**Supported Platforms:** linux, macos

```bash
if [ -f ~/.ssh/authorized_keys ]; then ssh_authorized_keys=$(cat ~/.ssh/authorized_keys); echo "$ssh_authorized_keys" > ~/.ssh/authorized_keys; fi;
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to SSH Authorized Keys by examining the target platforms (Linux, macOS, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1098.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1018 User Account Management
In cloud environments, ensure that only users who explicitly require the permissions to update instance metadata or configurations can do so.

### M1022 Restrict File and Directory Permissions
Restrict access to the <code>authorized_keys</code> file.

### M1042 Disable or Remove Feature or Program
Disable SSH if it is not necessary on a host or restrict SSH access for specific users/groups using <code>/etc/ssh/sshd_config</code>. Setting the `PermitRootLogin` directive to `no` will prevent the root user from logging in via SSH.


## Detection

### Detection Strategy for SSH Key Injection in Authorized Keys


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SSH Authorized Keys technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Venafi SSH Key Abuse](https://www.venafi.com/blog/growing-abuse-ssh-keys-commodity-malware-campaigns-now-equipped-ssh-capabilities)
- [Broadcom ESXi SSH](https://knowledge.broadcom.com/external/article/313767/allowing-ssh-access-to-vmware-vsphere-es.html)
- [Google Cloud Privilege Escalation](https://about.gitlab.com/blog/2020/02/12/plundering-gcp-escalating-privileges-in-google-cloud-platform/)
- [cisco_ip_ssh_pubkey_ch_cmd](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/security/d1/sec-d1-cr-book/sec-cr-i3.html#wp1254331478)
- [Cybereason Linux Exim Worm](https://www.cybereason.com/blog/new-pervasive-worm-exploiting-linux-exim-server-vulnerability)
- [Google Cloud Add Metadata](https://cloud.google.com/sdk/gcloud/reference/compute/instances/add-metadata)
- [Azure Update Virtual Machines](https://docs.microsoft.com/en-us/rest/api/compute/virtual-machines/update)
- [SSH Authorized Keys](https://www.ssh.com/ssh/authorized_keys/)
- [Atomic Red Team - T1098.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1098.004)
- [MITRE ATT&CK - T1098.004](https://attack.mitre.org/techniques/T1098/004)
