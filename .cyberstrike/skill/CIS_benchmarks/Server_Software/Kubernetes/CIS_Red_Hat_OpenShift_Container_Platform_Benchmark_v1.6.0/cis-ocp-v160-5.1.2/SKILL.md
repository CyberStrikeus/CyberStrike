---
name: cis-ocp-v160-5.1.2
description: "Minimize access to secrets (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, rbac, service-accounts]
cis_id: "5.1.2"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 5.1.2

## Profile Applicability
- **Level:** 1

## Description
The Kubernetes API stores secrets, which may be service account tokens for the Kubernetes API or credentials used by workloads in the cluster. Access to these secrets should be restricted to the smallest possible group of users to reduce the risk of privilege escalation.

## Rationale
Inappropriate access to secrets stored within the Kubernetes cluster can allow for an attacker to gain additional access to the Kubernetes cluster or external resources whose credentials are stored as secrets.

## Impact
Care should be taken not to remove access to secrets to system components which require this for their operation.

## Audit Procedure
Review the users who have `get`, `list` or `watch` access to `secrets` objects in the Kubernetes API.

Executing the command below will return a list of users and groups who are allowed to get secrets:

```bash
oc adm policy who-can get secrets
```

The following command returns the users and groups who are allowed to list secrets:

```bash
oc adm policy who-can list secrets
```

The following command returns the users and groups who are allowed to watch secrets:

```bash
oc adm policy who-can watch secrets
```

## Remediation
Where possible, remove `get`, `list` and `watch` access to `secret` objects in the cluster.

## Default Value
By default in a OpenShift cluster the following list of principals have get privileges on secret objects:

```
for i in $(oc get clusterroles -o jsonpath='{.items[*].metadata.name}'); do
oc describe clusterrole ${i}; done

# The following default cluster roles have get privileges on secret objects

admin
cloud-credential-operator-role
cluster-admin
cluster-image-registry-operator
cluster-monitoring-operator
cluster-node-tuning-operator
edit
kube-state-metrics
machine-config-controller
marketplace-operator
openshift-ingress-operator
prometheus-operator
registry-admin
registry-editor
system:aggregate-to-edit
system:controller:expand-controller
system:controller:generic-garbage-collector
system:controller:namespace-controller
system:controller:operator-lifecycle-manager
system:controller:persistent-volume-binder
system:kube-controller-manager
system:master
system:node
system:openshift:controller:build-controller
system:openshift:controller:cluster-quota-reconciliation-controller
system:openshift:controller:ingress-to-route-controller
system:openshift:controller:service-ca
system:openshift:controller:service-serving-cert-controller
system:openshift:controller:serviceaccount-pull-secrets-controller
system:openshift:controller:template-service-broker
```

## References
1. https://kubernetes.io/docs/concepts/configuration/secret/#using-secrets

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.12 Segment Data Processing and Storage Based on Sensitivity | | * | * |
| v7 | 13.4 Only Allow Access to Authorized Cloud Storage or Email Providers | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1552 | TA0006 | M1026 |

## Profile
**Level 1** (Manual)
