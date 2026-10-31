# Verify real HTTP/3 MITM captures

This optional Linux laboratory checks native mitmproxy captures through REA's
public CLI and MCP. It changes no runtime contracts or adapters and establishes
only the specific producer, mode and clients exercised here.

## Prepare a disposable guest

The exercised image is [Omarchy 4.0.4, build 440](https://nightly.omarchy.org/stable/4.0.4/440/omarchy-4.0.4.qcow2),
SHA-256 `43412b896fe3d730e373a51a8acf99343d7c3e6dee78aa9f9bd7fca181127264`.
Download it without installing guest packages on the host, check its digest,
and use a **new qcow2 overlay** with that file as a read-only backing image.
The matching [boot artifacts](https://nightly.omarchy.org/stable/4.0.4/440/unpacked/)
include the kernel, initrd, cmdline and upstream vm-boot recipe. Use a fresh SSH
key, loopback forwarding and guest disk; do not reuse another investigation's
writable overlay or host trust configuration. Shut the guest down before
switching overlays. Preserve the image and boot artifact hashes with evidence.

This sealed guest already supplies cURL 8.22.0 with OpenSSL 3.6.4, ngtcp2 1.25.0,
nghttp3 1.18.0 and nghttp2 1.70.0. **No guest rolling package upgrade is needed.**
Run `curl --version` and verify HTTP2 and HTTP3 features before starting. A stock
cURL from another distribution may omit HTTP/3. For a different guest, building
cURL requires a compatible TLS library, ngtcp2 and nghttp3; follow the
[official build instructions](https://curl.se/docs/http3.html), install to a guest
private prefix, and record exact source revisions and build inputs. That alternative
has not been exercised by this laboratory; it is not the pinned reproduction path.

Use a fresh VM overlay over a sealed Linux image. Use user-mode networking with
SSH forwarding bound to host loopback; keep host directories unmounted. Install
and build dependencies inside the guest, then remove its default route before
generating traffic. Host trust, routes and installed packages stay unchanged.

Record the image digest, REA source revision and these dependency versions:

- REA's `.nvmrc`, `package.json#packageManager` and locked npm dependencies.
- Official Linux x86_64 mitmproxy **12.2.3** standalone archive. SHA-256:
  `2e95286b618fa6fd33e5e62a78c2e5112571d85f42ec2bac29b97ee242bdb5c5`.
- A private Python virtual environment using the complete pinned graph in
  `scripts/fixtures/http3-lab-requirements.txt`. Save `pip freeze` and build/download logs.
- OpenSSL and cURL advertising HTTP3 and HTTP2 in `curl --version`.

The verified guest used Python 3.14.7, cURL 8.22.0, ngtcp2 1.25.0 and nghttp3
1.18.0. The current requirements update certifi from 2026.7.22 to 2026.10.19
to remove the compromised emSign trust root described in
[GHSA-6q48-6c7w-9gw2](https://github.com/certifi/python-certifi/security/advisories/GHSA-6q48-6c7w-9gw2).
The revised dependency graph has not been rerun in that sealed guest; the
historical verification does not cover this update. Other dependency profiles
need verification. Back up the guest's
`/etc/hosts` before adding `127.0.0.1 lab.test`. Reserve guest TCP/UDP loopback
ports 18443 and 19443. These changes belong only to the disposable guest.

From the guest REA checkout, use its pinned Node/npm toolchain:

```sh
npm ci
npm run build:cached
python3 -m venv /absolute/lab/venv
/absolute/lab/venv/bin/pip install --no-deps -r scripts/fixtures/http3-lab-requirements.txt
/absolute/lab/venv/bin/pip check
/absolute/lab/venv/bin/pip freeze > /absolute/lab/python-requirements.txt
```

Before removing the guest default route, download the official mitmproxy archive
and verify it, then extract to the guest's private tools directory:

```sh
mkdir -p /absolute/lab/tools
curl --fail --location https://downloads.mitmproxy.org/12.2.3/mitmproxy-12.2.3-linux-x86_64.tar.gz \
  --output /absolute/lab/mitmproxy.tar.gz
printf '%s  %s\n' 2e95286b618fa6fd33e5e62a78c2e5112571d85f42ec2bac29b97ee242bdb5c5 \
  /absolute/lab/mitmproxy.tar.gz | sha256sum --check --strict
tar -xzf /absolute/lab/mitmproxy.tar.gz -C /absolute/lab/tools
/absolute/lab/tools/mitmdump --version
```

Pin the REA revision with `git rev-parse HEAD` or archive SHA-256. Build using
the exact `.nvmrc` and npm version; do not copy a different checkout's `dist`.
For stronger offline dependency reproduction, preserve downloaded Python
archives, their digests and built wheels along with the image and toolchain.
The requirement versions pin the runtime graph, not every transient build tool;
source builds and alternate interpreters are not guaranteed byte-identical.

## Run the narrow profile

Select absolute executables and a new evidence directory. The producer refuses
to reuse a directory. No certificates are installed in a system trust store;
clients and proxy receive explicit paths to freshly generated test CAs.

```sh
REA_MITMDUMP_COMMAND=/absolute/lab/tools/mitmdump \
REA_HTTP3_PYTHON_COMMAND=/absolute/lab/venv/bin/python \
npm run verify:web:http3 -- /absolute/evidence/run-1
```

The producer sends three concurrent binary POSTs on one HTTP/3 connection to the
same URL through mitmproxy reverse mode to an aioquic HTTP/3 origin. The origin
waits for all complete requests, then dispatches responses in reverse order of
completion at the origin. QUIC stream send/receive orders need not coincide. A cURL HTTP/3-only
request checks a second client implementation. Mitmproxy's real save addon
writes `normal.mitm`; no native flows are synthesized.

A second proxy run disables HTTP/3. cURL `--http3` falls back to HTTP/2, reaching
an HTTP/1.1 TLS test origin. `fallback.mitm` must retain those lower protocols,
so a successful HTTP request cannot masquerade as an HTTP/3 success.

## Acceptance and evidence

Each execution creates `verifications/<run-UUID>/` with its own diagnostics.
`verification-latest.json` belongs to the most recently registered attempt and
changes atomically from `running` to `passed` or `failed`. Registration and
the ownership check/replacement use the same SQLite transaction lock. An older
attempt finishing later keeps its own reports without replacing the marker.
The `.verification-lock.sqlite` pathname must remain in place while attempts
may run; SQLite releases the lock on connection close or process death.
Lock acquisition waits for the current owner without a timeout or lease
stealing. The verifier has per-command deadlines, but no overall run deadline;
a live stalled lock owner can therefore delay publication until it exits.
Only a successful attempt writes its own `verification.json`, after
all cleanup and input-integrity checks. `result.json` also records failures and
the original error separately from cleanup errors. Older successes remain in
identified history; a legacy root `verification.json` is archived before a rerun.
A killed verifier may leave `running`, which must never be interpreted as success.

Capture inputs live in `captures/`. To inspect them again without new traffic:

```sh
REA_MITMDUMP_COMMAND=/absolute/lab/tools/mitmdump \
npm run verify:web:http3 -- /absolute/evidence/run-1 --inspect-existing
```

Acceptance for the current run:

- Every positive native record reports HTTP/3, UDP, ALPN h3 and successful TLS
  timestamps on both legs. Connection IDs, producer TLS labels, exact TLS setup
  timestamps and connection errors match the UUID-matched producer observation
  on each leg. Endpoint handshakes independently observe QUIC v1.
- Native flow UUIDs remain distinct. Three endpoint streams share a connection
  on each leg. Origin dispatch reverses completed receipt. Client and capture
  ordering is observed, while association is verified independent of their order.
- CLI and MCP agree. Request/response bytes, lengths, SHA-256, ordered duplicate
  headers, method, scheme, authority and path match independent observations.
  Readable header names and values, request URL fields and ALPN also match;
  non-UTF-8 header bytes retain a null display value rather than replacement text.
- Actual MCP advertised schemas validate, Evidence preserves source digests and
  provider provenance, and the complete returned Evidence matches the retained MCP session records.
- The fallback capture reports client HTTP/2 over TCP and origin HTTP/1.1, with
  cURL independently reporting version 2. Input files remain unchanged.
- Every cleanup action is attempted on success and failure, and final lineage
  contains no live descendants. Recorded producer groups are inspected separately
  after token-verified cleanup, including after their launcher has exited.

Retain captures, endpoint/producer JSONL, proxy diagnostics, cURL output, manifest,
CLI/MCP output, advertised schema and session bundle. Export public certificates
and dependency/source provenance separately. Do not commit evidence, private
keys, dependencies or VM disks. Shut down the guest after exporting evidence.

The reverse proxy can preserve authority `lab.test:18443` while recording origin
port 19443. Mitmproxy's serialized flow/connection UUIDs are not stream IDs.
Endpoint stream IDs are scoped observations; this test invents no cross-leg
mapping. Mitmproxy 12.2.3's `QUICv1` label alone does not prove negotiation: the
fixture checks the negotiated `_quic._version` in pinned aioquic 1.2.0.

Coverage is native capture, Linux reverse mode, QUIC v1 and these clients.
Empty/absent/incomplete/redacted body semantics, cancellations, resets,
certificate failures, malformed captures, HAR and qlog are separate increments.
Local/WireGuard, browsers, QUIC v2, migration, 0-RTT, mTLS, replay, sustained load
and loss tolerance remain unverified by this profile. Passing it does not
establish general HTTP/3 support in REA.

Official references: [mitmproxy protocol support](https://github.com/mitmproxy/mitmproxy/blob/v12.2.3/docs/src/content/concepts/protocols.md),
[HTTP/3 implementation](https://github.com/mitmproxy/mitmproxy/blob/v12.2.3/mitmproxy/proxy/layers/http/_http3.py),
[serialized HTTP state](https://github.com/mitmproxy/mitmproxy/blob/v12.2.3/mitmproxy/http.py),
[aioquic configuration](https://github.com/aiortc/aioquic/blob/1.2.0/src/aioquic/quic/configuration.py).

## Verifier regressions

After building REA, run these inside the same isolated guest:

```sh
node --test scripts/lib/http3-verifier-lifecycle.test.mjs scripts/lib/http3-capture-assertions.test.mjs
/absolute/lab/venv/bin/python scripts/fixtures/http3-lab.test.py
```

These cover different QUIC stream completion orders, stale success reports,
multiple failed closes, separately owned process groups and partially acquired
resources, plus producer TLS fact mismatches on both legs and altered readable
fields with unchanged binary evidence. They test verifier
semantics; they do not add HTTP/3 provider coverage.
