---
name: cis-ocp-vm-v100-1-1
description: "Restrict GPU and USB pass through to approved devices (Manual)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, platform-configuration, hardware-passthrough, gpu, usb]
cis_id: "1.1"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.1 — Restrict GPU and USB pass through to approved devices

## Profile Applicability
- Level 1

## Description
The ability to pass through devices provides the capability to offload tasks from the CPU to the device itself.

## Rationale
Restricting passthrough to approved devices reduces the risk of unauthorized or unintended data sharing/transmission introduced by allowing GPU and USB connectivity.

## Impact
Unauthorized devices will not be passed through, and therefore not be available to workloads.

## Audit Procedure
List the host devices available to virtualization workloads and verify the host devices returned are necessary for workload execution.

```bash
$ oc get hyperconverged kubevirt-hyperconverged -n openshift-cnv -ojsonpath='{.spec.permittedHostDevices}'
```

Example output structure:

```json
{
  "mediatedDevices": [
    {
      "mdevNameSelector": "DEVICE_A",
      "resourceName": "vendor.com/DEVICE_A"
    }
  ],
  "pciHostDevices": [
    {
      "externalResourceProvider": true,
      "pciDeviceSelector": "XXX:YYY",
      "resourceName": "vendor.com/DEVICE_B"
    },
    {
      "pciDeviceSelector": "NNN:MMM",
      "resourceName": "vendor.com/DEVICE_C"
    }
  ],
  "usbHostDevices": [
    {
      "resourceName": "kubevirt.io/storage",
      "selectors": [
        {
          "product": "0001",
          "vendor": "46f4"
        }
      ]
    }
  ]
}
```

## Remediation
Enforcing limitations to the passthrough of approved devices protects against the introduction of a malicious or unknown device to the system. The system administrator can remove the unwanted devices by patching the HCO object.

If the first PCI device (the DEVICE_A at index 0) should not be permitted to be passed through to a VM, here's how to remove it:

```bash
$ oc patch hyperconverged kubevirt-hyperconverged -n openshift-cnv --type='json' -p='[
    {"op": "remove", "path": "/spec/permittedHostDevices/pciHostDevices/0"},
]'
```

To remove all permitted devices, use the following:

```bash
$ oc patch hyperconverged kubevirt-hyperconverged -n openshift-cnv --type='json' -p='[
    {"op": "remove", "path": "/spec/permittedHostDevices"},
]'
```

## Default Value
By default, OpenShift Virtualization doesn't configure any pass through devices. The result of the command should be empty.

## References
- CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0, Section 1.1

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | N | Y | Y |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Initial Access | T1200 Hardware Additions |
| Lateral Movement | T1210 Exploitation of Remote Services |

## Profile
- Level 1 - OpenShift Virtualization
