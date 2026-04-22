---
name: cis-k8s-v1120-4.2.14
description: "Ensure that the --seccomp-default parameter is set to true (Manual)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, worker-nodes, kubelet]
cis_id: "4.2.14"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Kubernetes Benchmark v1.12.0 - Control 4.2.14

## Description

Ensure that the Kubelet enforces the use of the RuntimeDefault seccomp profile.

## Rationale

By default, Kubernetes disables the seccomp profile which ships with most container runtimes. Setting this parameter will ensure workloads running on the node are protected by the runtime's seccomp profile.

## Impact

Setting this will remove some rights from pods running on the node.

## Audit Procedure

Review the Kubelet's start-up parameters for the value of `--seccomp-default`, and check the Kubelet configuration file for the `seccompDefault`. If neither of these values is set, then the seccomp profile is not in use.

## Remediation

Set the parameter, either via the `--seccomp-default` command line parameter or the `seccompDefault` configuration file setting.

## Default Value

By default the seccomp profile is not enabled.

## References

1. https://kubernetes.io/docs/tutorials/security/seccomp/#enable-the-use-of-runtimedefault-as-the-default-seccomp-profile-for-all-workloads

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 13.7 Deploy a Host-Based Intrusion Prevention Solution<br>Deploy a host-based intrusion prevention solution on enterprise assets, where appropriate and/or supported. | | | ● |
| v7 | 5.1 Establish Secure Configurations<br>Maintain documented, standard security configuration standards for all authorized operating systems and software. | ● | ● | ● |
| v7 | 5.2 Maintain Secure Images<br>Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. | | ● | ● |
| v7 | 11.4 Install the Latest Stable Version of Any Security-related Updates on All Network Devices<br>Install the latest stable version of any security-related updates on all network devices. | ● | ● | ● |

## Profile Applicability

- Level 1 - Worker Node

## Assessment Status

Manual
