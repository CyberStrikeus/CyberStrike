---
name: cis-gcp-foundations-4.5
description: "Ensure 'Enable Connecting to Serial Ports' Is Not Enabled for VM Instance"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, compute, virtual-machines, ssh]
cis_id: "4.5"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.5 Ensure 'Enable Connecting to Serial Ports' Is Not Enabled for VM Instance (Automated)

## Profile Applicability

- Level 1

## Description

Interacting with a serial port is often referred to as the serial console, which is similar to using a terminal window, in that input and output is entirely in text mode and there is no graphical interface or mouse support.

If you enable the interactive serial console on an instance, clients can attempt to connect to that instance from any IP address. Therefore interactive serial console support should be disabled.

## Rationale

A virtual machine instance has four virtual serial ports. Interacting with a serial port is similar to using a terminal window, in that input and output is entirely in text mode and there is no graphical interface or mouse support. The instance's operating system, BIOS, and other system-level entities often write output to the serial ports, and can accept input such as commands or answers to prompts. Typically, these system-level entities use the first serial port (port 1) and serial port 1 is often referred to as the serial console.

The interactive serial console does not support IP-based access restrictions such as IP whitelists. If you enable the interactive serial console on an instance, clients can attempt to connect to that instance from any IP address. This allows anybody to connect to that instance if they know the correct SSH key, username, project ID, zone, and instance name.

Therefore interactive serial console support should be disabled.

## Audit

### From Google Cloud Console

1. Login to Google Cloud console
2. Go to Compute Engine
3. Go to VM instances
4. Click on the Specific VM
5. Ensure the statement `Connecting to serial serial ports is disabled` is displayed at the top of the details tab, just below the `Connect to serial console` drop-down.

### From Google Cloud CLI

Ensure the below command's output shows `null`:

```
gcloud compute instances describe <vmName> --zone=<region> --format="json(metadata.items[].key,metadata.items[].value)"
```

or `key` and `value` properties from below command's json response are equal to `serial-port-enable` and `0` or `false` respectively.

```json
{
  "metadata": {
    "items": [
      {
        "key": "serial-port-enable",
        "value": "0"
      }
    ]
  }
}
```

## Remediation

### From Google Cloud Console

1. Login to Google Cloud console
2. Go to Computer Engine
3. Go to VM instances
4. Click on the Specific VM
5. Click `EDIT`
6. Unselect `Enable connecting to serial ports` below `Remote access` block.
7. Click `Save`

### From Google Cloud CLI

Use the below command to disable:

```
gcloud compute instances add-metadata <INSTANCE_NAME> --zone=<ZONE> --metadata=serial-port-enable=false
```

or

```
gcloud compute instances add-metadata <INSTANCE_NAME> --zone=<ZONE> --metadata=serial-port-enable=0
```

## Prevention

You can prevent VMs from having serial port access enable by `Disable VM serial port access` organization policy:

https://console.cloud.google.com/iam-admin/orgpolicies/compute-disableSerialPortAccess.

## Default Value

By default, connecting to serial ports is not enabled.

## References

1. https://cloud.google.com/compute/docs/instances/interacting-with-serial-console

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | X | X |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | X | X |
