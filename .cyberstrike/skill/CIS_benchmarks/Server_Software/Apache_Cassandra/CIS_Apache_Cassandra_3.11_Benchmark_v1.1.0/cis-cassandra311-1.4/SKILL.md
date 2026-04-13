---
name: cis-cassandra311-1.4
description: "Ensure latest version of Cassandra is installed"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, installation, updates]
cis_id: "1.4"
cis_benchmark: "CIS Apache Cassandra 3.11 Benchmark v1.1.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.4 Ensure latest version of Cassandra is installed

## Profile Applicability
- Level 1 - Cassandra on Linux
- Level 2 - Cassandra on Linux

## Description
The Cassandra installation version, along with the patches, should be the most recent that is compatible with organization's operational needs. When obtaining and installing software packages (typically via apt-get or you compile the source code), it's imperative that packages (or the source code, tarball) are sourced only from valid and authorized repositories.

For Cassandra, a short list of valid repositories may include:

- The official apache cassandra website: http://cassandra.apache.org/
- DataStax Enterprise: https://www.datastax.com/

## Rationale
Using the most recent version of Cassandra can help limit the possibilities for vulnerabilities in the software, the installation version applied during setup should be established according to the needs of the organization. Ensure you are using a release that is covered by a level of support which includes regular updates to address vulnerabilities.

## Audit
To verify the version of Cassandra you have installed:

```bash
cassandra -v

3.11.2 (as of 6/8/2018)
```

If an old/unsupported version of Cassandra is installed this is a finding.

## Remediation
Upgrade to the latest version of the Cassandra software:
For each node in the cluster:

1. Using the nodetool drain command to push all memtables data to SSTables.
2. Stop Cassandra services.
3. Backup the data set and all of your Cassandra configuration files.
4. Download/Update Java if needed.
5. Download/Update Python if needed.
6. Download the binaries for the latest Cassandra revision from the Cassandra Download Page.
7. Install new version of Cassandra.
8. Configure new version of Cassandra, taking into account all of your previous settings in your config files(cassandra.yml, cassandrea-env.sh, etc).
9. Start Cassandra services.
10. Check logs for warnings, errors.
11. Using the nodetool to upgrade your SSTables.
12. Using the nodetool command to check status of cluster.

## Default Value
No default version exists.

## References
1. http://cassandra.apache.org/doc/latest/getting_started/installing.html#prerequisite s

## CIS Controls
- v8: 16.5 Use Up-to-Date and Trusted Third-Party Software Components
- v7: 18.4 Only Use Up-to-date And Trusted Third-Party Components

## Profile
- Level 1 | Automated
