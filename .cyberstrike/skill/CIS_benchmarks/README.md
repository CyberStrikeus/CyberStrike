# CIS Benchmark Skills

Automated CIS benchmark audit skills for CyberStrike. Each skill maps to a single CIS control with audit procedures, remediation steps, and compliance mappings.

**Total: 1,731 controls across 27 benchmarks**

## Directory Tree

```
CIS_benchmarks/
├── Cloud_Providers/                          (985 controls)
│   ├── AWS/                                  (326 controls, 5 benchmarks)
│   │   ├── CIS_Amazon_Web_Services_Foundations_Benchmark_v7.0.0/    (70 controls)
│   │   ├── CIS_AWS_Compute_Services_Benchmark_v1.1.0/              (68 controls)
│   │   ├── CIS_AWS_Database_Services_Benchmark_v2.0.0/             (98 controls)
│   │   ├── CIS_AWS_End_User_Compute_Services_Benchmark_v1.2.0/     (34 controls)
│   │   └── CIS_AWS_Storage_Services_Benchmark_v1.0.0/              (56 controls)
│   │
│   ├── Google_Cloud_Platform/                (203 controls, 2 benchmarks)
│   │   ├── CIS_Google_Cloud_Platform_Foundation_Benchmark_v4.0.0/  (84 controls)
│   │   └── CIS_Google_Container-Optimized_OS_Benchmark_v1.2.0/     (119 controls)
│   │
│   ├── Google_Workspace/                     (89 controls, 1 benchmark)
│   │   └── CIS_Google_Workspace_Foundations_Benchmark_v1.3.0/      (89 controls)
│   │
│   └── Microsoft_Azure/                      (367 controls, 4 benchmarks)
│       ├── CIS_Microsoft_Azure_Compute_Services_Benchmark_v2.0.0/  (99 controls)
│       ├── CIS_Microsoft_Azure_Database_Services_Benchmark_v2.0.0/ (49 controls)
│       ├── CIS_Microsoft_Azure_Foundations_Benchmark_v5.0.0/       (155 controls)
│       └── CIS_Microsoft_Azure_Storage_Services_Benchmark_v1.0.0/  (64 controls)
│
└── Server_Software/                          (746 controls)
    ├── Apache_Cassandra/                     (118 controls, 6 benchmarks)
    │   ├── CIS_Apache_Cassandra_3.11_Benchmark_v1.1.0/             (19 controls)
    │   ├── CIS_Apache_Cassandra_4.0_Benchmark_v1.0.0/              (20 controls)
    │   ├── CIS_Apache_Cassandra_4.0_Benchmark_v1.1.0/              (20 controls)
    │   ├── CIS_Apache_Cassandra_4.0_Benchmark_v1.3.0/              (20 controls)
    │   ├── CIS_Apache_Cassandra_4.1_Benchmark_v1.0.0/              (19 controls)
    │   └── CIS_Apache_Cassandra_5.0_Benchmark_v1.1.0/              (20 controls)
    │
    ├── Apache_HTTP_Server/                   (170 controls, 2 benchmarks)
    │   ├── CIS_Apache_HTTP_Server_2.2_Benchmark_v3.6.0/            (83 controls)
    │   └── CIS_Apache_HTTP_Server_2.4_Benchmark_v2.3.0/            (87 controls)
    │
    ├── Apache_Tomcat/                        (185 controls, 4 benchmarks)
    │   ├── CIS_Apache_Tomcat_7_Benchmark_v1.0.0/                   (62 controls)
    │   ├── CIS_Apache_Tomcat_7_Benchmark_v1.1.0/                   (61 controls)
    │   ├── CIS_Apache_Tomcat_8_Benchmark_v1.0.0/                   (1/61 controls — WIP)
    │   └── CIS_Apache_Tomcat_10.1_Benchmark_v1.0.0/                (61 controls)
    │
    └── Docker/                               (273 controls, 3 benchmarks)
        ├── CIS_Docker_Benchmark_v1.6.0/                            (38 controls)
        ├── CIS_Docker_Benchmark_v1.7.0/                            (117 controls)
        └── CIS_Docker_Benchmark_v1.8.0/                            (118 controls)
```

## Skill Structure

Each control is a directory containing a `SKILL.md` file:

```
cis-<product>-<control-number>/
└── SKILL.md
```

### SKILL.md Contents

- YAML frontmatter (name, description, tags)
- Profile Applicability (Level 1/2, Manual/Automated)
- Description and Rationale
- Impact assessment
- Audit Procedure (copy-paste CLI commands)
- Remediation steps
- Default Value
- References
- CIS Controls v8/v7 mappings

## Categories

| Category  | Provider/Product      | Benchmarks | Controls  |
| --------- | --------------------- | ---------- | --------- |
| Cloud     | AWS                   | 5          | 326       |
| Cloud     | Google Cloud Platform | 2          | 203       |
| Cloud     | Google Workspace      | 1          | 89        |
| Cloud     | Microsoft Azure       | 4          | 367       |
| Server    | Apache Cassandra      | 6          | 118       |
| Server    | Apache HTTP Server    | 2          | 170       |
| Server    | Apache Tomcat         | 4          | 185       |
| Server    | Docker                | 3          | 273       |
| **Total** |                       | **27**     | **1,731** |
