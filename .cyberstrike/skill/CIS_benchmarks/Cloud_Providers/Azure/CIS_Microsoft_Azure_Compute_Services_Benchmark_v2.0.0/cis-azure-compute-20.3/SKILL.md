---
name: cis-azure-compute-20.3
description: "Ensure that 'Unattached disks' are encrypted with 'Customer Managed Key' (CMK)"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, virtual-machines, vm, disks, encryption]
cis_id: "20.3"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that 'Unattached disks' are encrypted with 'Customer Managed Key' (CMK)

## Description

Ensure that unattached disks in a subscription are encrypted with a Customer Managed Key (CMK).

## Rationale

Managed disks are encrypted by default with Platform-managed keys. Using Customer-managed keys may provide an additional level of security or meet an organization's regulatory requirements. Encrypting managed disks ensures that its entire content is fully unrecoverable without a key and thus protects the volume from unwarranted reads. Even if the disk is not attached to any of the VMs, there is always a risk where a compromised user account with administrative access to VM service can mount/attach these data disks, which may lead to sensitive information disclosure and tampering.

## Impact

**NOTE:** You must have your key vault set up to utilize this. Encryption is available only on Standard tier VMs. This might cost you more.

Utilizing and maintaining Customer-managed keys will require additional work to create, protect, and rotate keys.

## Audit Procedure

### Using Azure Portal

1. Go to `Disks`
2. Click on `Add Filter`
3. In the `filter` field select `Disk state`
4. In the `Value` field select `Unattached`
5. Click `Apply`
6. For each disk listed ensure that `Encryption type` in the `encryption` blade is `Encryption at-rest with a customer-managed key`

### Using Azure CLI

Ensure command below does not return any output.

```bash
az disk list --query '[? diskstate == `Unattached`].{encryptionSettings:encryptionSettings, name: name}' -o json
```

## Expected Result

All unattached disks should have encryption type set to `Encryption at-rest with a customer-managed key`. The `encryptionSettings` should not be `null`.

## Remediation

If data stored in the disk is no longer useful, refer to Azure documentation to delete unattached data disks at:

- https://docs.microsoft.com/en-us/rest/api/compute/disks/delete
- https://docs.microsoft.com/en-us/cli/azure/disk?view=azure-cli-latest#az-disk-delete

If data stored in the disk is important, to encrypt the disk refer to azure documentation at:

- https://docs.microsoft.com/en-us/azure/virtual-machines/disks-enable-customer-managed-keys-portal
- https://docs.microsoft.com/en-us/rest/api/compute/disks/update#encryptionsettings

## Default Value

By default, managed disks are encrypted with a Platform-managed key.

## References

1. https://docs.microsoft.com/en-us/azure/security/fundamentals/azure-disk-encryption-vms-vmss
2. https://docs.microsoft.com/en-us/azure/security-center/security-center-disk-encryption?toc=%2fazure%2fsecurity%2ftoc.json
3. https://docs.microsoft.com/en-us/rest/api/compute/disks/delete
4. https://docs.microsoft.com/en-us/cli/azure/disk?view=azure-cli-latest#az-disk-delete
5. https://docs.microsoft.com/en-us/rest/api/compute/disks/update#encryptionsettings
6. https://docs.microsoft.com/en-us/cli/azure/disk?view=azure-cli-latest#az-disk-update
7. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-5-use-customer-managed-key-option-in-data-at-rest-encryption-when-required

## Profile

Level 2 | Automated
