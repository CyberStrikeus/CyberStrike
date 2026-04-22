---
name: cis-ocp-v170-1.1.10
description: "Ensure that the Container Network Interface file ownership is set to root:root (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, master-node, config-files]
cis_id: "1.1.10"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 1.1.10

## Profile Applicability
- **Level:** 1

## Description
Ensure that the Container Network Interface files have ownership set to `root:root`.

## Rationale
Container Network Interface provides various networking options for overlay networking. You should consult their documentation and restrict their respective file permissions to maintain the integrity of those files. Those files should be owned by `root:root`.

## Impact
None.

## Audit Procedure
The Cluster Network Operator (CNO) deploys and manages the cluster network components on an OpenShift Container Platform cluster. This includes the Container Network Interface (CNI) default network provider plug-in selected for the cluster during installation. OpenShift Container Platform uses the Multus CNI plug-in to allow chaining of CNI plug-ins. The default Pod network must be configured during cluster installation. By default, the CNO deploys the OpenShift SDN as the default Pod network.

Ensure that the `multu` and `openshift-sdn` file ownership is set to root:root and the Open vSwitch (OVS) file ownership is set to `openvswitch:openvswitch`.
The SDN components are deployed as DaemonSets across the master/worker nodes with controllers limited to control plane nodes. OpenShift deploys OVS as a network overlay by default. Various configurations (ConfigMaps and other files managed by the operator via `hostpath` but stored on the container hosts) are stored in the following locations:

CNI:
- `/etc/cni/net.d`
- `/host/var/run/multus/cni/net.d`

SDN:
- `/var/lib/cni/networks/openshift-sdn`
- `/var/run/openshift-sdn`

SDN OVS:
- `/var/run/openvswitch`
- `/etc/openvswitch`
- `/run/openvswitch`

Run the following commands to verify ownership when using CNI multus:

```bash
for i in $(oc get pods -n openshift-multus -l app=multus -oname); do  oc exec -n openshift-multus $i --  /bin/bash -c "stat -c \"%U:%G %n\" /host/etc/cni/net.d/*.conf"; done

for i in $(oc get pods -n openshift-multus -l app=multus -oname); do  oc exec -n openshift-multus $i --  /bin/bash -c "stat -c \"%U:%G %n\" /host/var/run/multus/cni/net.d/*.conf"; done
```

Run the following commands to verify the ownership when using OpenShift SDN:

```bash
for i in $(oc get pods -n openshift-sdn -l app=sdn -oname); do  oc exec -n openshift-sdn $i --  find /var/lib/cni/networks/openshift-sdn -type f -exec stat -c \"%U:%G\" {} \;;  done

for i in $(oc get pods -n openshift-sdn -l app=sdn -oname); do  oc exec -n openshift-sdn $i -- find /var/run/openshift-sdn -type f -exec stat -c %U:%G {} \;;  done
```

Run the following commands to verify the permissions when using OVS:

```bash
for i in $(oc get pods -n openshift-sdn -l app=ovs -oname); do  oc exec -n openshift-sdn $i --  find /var/run/openvswitch -type f -exec stat -c %U:%G {} \;;  done

for i in $(oc get pods -n openshift-sdn -l app=ovs -oname); do  oc exec -n openshift-sdn $i --  find /etc/openvswitch -type f -exec stat -c %U:%G {} \;; done

for i in $(oc get pods -n openshift-sdn -l app=ovs -oname); do  oc exec -n openshift-sdn $i --  find /run/openvswitch -type f -exec stat -c %U:%G {} \;; done
```

Verify file ownership is set to `root:root`.
In deployments using OCS, verify that the file ownership is set to `openvswitch:openvswitch`.
- `/var/run/openvswitch` = openvswitch:openvswitch
- `/etc/openvswitch` = openvswitch:openvswitch
- `/run/openvswitch` = openvswitch:openvswitch

## Remediation
No remediation required; file permissions are managed by the operator.

## Default Value
In OpenShift 4, the default file ownership is root:root for CNI Multus and SDN and openvswitch:openvswitch for the OVS plugin.

- `/host/etc/cni/net.d/00-multus.conf` = root:root
- `/host/var/run/multus/cni/net.d/80-openshift-network.conf` = root:root
- `/var/lib/cni/networks/openshift-sdn` = root:root
- `/var/run/openshift-sdn` = root:root
- `/var/run/openvswitch` = openvswitch:openvswitch
- `/etc/openvswitch` = openvswitch:openvswitch
- `/run/openvswitch` = openvswitch:openvswitch

## References
1. https://docs.openshift.com/container-platform/latest/networking/cluster-network-operator.html
2. https://kubernetes.io/docs/concepts/cluster-administration/networking/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | * | * | * |
| v7 | 4.3 Ensure the Use of Dedicated Administrative Accounts | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1083, T1222 | TA0005, TA0007 | M1026 |

## Profile
**Level 1** (Manual)
