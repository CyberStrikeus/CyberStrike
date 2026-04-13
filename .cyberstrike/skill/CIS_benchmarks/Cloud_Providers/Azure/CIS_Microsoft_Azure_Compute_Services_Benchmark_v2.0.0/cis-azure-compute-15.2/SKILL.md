---
name: cis-azure-compute-15.2
description: "Ensure Batch pools disk encryption is set enabled"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, batch]
cis_id: "15.2"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Batch pools disk encryption is set enabled

## Description

Azure Batch pools must have disk encryption enabled to protect data at rest on both OS and temporary disks, using Azure-managed encryption keys by default.

## Rationale

Enabling disk encryption meets compliance requirements, follows security best practices, and safeguards against unauthorized access to cached data and task outputs stored on VM disks.

## Impact

This ensures automatic encryption with minimal performance impact, though it requires pool recreation and is unsupported on Basic A-series VMs.

## Audit Procedure

### Using Azure Portal

1. Login to Azure portal https://portal.azure.com
2. Navigate to `Batch Accounts`

For each Batch account perform the following:

1. Expand the `Features` section then click on `Pools`
2. For each Pool ID, click the name to open the pool
3. Under the `Configuration` section, check `Disk Encryption`

If the pool is encrypted, it should display "OS disk" and/or "Temporary disk" `encryption enabled`.

### Using Azure CLI

Run the following commands:

```bash
# List all pools and their encryption status
az batch pool list \
    --account-name <batch-account-name> \
    --query "[].{id:id, encryption:deploymentConfiguration.virtualMachineConfiguration.diskEncryptionConfiguration}" \
    --output table
```

Expected Output: "OsDisk" and/or "TemporaryDisk" should be listed under `encryption.targets`.

### Using Azure PowerShell

Run the following command:

```powershell
# Get Batch account context
$batchContext = Get-AzBatchAccount -AccountName "<batch-account-name>"

# List all pools and check encryption
Get-AzBatchPool -BatchContext $batchContext | ForEach-Object {
    $pool = $_
    $encryptionConfig = $pool.DeploymentConfiguration.VirtualMachineConfiguration.DiskEncryptionConfiguration
    [PSCustomObject]@{
        PoolId = $pool.Id
        OsDiskEncrypted = $encryptionConfig.Targets -contains "OsDisk"
        TempDiskEncrypted = $encryptionConfig.Targets -contains "TemporaryDisk"
    }
}
```

Expected Output: OsDiskEncrypted and TempDiskEncrypted should be `True`.

## Expected Result

All Batch pools should have disk encryption enabled with "OsDisk" and/or "TemporaryDisk" listed as encryption targets.

## Remediation

**NOTE:** Encrypted pools must be created as replacements for unencrypted pools. Please ensure that necessary precautions are taken to backup and restore data from persistent disk pools.

### Using Azure Portal

1. Navigate to `Azure Batch accounts`
2. Select your Batch account
3. Click `Pools` in the left menu
4. For each unencrypted pool, click `Create new pool`
5. Under `Advanced settings`, enable `Disk encryption and select OS disk or All disks`
6. Configure all other settings to match your existing pool
7. Click `Create` to deploy the encrypted pool
8. Resize the old unencrypted pool to 0 nodes after verifying the new pool is operational

Repeat steps 4-8 for each unencrypted pool.

### Using Azure CLI

1. Get pool configuration:

```bash
config=$(az batch pool show --pool-id <pool-name> --query "{vmSize:vmSize,image:virtualMachineConfiguration.imageReference,nodeCount:targetDedicatedNodes}")
```

2. Create encrypted replacement:

```bash
az batch pool create \
    --id "<pool-name>-encrypted" \
    --vm-size $(jq -r '.vmSize' <<< "$config") \
    --image-reference "$(jq -r '.image.publisher + ":" + .image.offer + ":" + .image.sku + ":" + .image.version' <<< "$config")" \
    --node-count $(jq -r '.nodeCount' <<< "$config") \
    --disk-encryption-target OsDisk
```

3. Decommission old pool:

```bash
az batch pool resize --pool-id <pool-name> --target-dedicated-nodes 0
```

### Using Azure PowerShell

1. Get pool configuration:

```powershell
$pool = Get-AzBatchPool -Id "<pool-name>" -BatchContext $context
```

2. Create encrypted replacement:

```powershell
$newConfig = New-Object Microsoft.Azure.Commands.Batch.Models.PSPoolConfiguration
$newConfig.VirtualMachineConfiguration = $pool.VirtualMachineConfiguration.Clone()
$newConfig.VirtualMachineConfiguration.DiskEncryptionConfiguration = New-Object Microsoft.Azure.Commands.Batch.Models.PSDiskEncryptionConfiguration
$newConfig.VirtualMachineConfiguration.DiskEncryptionConfiguration.Targets = "OsDisk"
New-AzBatchPool -Id "<pool-name>-encrypted" -PoolConfiguration $newConfig -BatchContext $context
```

3. Decommission old pool:

```powershell
Set-AzBatchPool -Id "<pool-name>" -TargetDedicatedComputeNodes 0 -BatchContext $context
```

## Default Value

Disk encryption is **disabled** by default for new Azure Batch pools.

## References

1. https://docs.microsoft.com/en-us/azure/batch/disk-encryption
2. https://docs.microsoft.com/en-us/cli/azure/batch/pool#az-batch-pool-create

## Profile

Level 1 | Automated
