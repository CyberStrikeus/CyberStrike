---
name: cis-cassandra41-1.6
description: "Ensure clocks are synchronized on all nodes"
category: cis-cassandra
version: "1.0.0"
author: cyberstrike-official
tags: [cis, cassandra, cassandra-4.1, installation, ntp, time-sync]
cis_id: "1.6"
cis_benchmark: "CIS Apache Cassandra 4.1 Benchmark v1.0.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.6 Ensure clocks are synchronized on all nodes

## Profile Applicability
- Level 1 - Cassandra on Linux

## Description
Enabling Network Time Protocol (NTP), or some equivalent way, to keep clocks on all nodes in sync is critical.

## Rationale
Cassandra decides which data is most current between all of the nodes in the cluster based on timestamps. It is paramount to ensure all clocks are in-sync, otherwise the most current data may not be returned or worse, marked for deletion.

## Audit
Depending on the Linux installation this may be checked by executing the following command on each node:

```bash
ps -aef | grep ntp

OR

ps -aef | grep chronyd

OR

timedatectl status | grep NTP
```

If NTP is not configured or clocks are out-of-sync then this is a finding.

## Remediation
Install and start the time protocol on every node in the Cassandra cluster.

## Default Value
N/A

## References
N/A

## CIS Controls
- **v8 8.4** Standardize Time Synchronization
  - Standardize time synchronization. Configure at least two synchronized time sources across enterprise assets, where supported.
- **v7 6.1** Utilize Three Synchronized Time Sources
  - Use at least three synchronized time sources from which all servers and network devices retrieve time information on a regular basis so that timestamps in logs are consistent.

## Profile
- Level 1 - Cassandra on Linux | Manual
