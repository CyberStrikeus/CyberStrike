---
name: cis-cassandra41-1.4
description: "Ensure latest version of Cassandra is installed"
category: cis-cassandra
version: "1.0.0"
author: cyberstrike-official
tags: [cis, cassandra, installation, updates, version-management]
cis_id: "1.4"
cis_benchmark: "CIS Apache Cassandra 4.1 Benchmark v1.0.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.4 Ensure latest version of Cassandra is installed

## Profile Applicability
- Level 1 - Cassandra on Linux

## Description
The Cassandra installation version, along with the patches, should be the most recent that is compatible with organizational operational needs. When obtaining and installing software packages (typically via apt-get or you can compile the source code), it's imperative that packages (or the source code, tarball) are sourced only from valid and authorized repositories.

For Cassandra, a short list of valid repositories may include:
- The official apache cassandra website: http://cassandra.apache.org/
- DataStax Enterprise: https://www.datastax.com/

## Rationale
Using the most recent version of Cassandra can help limit the possibilities for vulnerabilities in the software, the installation version applied during setup should be established according to the needs of the organization. Ensure you are using a release that is covered by a level of support which includes regular updates to address vulnerabilities.

## Audit
To verify the version of Cassandra you have installed:

```bash
cassandra -v

4.0.3 (a/o 2022-03-29)
```

Released on 2022-02-17
Maintained until 4.3.0 release (May-July 2024)

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
No default - depends on installation method and time.

## References
1. http://cassandra.apache.org/doc/latest/getting_started/installing.html#prerequisites

## CIS Controls
**v8:**
- 16.5 Use Up-to-Date and Trusted Third-Party Software Components
  - Use up-to-date and trusted third-party software components. When possible, choose established and proven frameworks and libraries that provide adequate security. Acquire these components from trusted sources or evaluate the software for vulnerabilities before use.

**v7:**
- 18.4 Only Use Up-to-date And Trusted Third-Party Components
  - Only use up-to-date and trusted third-party components for the software developed by the organization.

## Profile
- Level 1 | Automated
