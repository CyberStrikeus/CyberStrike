---
name: cis-oke-v150-4.5.2
description: "Apply Security Context to Your Pods and Containers (Manual)"
category: cis-oke
version: "1.5.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, general-policies, security-context]
cis_id: "4.5.2"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.5.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.5.0 - Control 4.5.2

## Profile Applicability

- **Level:** 1

## Description

Apply Security Context to Your Pods and Containers.

A security context defines the operating system security settings (uid, gid, capabilities, SELinux role, etc.) applied to a container. When designing your containers and pods, make sure that you configure the security context for your pods, containers, and volumes. A security context is a property defined in the deployment yaml. It controls the security parameters that will be assigned to the pod/container/volume. There are two levels of security context: pod level security context and container level security context.

## Rationale

A pod or container that runs with overly permissive security settings could compromise the host operating system, other containers in the pod, or other pods in the cluster. Using appropriately restrictive security contexts helps to enforce the principle of least privilege and reduce the attack surface.

## Impact

If you incorrectly apply security contexts, you may have trouble running the pods.

## Audit Procedure

Review the pod definitions in your cluster and verify that you have security contexts set as appropriate.

Check the security context settings for all pods and containers:

```bash
kubectl get pods --all-namespaces -o json | jq '.items[].spec.containers[].securityContext'
```

Also review pod-level security context:

```bash
kubectl get pods --all-namespaces -o json | jq '.items[].spec.securityContext'
```

Verify that pods and containers have appropriate security context settings including:

- `runAsNonRoot: true`
- `readOnlyRootFilesystem: true`
- `allowPrivilegeEscalation: false`
- Dropped capabilities

## Remediation

Follow the Kubernetes documentation and apply security contexts to your pods. For a suggested list of security contexts, you may refer to the CIS Security Benchmark for Docker Containers.

Example PodSecurityPolicy with restricted settings:

```yaml
apiVersion: policy/v1beta1
kind: PodSecurityPolicy
metadata:
  name: restricted
  annotations:
    seccomp.security.alpha.kubernetes.io/allowedProfiles: "docker/default"
    apparmor.security.beta.kubernetes.io/allowedProfiles: "runtime/default"
    seccomp.security.alpha.kubernetes.io/defaultProfileName: "docker/default"
    apparmor.security.beta.kubernetes.io/defaultProfileName: "runtime/default"
spec:
  privileged: false
  allowPrivilegeEscalation: false
  requiredDropCapabilities:
    - ALL
  volumes:
    - "configMap"
    - "emptyDir"
    - "projected"
    - "secret"
    - "downwardAPI"
    - "persistentVolumeClaim"
  hostNetwork: false
  hostIPC: false
  hostPID: false
  runAsUser:
    rule: "MustRunAsNonRoot"
  seLinux:
    rule: "RunAsAny"
  supplementalGroups:
    rule: "MustRunAs"
    ranges:
      - min: 1
        max: 65535
  fsGroup:
    rule: "MustRunAs"
    ranges:
      - min: 1
        max: 65535
  readOnlyRootFilesystem: false
```

## Default Value

By default, there are no security contexts applied to pods and containers.

## References

1. https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
2. https://www.cisecurity.org/benchmark/docker
3. https://aws.github.io/aws-eks-best-practices/security/docs/pods/
4. https://docs.oracle.com/en-us/iaas/Content/ContEng/home.htm

## Additional Information

Security contexts provide a mechanism for controlling the security parameters at the pod and container level. Properly configured security contexts help enforce least privilege and reduce the attack surface of containerized workloads.

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.1 Establish and Maintain a Secure Configuration Process | \*   | \*   | \*   |
| v7               | 5.1 Establish Secure Configurations                       | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1556, T1611                | TA0004, TA0006 | M1048       |

## Profile

**Level 1** (Manual)
