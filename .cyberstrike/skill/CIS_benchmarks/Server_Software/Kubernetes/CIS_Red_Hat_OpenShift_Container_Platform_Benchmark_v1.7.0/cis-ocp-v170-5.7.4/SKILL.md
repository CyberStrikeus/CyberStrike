---
name: cis-ocp-v170-5.7.4
description: "The default namespace should not be used (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, general-policies]
cis_id: "5.7.4"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 5.7.4

## Profile Applicability

- **Level:** 2

## Description

Kubernetes provides a default namespace, where objects are placed if no namespace is specified for them. Placing objects in this namespace makes application of RBAC and other controls more difficult.

## Rationale

Resources in a Kubernetes cluster should be segregated by namespace, to allow for security controls to be applied at that level and to make it easier to manage resources.

## Impact

None

## Audit Procedure

In OpenShift, projects (namespaces) are used to group and isolate related objects. When a request is made to create a new project using the web console or `oc new-project` command, an endpoint in OpenShift Container Platform is used to provision the project according to a template, which can be customized.

The cluster administrator can allow and configure how developers and service accounts can create, or self-provision, their own projects. Regular users do not have access to the `default` project.

Projects starting with `openshift-` and `kube-` host cluster components that run as Pods and other infrastructure components. As such, OpenShift does not allow you to create Projects starting with `openshift-` or `kube-` using the `oc new-project` command.

Run the following command to list all resources in the `default` namespace, besides the `kubernetes` and `openshift` services, which are expected to be in the `default` namespace:

```bash
oc get all -n default -o json | jq '.items[] | select((.kind|test("Service"))
and (.metadata.name|test("openshift|kubernetes"))? | not) | (.kind + "/" +
.metadata.name)'
```

Carefully review the list of returned resources and consider moving them to another namespace.

## Remediation

Ensure that namespaces are created to allow for appropriate segregation of Kubernetes resources and that all new resources are created in a specific namespace.

## Default Value

Unless a namespace is specific on object creation, the `default` namespace will be used.

## References

1. https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/

## CIS Controls

| Controls Version | Control                                                                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.9 Configure Trusted DNS Servers on Enterprise Assets                                                |      | \*   | \*   |
| v7               | 5 Secure Configuration for Hardware and Software on Mobile Devices, Laptops, Workstations and Servers |      |      |      |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1578                       | TA0005  | M1018       |

## Profile

**Level 2** (Manual)
