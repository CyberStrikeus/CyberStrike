---
name: cis-ocp-v160-1.1.9
description: "Ensure that the Container Network Interface file permissions are set to 600 or more restrictive (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, master-node-config-files, cni, networking, file-permissions]
cis_id: "1.1.9"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 1.1.9

## Profile Applicability

- **Level:** 1

## Description

Ensure that the Container Network Interface files have permissions of `600` or more restrictive.

## Rationale

Container Network Interface provides various networking options for overlay networking. You should consult their documentation and restrict their respective file permissions to maintain the integrity of those files. Those files should be writable by only the administrators on the system.

## Impact

None

## Audit Procedure

The Cluster Network Operator (CNO) deploys and manages the cluster network components on an OpenShift Container Platform cluster. This includes the Container Network Interface (CNI) default network provider plug-in selected for the cluster during installation. OpenShift Container Platform uses the Multus CNI plug-in to allow chaining of CNI plug-ins. The default Pod network must be configured during cluster installation. By default, the CNO deploys the OpenShift SDN as the default Pod network.
Ensure that the Container Network Interface file permissions, multus, openshift-sdn and Open vSwitch (OVS) file permissions are set to 644 or more restrictive. The SDN components are deployed as DaemonSets across the master/worker nodes with controllers limited to control plane nodes. OpenShift deploys OVS as a network overlay by default. Various configurations (ConfigMaps and other files managed by the operator via hostpath but stored on the container hosts) are stored in the following locations:
CNI/Multus (pod muluts):
`/host/etc/cni/net.d` = CNI_CONF_DIR
`/host/var/run/multus/cni/net.d` = multus config dir
SDN (pod ovs; daemonset; app=ovs):
`/var/lib/cni/networks/openshift-sdn`
`/var/run/openshift-sdn`
OVS (container openvswitch):
`/var/run/openvswitch`
`/etc/openvswitch`
`/run/openvswitch`

Run the following commands to verify the permissions when using CNI multus:

```bash
for i in $(oc get pods -n openshift-multus -l app=multus -oname); do  oc exec -n openshift-multus $i --  /bin/bash -c "stat -c \"%a %n\" /host/etc/cni/net.d/*.conf"; done

for i in $(oc get pods -n openshift-multus -l app=multus -oname); do  oc exec -n openshift-multus $i --  /bin/bash -c "stat -c \"%a %n\" /host/var/run/multus/cni/net.d/*.conf"; done
```

Run the following commands to verify the permissions when using OpenShift SDN:

```bash
for i in $(oc get pods -n openshift-sdn -l app=sdn -oname);  do   oc exec -n openshift-sdn $i --   find /var/lib/cni/networks/openshift-sdn -type f -exec stat -c %a {} \;;  done

for i in $(oc get pods -n openshift-sdn -l app=sdn -oname);  do   oc exec -n openshift-sdn $i -- find /var/run/openshift-sdn -type f -exec stat -c %a {} \;;  done
```

Run the following commands to verify the permissions when using OVS:

```bash
for i in $(oc get pods -n openshift-sdn -l app=ovs -oname);  do   oc exec -n openshift-sdn $i --   find /var/run/openvswitch -type f -exec stat -c %a {} \;;  done

for i in $(oc get pods -n openshift-sdn -l app=ovs -oname);  do   oc exec -n openshift-sdn $i --   find /etc/openvswitch -type f -exec stat -c %a {} \;; done

for i in $(oc get pods -n openshift-sdn -l app=ovs -oname);  do   oc exec -n openshift-sdn $i --   find /run/openvswitch -type f -exec stat -c %a {} \;; done
```

Verify the returned file permissions are `600` or more restrictive.

## Remediation

No remediation required; file permissions are managed by the operator.

## Default Value

In OpenShift 4, the default values are:

`/host/etc/cni/net.d/00-multus.conf` = 600
`/host/var/run/multus/cni/net.d/80-openshift-network.conf` = 644
`/var/lib/cni/networks/openshift-sdn/*` = 644
`/var/run/openshift-sdn/cniserver/config.json` = 444
`/var/run/openvswitch/ovs-vswitchd.pid` = 644
`/etc/openvswitch/conf.db` = 644
`/etc/openvswitch/system-id.conf` = 644
`/etc/openvswitch/.conf.db.~lock~` = 600
`/run/openvswitch/ovs-vswitchd.pid` = 644
`/run/openvswitch/ovsdb-server.pid` = 644

## References

1. https://docs.openshift.com/container-platform/4.3/networking/cluster-network-operator.html
2. https://kubernetes.io/docs/concepts/cluster-administration/networking/

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | \*   | \*   | \*   |
| v7               | 14.6 Protect Information through Access Control Lists | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1083, T1222                | TA0005, TA0007 | M1022       |

## Profile

**Level 1** (Manual)
