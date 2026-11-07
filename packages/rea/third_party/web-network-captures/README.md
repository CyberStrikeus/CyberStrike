# Historical network upstream profiles

REA uses unmodified upstream packages or a caller-supplied tool. The adapter
code lives under `src/browser/history/` and `bridge/mitmproxy/`; this directory
records provenance rather than vendoring a second parser implementation.

| Upstream | Fixed profile | Use |
| --- | --- | --- |
| [har-schema](https://github.com/ahmadnassri/har-schema) | npm 2.0.0, ISC | HAR 1.2 draft-06 schemas |
| [jsonc-parser](https://github.com/microsoft/node-jsonc-parser) | npm 3.3.1, MIT | Strict JSON visitor; member sequence, duplicate detection and prototype-safe materialization |
| [lossless-json](https://github.com/josdejong/lossless-json) | npm 4.3.1 | Original JSON numeric lexemes and safe-number classification |
| [AJV](https://github.com/ajv-validator/ajv) | npm 8.20.0 | Upstream schema validation |
| [ajv-formats](https://github.com/ajv-validator/ajv-formats) | npm 3.0.1 | Upstream URI, timestamp and address formats |
| [mitmproxy](https://github.com/mitmproxy/mitmproxy) | v12.2.3, commit `6c09d56e4c29a92f5ad01b03199977584b8ea14f`, MIT | Unchanged native `mitmproxy.io.tnetstring.load`; upstream `FlowWriter` / `SaveHar` for ephemeral verification fixtures |

The npm lockfile pins exact package versions and distribution integrity hashes;
their original code and license files remain in the installed packages. Native
mitmproxy is bring-your-own. REA never installs or upgrades it and rejects a
different runtime version. The Linux verification lane downloads the official
standalone release into runner temporary storage with fixed archive SHA-256
`2e95286b618fa6fd33e5e62a78c2e5112571d85f42ec2bac29b97ee242bdb5c5`.
This is a pinned archive digest, not a publisher signature claim.

No native captures or game/application binaries are checked in. Verification
uses source-owned Python fixtures and upstream writers. The original file
digest/record representation is preserved independently of the decoded view;
upstream conversion defaults are not imported into native states.

The observed `SaveHar` 12.2.3 optional `postData.text: null` quirk is admitted
only in a validation copy for that declared producer profile, with the original
null retained. The upstream schemas themselves remain unchanged.

The strict JSON visitor supplies member events before object materialization;
REA rejects all duplicate names and retains original numeric token spelling.
The shared JSON representation preserves all own members, including `__proto__`,
`constructor`, and `prototype`, without invoking prototype setters. These names
do not make a capture unsupported.
