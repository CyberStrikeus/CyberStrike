---
name: cis-oke-v180-4.5.2
description: "Apply Security Context to Your Pods and Containers (Manual)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, general-policies]
cis_id: "4.5.2"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.5.2 Apply Security Context to Your Pods and Containers (Manual)

## Profile Applicability

- Level 1

## Description

Apply Security Context to Your Pods and Containers.

## Rationale

A security context defines the operating system security settings (uid, gid, capabilities, SELinux role, etc..) applied to a container. When designing your containers and pods, make sure that you configure the security context for your pods, containers, and volumes. A security context is a property defined in the deployment yaml. It controls the security parameters that will be assigned to the pod/container/volume. There are two levels of security context: pod level security context, and container level security context.

## Impact

If you incorrectly apply security contexts, you may have trouble running the pods.

## Audit

Review the pod definitions in your cluster and verify that you have security contexts defined as appropriate.

Here is a key compliance check in OKE (Oracle Kubernetes Engine) to ensure all Pods define a securityContext at either the pod or container level:

```bash
echo -e "NAMESPACE\tPOD\tHAS_POD_SECURITY_CONTEXT\tHAS_CONTAINER_SECURITY_CONTEXT" && \
kubectl get pods -A -o json \
| jq -r '
  .items[]
  | .metadata.namespace as $ns
  | .metadata.name as $pod
  | (.spec.securityContext != null) as $hasPodSC
  | (([(.spec.containers[]?.securityContext != null)] | any) as $hasContainerSC
  | [$ns, $pod, $hasPodSC, $hasContainerSC] | @tsv
'
```

- HAS_POD_SECURITY_CONTEXT checks for a pod-level .spec.securityContext.
- HAS_CONTAINER_SECURITY_CONTEXT verifies if any container in the pod defines .securityContext.
- jq any -- returns true if at least one container has a security context.
- Works across all namespaces (-A).

## Remediation

As a best practice we recommend that you scope the binding for privileged pods to service accounts within a particular namespace, e.g. kube-system, and limiting access to that namespace. For all other serviceaccounts/namespaces, we recommend implementing a more restrictive policy such as this:

```yaml
apiVersion: policy/v1beta1
kind: PodSecurityPolicy
metadata:
    name: restricted
    annotations:
      seccomp.security.alpha.kubernetes.io/allowedProfileNames: 'docker/default,runtime/default'
      apparmor.security.beta.kubernetes.io/allowedProfileNames: 'runtime/default'
      seccomp.security.alpha.kubernetes.io/defaultProfileName: 'runtime/default'
      apparmor.security.beta.kubernetes.io/defaultProfileName: 'runtime/default'
spec:
    privileged: false
    allowPrivilegeEscalation: false
    requiredDropCapabilities:
    - ALL
    volumes:
    - 'configMap'
    - 'emptyDir'
    - 'projected'
    - 'secret'
    - 'downwardAPI'
    - 'persistentVolumeClaim'
    hostNetwork: false
    hostIPC: false
    hostPID: false
    runAsUser:
      rule: 'MustRunAsNonRoot'
    seLinux:
      rule: 'RunAsAny'
    supplementalGroups:
      rule: 'MustRunAs'
      ranges:
        - min: 1
          max: 65535
    fsGroup:
      rule: 'MustRunAs'
      ranges:
        - min: 1
          max: 65535
    readOnlyRootFilesystem: false
```

This policy prevents pods from running as privileged or escalating privileges. It also restricts the types of volumes that can be mounted and the root supplemental groups that can be added.

Another, albeit similar, approach is to start with policy that locks everything down and incrementally add exceptions for applications that need looser restrictions such as logging agents which need the ability to mount a host path.

## Default Value

By default, no security contexts are automatically applied to pods.

## References

1. https://kubernetes.io/docs/concepts/policy/security-context/
2. https://learn.cisecurity.org/benchmarks
3. https://aws.github.io/aws-eks-best-practices/pods/#restrict-the-containers-that-can-run-as-privileged
4. https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | x | x | x |
| v7 | 5.1 Establish Secure Configurations | x | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1556, T1611 | TA0004, TA0006 | M1048 |
