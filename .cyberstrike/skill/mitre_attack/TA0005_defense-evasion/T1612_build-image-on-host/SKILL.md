---
name: "T1612_build-image-on-host"
description: "Adversaries may build a container image directly on a host to bypass defenses that monitor for the retrieval of malicious images from a public registry."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1612
  - defense-evasion
  - containers
technique_id: "T1612"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Containers
mitre_url: "https://attack.mitre.org/techniques/T1612"
tech_stack:
  - containers
cwe_ids:
  - CWE-693
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1612 Build Image on Host

## High-Level Description

Adversaries may build a container image directly on a host to bypass defenses that monitor for the retrieval of malicious images from a public registry. A remote <code>build</code> request may be sent to the Docker API that includes a Dockerfile that pulls a vanilla base image, such as alpine, from a public or local registry and then builds a custom image upon it.

An adversary may take advantage of that <code>build</code> API to build a custom image on the host that includes malware downloaded from their C2 server, and then they may utilize Deploy Container using that custom image. If the base image is pulled from a public registry, defenses will likely not detect the image as malicious since it’s a vanilla image. If the base image already resides in a local registry, the pull may be considered even less suspicious since the image is already in the environment.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Containers

## What to Check

- [ ] Identify if Build Image on Host technique is applicable to target environment
- [ ] Check Containers systems for indicators of Build Image on Host
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Build Image On Host

Adversaries may build a container image directly on a host to bypass defenses that monitor for the retrieval of malicious images from a public registry. An adversary may take advantage of that build API to build a custom image on the host that includes malware downloaded from their C2 server, and then they then may utilize Deploy Container using that custom image.

**Supported Platforms:** containers

```bash
docker build -t t1612  $PathtoAtomicsFolder/T1612/src/
docker run --name t1612_container --rm -d -t t1612
docker exec t1612_container ./test.sh
```

**Dependencies:**

- Verify docker is installed.
- Verify docker service is running.

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Build Image on Host by examining the target platforms (Containers).

2. **Assess Existing Defenses**: Review whether mitigations for T1612 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1035 Limit Access to Resource Over Network

Limit communications with the container service to local Unix sockets or remote access via SSH. Require secure port access to communicate with the APIs over TLS by disabling unauthenticated access to the Docker API on port 2375. Instead, communicate with the Docker API over TLS on port 2376.

### M1026 Privileged Account Management

Ensure containers are not running as root by default. In Kubernetes environments, consider defining Pod Security Standards that prevent pods from running privileged containers.

### M1030 Network Segmentation

Deny direct remote access to internal systems through the use of network proxies, gateways, and firewalls.

### M1047 Audit

Audit images deployed within the environment to ensure they do not contain any malicious components.

## Detection

### Detection Strategy for Build Image on Host

## Risk Assessment

| Finding                                  | Severity | Impact          |
| ---------------------------------------- | -------- | --------------- |
| Build Image on Host technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Aqua Build Images on Hosts](https://blog.aquasec.com/malicious-container-image-docker-container-host)
- [Docker Build Image](https://docs.docker.com/engine/api/v1.41/#operation/ImageBuild)
- [Aqua Security Cloud Native Threat Report June 2021](https://info.aquasec.com/hubfs/Threat%20reports/AquaSecurity_Cloud_Native_Threat_Report_2021.pdf?utm_campaign=WP%20-%20Jun2021%20Nautilus%202021%20Threat%20Research%20Report&utm_medium=email&_hsmi=132931006&_hsenc=p2ANqtz-_8oopT5Uhqab8B7kE0l3iFo1koirxtyfTehxF7N-EdGYrwk30gfiwp5SiNlW3G0TNKZxUcDkYOtwQ9S6nNVNyEO-Dgrw&utm_content=132931006&utm_source=hs_automation)
- [Atomic Red Team - T1612](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1612)
- [MITRE ATT&CK - T1612](https://attack.mitre.org/techniques/T1612)
