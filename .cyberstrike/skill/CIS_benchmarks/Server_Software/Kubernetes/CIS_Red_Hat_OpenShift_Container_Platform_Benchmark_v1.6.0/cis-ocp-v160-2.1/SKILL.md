---
name: cis-ocp-v160-2.1
description: "Ensure that the --cert-file and --key-file arguments are set as appropriate (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, etcd, tls, certificate, encryption]
cis_id: "2.1"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 2.1

## Profile Applicability

- **Level:** 1

## Description

Configure TLS encryption for the `etcd` service.

## Rationale

`etcd` is a highly-available key value store used by Kubernetes deployments for persistent storage of all of its REST API objects. These objects are sensitive in nature and should be encrypted in transit.

## Impact

Client connections only over TLS would be served.

## Audit Procedure

OpenShift uses X.509 certificates to provide secure communication to `etcd`. OpenShift generates these files and sets the arguments appropriately. OpenShift does not use the `etcd-certfile` or `etcd-keyfile` flags.

Keys and certificates for control plane components like `kube-apiserver`, `kube-controller-manager`, `kube-scheduler` and `etcd` are stored with their respective static pod configurations in the directory `/etc/kubernetes/static-pod-resources/*/secrets`.

Run the following command to check the value of the `--cert-file` parameter on all applicable nodes:

```bash
for i in $(oc get pods -oname -n openshift-etcd)
do
    oc exec -n openshift-etcd -c etcd $i -- \
      ps -o command= -C etcd | sed 's/.*\(--cert-file=[^ ]*\).*/\1/'
done
```

Run the following command to check the value of the `--key-file` parameter on all applicable nodes:

```bash
for i in $(oc get pods -oname -n openshift-etcd)
do
    oc exec -n openshift-etcd -c etcd $i -- \
      ps -o command= -C etcd | sed 's/.*\(--key-file=[^ ]*\).*/\1/'
done
```

Verify that cert-file and key-file values are returned for each etcd member.

```
--cert-file=/etc/kubernetes/static-pod-certs/secrets/etcd-all-serving/etcd-serving-${ETCD_DNS_NAME}.crt
--key-file=/etc/kubernetes/static-pod-certs/secrets/etcd-all-serving/etcd-serving-${ETCD_DNS_NAME}.key
```

For example:

```
--cert-file=/etc/kubernetes/static-pod-certs/secrets/etcd-all-serving/etcd-serving-ip-10-0-165-75.us-east-2.compute.internal.crt
--key-file=/etc/kubernetes/static-pod-certs/secrets/etcd-all-serving/etcd-serving-ip-10-0-165-75.us-east-2.compute.internal.key
```

## Remediation

OpenShift does not use the `etcd-certfile` or `etcd-keyfile` flags. Certificates for etcd are managed by the `etcd` cluster operator.

## Default Value

By default, `etcd` communication is secured with X.509 certificates.

## References

1. https://docs.openshift.com/container-platform/latest/security/certificate_types_descriptions/etcd-certificates.html
2. https://github.com/openshift/cluster-etcd-operator
3. https://github.com/openshift/cluster-etcd-operator/blob/master/bindata/etcd/pod.yaml#L154-L167
4. https://etcd.io/
5. https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest               |      | X    | X    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | X    | X    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1552                       | TA0006  | M1022       |

## Profile

**Level 1** (Manual)
