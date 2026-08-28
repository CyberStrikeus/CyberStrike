---
name: cis-azure-compute-20.7
description: "Ensure that Endpoint Protection for all Virtual Machines is installed"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, virtual-machines, vm, disks, encryption]
cis_id: "20.7"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that Endpoint Protection for all Virtual Machines is installed

## Description

Install endpoint protection for all virtual machines.

## Rationale

Installing endpoint protection systems (like anti-malware for Azure) provides for real-time protection capability that helps identify and remove viruses, spyware, and other malicious software. These also offer configurable alerts when known-malicious or unwanted software attempts to install itself or run on Azure systems.

## Impact

Endpoint protection will incur an additional cost to you.

## Audit Procedure

### Using Azure Portal

1. Go to `Security Center`
2. Click the `Recommendations` blade
3. Ensure that there are no recommendations for `Endpoint Protection not installed on Azure VMs`

### Using Azure CLI

```bash
az vm show -g <MyResourceGroup> -n <MyVm> -d --query "resources[?type=='Microsoft.Compute/virtualMachines/extensions'].{ExtensionName:name}" -o table
```

If extensions are installed, it will list the installed extensions.

Look for extensions such as:
`EndpointSecurity || TrendMicroDSA* || Antimalware || EndpointProtection || SCWPAgent || PortalProtectExtension* || FileSecurity*`

Alternatively, you can employ your own endpoint protection tool for your OS.

## Expected Result

All virtual machines should have at least one endpoint protection extension installed, or an equivalent endpoint protection tool deployed.

## Remediation

### Using Azure Portal

Follow Microsoft Azure documentation to install endpoint protection from the security center. Alternatively, you can employ your own endpoint protection tool for your OS.

## Default Value

By default Endpoint Protection is disabled.

## References

1. https://docs.microsoft.com/en-us/azure/security-center/security-center-install-endpoint-protection
2. https://docs.microsoft.com/en-us/azure/security/azure-security-antimalware
3. https://docs.microsoft.com/en-us/cli/azure/vm/extension?view=azure-cli-latest#az_vm_extension_list
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-endpoint-security#es-1-use-endpoint-detection-and-response-edr

## Profile

Level 2 | Manual
