---
name: cis-ocp-v170-2.2
description: "Ensure --client-cert-auth set to true (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, etcd]
cis_id: "2.2"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 2.2

## Profile Applicability
- **Level:** 1

## Description
Enable client authentication on etcd service.

## Rationale
etcd is a highly-available key value store used by Kubernetes deployments for persistent storage of all of its REST API objects. These objects are sensitive in nature and should not be available to unauthenticated clients. You should enable the client authentication via valid certificates to secure the access to the etcd service.

## Impact
All clients attempting to access the etcd server will require a valid client certificate.

## Audit Procedure

OpenShift uses X.509 certificates to provide secure communication to etcd. OpenShift installation generates these files and sets the arguments appropriately. The following certificates are generated and used by etcd and other processes that communicate with etcd:

- Client certificates: Client certificates are currently used by the API server only, and no other service should connect to etcd directly except for the proxy. Client secrets (`etcd-client`, `etcd-metric-client`, `etcd-metric-signer`, and `etcd-signer`) are added to the `openshift-config`, `openshift-monitoring`, and `openshift-kube-apiserver` namespaces.
- Server certificates: Used by the etcd server for authenticating client requests.

Run the following command on the etcd server node:

```bash
for i in $(oc get pods -oname -n openshift-etcd)
do
    oc exec -n openshift-etcd -c etcd $i -- \
      ps -o command= -C etcd | sed 's/.*\(--client-cert-auth=[^ ]*\).*/\1/'
done
```

Verify that the `--client-cert-auth` argument is set to `true` for each etcd member.

## Remediation
This setting is managed by the cluster etcd operator. No remediation required.

## Default Value
By default, `client-cert-auth` is set to `true`.

## References
1. https://docs.openshift.com/container-platform/latest/security/certificate_types_descriptions/etcd-certificates.html
2. https://github.com/openshift/cluster-etcd-operator
3. https://github.com/openshift/cluster-etcd-operator/blob/release-4.5/bindata/etcd/pod.yaml#L154-L167
4. https://github.com/openshift/cluster-etcd-operator/blob/master/bindata/etcd/pod.yaml#L154-L167
5. https://etcd.io/
6. https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/
7. https://etcd.io/#client-cert-auth

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | * | * |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1552 | TA0006 | M1022 |

## Profile
**Level 1** (Manual)
