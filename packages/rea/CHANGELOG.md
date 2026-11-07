# Changelog

## [6.8.0](https://github.com/morluto/rea/compare/rea-agents-6.7.0...rea-agents-6.8.0) (2026-10-25)

### Highlights

- Build local agent environments from network captures, browser scenarios, or a prompt, then serve derived reads and evidence-gated writes and compare them with fresh application captures.
- Inspect more shipped formats, including GPU code objects, BEAM, Python bytecode, Unity IL2CPP metadata, Godot PCK, PyInstaller, Node.js SEA, devicetree, and additional PE/ELF tables.
- Keep large investigations focused with retained summaries, selected fact queries, configurable recovery limits, and row-oriented CLI exports. Complete Evidence remains available.

### ⚠ BREAKING CHANGES

- **Function analysis:** `analyze_function` now defaults to a retained summary. Set `detail: "complete"` for the previous inline dossier; the CLI retains its complete default and requires `--evidence_output` when selecting a summary. [#5660](https://github.com/morluto/rea/pull/5660). Thanks @CryptoJones, @gensokyo-dev, @RishTheFish21.
- **Accessibility:** Accept JSON numbers and booleans in node `value`, alongside strings and null. Update consumers that previously assumed text-only values. [cc90771](https://github.com/morluto/rea/commit/cc90771af14f045538651615147d8bf86b576549), [#6759](https://github.com/morluto/rea/pull/6759), [#6467](https://github.com/morluto/rea/issues/6467). Thanks @coygeek, @gensokyo-dev, @mvanhorn.
- **JSON Lines:** `--format jsonl` now emits object-collection rows followed by a `$rea: "jsonl/v1"`, `type: "metadata"` record; scalar selections and unsupported reports are refused. Parse control records separately, select a single supported collection when necessary, and use `--format json` for the previous whole-document output. See [JSON Lines framing](https://github.com/morluto/rea/blob/rea-agents-6.8.0/docs/cli.md#json-lines-record-output). [#5629](https://github.com/morluto/rea/pull/5629), [#5487](https://github.com/morluto/rea/issues/5487). Thanks @gensokyo-dev, @jayykernel, @vijaykiran06.
- **Interface Builder:** Keyed-archive graph identities use decimal table UIDs instead of authored `objectID`/`object-id`. Treat authored IDs as attributes and update persisted graph lookups; ibtool and native NIBArchive identities keep their source semantics. [6fbe67d](https://github.com/morluto/rea/commit/6fbe67d66e3d716db69929503a3a232a7ada0860).
- **Frida:** `instrument-with-frida` JSON returns the canonical Evidence directly. Read `normalized_result.cleanup_error` instead of the former top-level wrapper field. [48f700e](https://github.com/morluto/rea/commit/48f700ee35e0988ed973e5486dc9db33f2a5d944).
- **Reconstruction proof:** ID-array proof records no longer establish verified or ready ledgers. Supply implementation/revision bindings and individual claim outcomes; handle inapplicable, unavailable, and failed proof diagnostics. [f8b65e7](https://github.com/morluto/rea/commit/f8b65e78723b1e2169f94dd1226198ea3139707e).
- **Mach-O imports:** Handle a null import `name` when identity is ambiguous; use `raw_name` and `name_status` to distinguish observed expressions from exact symbols. [5d0d243](https://github.com/morluto/rea/commit/5d0d243a45c9132e1aff75d454ab53d86a74cc31), [169512a](https://github.com/morluto/rea/commit/169512a35bb015ff209168fb8bc1c9b31a2c678b).
- **Node.js:** Use a runtime satisfying `^22.23.4 || ^24.22.1 || >=26.12.1`; Node 23 and 25 are unsupported. Upgrade Node before installing or updating REA; the installer does not upgrade it. [#6315](https://github.com/morluto/rea/pull/6315), [#6283](https://github.com/morluto/rea/issues/6283). Thanks @GamerDubz, @gensokyo-dev, @ShikamaruNaaraa.
- **Browser storage:** Historical hashed storage remains readable, but comparisons stay unknown until both captures are recaptured in the new representation. [#6341](https://github.com/morluto/rea/pull/6341), [#6289](https://github.com/morluto/rea/issues/6289). Thanks @coygeek, @gongfpp.
- **Environment serving:** `environment-serve` serves derived state by default, including write tools whose effects are confirmed by recorded evidence. Use `--replay-only` for stateless replay of manifest tools. Read stop-summary `state` instead of `state_evidence_id`. [#5351](https://github.com/morluto/rea/pull/5351), [#6158](https://github.com/morluto/rea/pull/6158). Thanks @earakely-scale, @gensokyo-dev, @kaoru0822-kitauji.
- **MCP schemas:** Input advertisements default to compact. Set `REA_MCP_INPUT_SCHEMA_PROFILE=full` for complete advertised guidance and nested constraints. [#5975](https://github.com/morluto/rea/pull/5975). Thanks @gensokyo-dev.
- **Browser console arguments:** Accept null `argument_types` and `text_capture.status: "unavailable"` when the protocol argument inventory is omitted or malformed; preserve that uncertainty. [#6016](https://github.com/morluto/rea/pull/6016), [#5934](https://github.com/morluto/rea/issues/5934). Thanks @coygeek, @kaoru0822-kitauji.
- **Reconstruction summaries:** `summary.by_evidence_authority` is keyed by Evidence authority; read the former source-state counts from required `summary.by_source_state`. Regenerate ledgers whose closure digests depended on the old projection. [#5875](https://github.com/morluto/rea/pull/5875), [#5838](https://github.com/morluto/rea/issues/5838). Thanks @coygeek, @kaoru0822-kitauji.
- **Swift bindings:** Conformance `type_name` and `protocol_name` may be null; consume typed `type_binding`/`protocol_binding` evidence. Replace the former Objective-C-specific import-binding type/schema with `MachoImportBinding`. [d0067ba](https://github.com/morluto/rea/commit/d0067ba34a39ea47dd7e11bb2e6169bc0938cc3f).
- **WebSocket frames:** Accept null opcodes and preserve unknown frame facts; numeric opcodes are restricted to the four-bit protocol range. [0bc2b42](https://github.com/morluto/rea/commit/0bc2b42001f684beffcf47b70e507443b1a5d320).
- **Resource-only inspection:** Evidence subjects and executable digests may be null. Use `resource_root` and each resource's reported provenance instead of requiring an executable target. [6a6adf7](https://github.com/morluto/rea/commit/6a6adf703fa44100643947d20fbc670f86260b1b).
- **Browser timestamps:** Console and session-timeline timestamps may be null when the protocol supplies no finite/comparable time. Keep unknown time explicit in sorting and comparisons. [690fc51](https://github.com/morluto/rea/commit/690fc518540bae982038a74f47ef7781201785aa), [2a0410f](https://github.com/morluto/rea/commit/2a0410f1717b3126e8a95063d77dea66a597010a).
- **Reference sources:** Read failed root enumeration from `rootFailure` rather than a synthetic failed child at `"."`; preserve the top-level source-graph limitation. [6296fdf](https://github.com/morluto/rea/commit/6296fdf560f1ac4aa55985558edaa98300aacdbc).
- **Filesystem capture:** Accept `entry_unavailable` and `identity_changed` enumeration omission reasons in addition to the previous reason literals. [c85b44e](https://github.com/morluto/rea/commit/c85b44e1b14851c54e65327a4807f79ad5cd5a61). Thanks @rudrakshagarwal4200-ai.
- **APK locales:** Replace numeric legacy selectors such as `es-r419` with `es-419` or `b+es+419`. Two-letter regions remain supported. [29910d1](https://github.com/morluto/rea/commit/29910d16b98fe4b607a7aa15928789a73614b0b9). Thanks @mertkayacs.
- **XML plist scalars:** Recognize `$plist_type: "unknown"` and read `element`, `literal`, and `reason`; unresolved XML scalars use this wrapper instead of the former real/null unknown marker or malformed scalar prefixes. Supported extended UTC years preserve their timestamp. [3537e58](https://github.com/morluto/rea/commit/3537e58c1ab29309f06eabf50bc52adba9817a0c).

### Changes

- **Binary layouts:** Inspect ELF32 i386, little-endian ARM, and little- or big-endian MIPS `EXEC`/`DYN`/`REL` layouts on Linux x64 using a caller-supplied pwntools environment. [#7052](https://github.com/morluto/rea/pull/7052), [#6934](https://github.com/morluto/rea/issues/6934). Thanks @roblennon, @salmanalmutairi1.
- **Agent environments:** Project network captures and Evidence files into manifests, preserve template path pairs and positions, export AgentEnv bundles, and serve manifests as replay environments. [#4954](https://github.com/morluto/rea/pull/4954), [#5293](https://github.com/morluto/rea/pull/5293), [#5664](https://github.com/morluto/rea/pull/5664), [#4999](https://github.com/morluto/rea/pull/4999), [#4975](https://github.com/morluto/rea/pull/4975). Thanks @earakely-scale, @gensokyo-dev, @kaoru0822-kitauji.
- **Capture to environment:** Build environments from browser scenarios or a prompt, extract the initial observed state, and compare the environment with application probe captures. [#5182](https://github.com/morluto/rea/pull/5182), [#6946](https://github.com/morluto/rea/pull/6946), [#5319](https://github.com/morluto/rea/pull/5319), [#5699](https://github.com/morluto/rea/pull/5699). Thanks @earakely-scale, @gensokyo-dev, @kaoru0822-kitauji.
- **State-backed tools:** Render read filters, search, sorting and paging from state; apply confirmed write effects with broader state targets and recording-based write admission. [#5352](https://github.com/morluto/rea/pull/5352), [293832b](https://github.com/morluto/rea/commit/293832bafc9a054914ec514fe906dd4936c7a372), [#5800](https://github.com/morluto/rea/pull/5800), [#5787](https://github.com/morluto/rea/pull/5787), [#5600](https://github.com/morluto/rea/pull/5600), [5375ff0](https://github.com/morluto/rea/commit/5375ff0f9aadb4fd0d46333815aa0431e3df1010), [#6169](https://github.com/morluto/rea/pull/6169), [#6385](https://github.com/morluto/rea/pull/6385), [#6897](https://github.com/morluto/rea/pull/6897). Thanks @earakely-scale, @gensokyo-dev, @kaoru0822-kitauji.
- **State learning:** Model application-assigned values, preserve view-specific clock spellings, learn write clocks from scenario timing, derive fields, and learn creates across sorted arrays and referenced entities. [7ec9b6e](https://github.com/morluto/rea/commit/7ec9b6e56e1b3762285dca881db6d900a389ab9c), [#6136](https://github.com/morluto/rea/pull/6136), [957bcfa](https://github.com/morluto/rea/commit/957bcfa149c1a0593bb0aa2466cc56d1d4f62e7d), [#6138](https://github.com/morluto/rea/pull/6138), [#6967](https://github.com/morluto/rea/pull/6967), [#7025](https://github.com/morluto/rea/pull/7025), [#7034](https://github.com/morluto/rea/pull/7034). Thanks @earakely-scale.
- **Recorded writes:** Serve creates whose compatible read-backs add omitted fields or express timestamps at a different precision, and whole-object updates that regenerate observed slugs or modification times. Conflicting observations still withhold writes. State views and bundles carrying the new read-back data need REA 6.8.0 or later to serve. [#7080](https://github.com/morluto/rea/pull/7080). Thanks @earakely-scale.
- **Native investigations:** Page native inventory summaries, match functions across builds, export pseudocode to resumable directories, and select objdump disassembly by symbol. [#5378](https://github.com/morluto/rea/pull/5378), [#5390](https://github.com/morluto/rea/pull/5390), [#6170](https://github.com/morluto/rea/pull/6170), [#5171](https://github.com/morluto/rea/pull/5171), [#4249](https://github.com/morluto/rea/issues/4249), [#5343](https://github.com/morluto/rea/issues/5343), [#5159](https://github.com/morluto/rea/issues/5159). Thanks @coygeek, @CryptoJones, @gensokyo-dev, @kaoru0822-kitauji.
- **Engine workflows:** Bound a single Ghidra decompilation without closing its session, analyze GameCube/Wii DOL executables, and inspect static CUDA/HIP code objects. [#5662](https://github.com/morluto/rea/pull/5662), [#6240](https://github.com/morluto/rea/pull/6240), [#5813](https://github.com/morluto/rea/pull/5813), [#5340](https://github.com/morluto/rea/issues/5340), [#5345](https://github.com/morluto/rea/issues/5345). Thanks @arielfikru, @coygeek, @gensokyo-dev, @RishTheFish21.
- **PE/ELF:** Inspect export tables without an engine, PE imports/delay-loads, Authenticode certificates, TLS callbacks/load configuration, ELF notes, Linux kernel module metadata, and Zstandard section-name tables. [#6278](https://github.com/morluto/rea/pull/6278), [#6509](https://github.com/morluto/rea/pull/6509), [#4830](https://github.com/morluto/rea/pull/4830), [#7008](https://github.com/morluto/rea/pull/7008), [#4837](https://github.com/morluto/rea/pull/4837), [#7010](https://github.com/morluto/rea/pull/7010), [#6987](https://github.com/morluto/rea/pull/6987), [#4057](https://github.com/morluto/rea/issues/4057). Thanks @gensokyo-dev, @kaoru0822-kitauji, @mvanhorn, @Rinkia, @ShuaixinHuang.
- **Apple/native metadata:** Inspect IPS crash reports, decode Swift nominal declarations, and select universal Mach-O slices in Go/Rust metadata readers. [#6511](https://github.com/morluto/rea/pull/6511), [#6257](https://github.com/morluto/rea/pull/6257), [#6219](https://github.com/morluto/rea/pull/6219), [#5341](https://github.com/morluto/rea/issues/5341), [#4102](https://github.com/morluto/rea/issues/4102). Thanks @coygeek, @gensokyo-dev, @kaoru0822-kitauji, @mvanhorn, @Rinkia.
- **Packaged applications:** Triage desktop installation directories and inspect/extract Godot PCK, PyInstaller archives, and Node.js single-executable application blobs. [#5207](https://github.com/morluto/rea/pull/5207), [#3634](https://github.com/morluto/rea/pull/3634), [afa5da7](https://github.com/morluto/rea/commit/afa5da745e0b139e68029a96b776ae30e48ea2b2), [#2433](https://github.com/morluto/rea/pull/2433), [#7000](https://github.com/morluto/rea/pull/7000), [#4399](https://github.com/morluto/rea/issues/4399). Thanks @0xthearchitect, @coygeek, @gensokyo-dev, @mvanhorn.
- **Unity and managed code:** Inventory IL2CPP images/types/methods and metadata versions 24/27; read member names and literals, link native methods and generic instances, and export Ghidra seeds. Project managed call/field-access edges and page managed member summaries. [#3807](https://github.com/morluto/rea/pull/3807), [#5326](https://github.com/morluto/rea/pull/5326), [52d1a72](https://github.com/morluto/rea/commit/52d1a72af047a73b787b8935b032786a34966036), [#5327](https://github.com/morluto/rea/pull/5327), [#5785](https://github.com/morluto/rea/pull/5785), [#6260](https://github.com/morluto/rea/pull/6260), [#5167](https://github.com/morluto/rea/pull/5167), [#3784](https://github.com/morluto/rea/issues/3784), [#5112](https://github.com/morluto/rea/issues/5112), [#4056](https://github.com/morluto/rea/issues/4056), [#5148](https://github.com/morluto/rea/issues/5148). Thanks @8rulerstar, @alexlanghart, @elricfd, @gensokyo-dev, @jaelliot, @kaoru0822-kitauji, @Rinkia.
- **Android:** Inspect APK signing declarations and structured manifest components; report static-final DEX field values. [e93e3b1](https://github.com/morluto/rea/commit/e93e3b1e7d6e7e4f49c2de24b92452ec29e853f8), [#4158](https://github.com/morluto/rea/pull/4158), [#5025](https://github.com/morluto/rea/pull/5025), [#6981](https://github.com/morluto/rea/pull/6981), [#4537](https://github.com/morluto/rea/issues/4537), [#6397](https://github.com/morluto/rea/issues/6397). Thanks @Abelo9996, @BaaRai, @FerroLx, @gensokyo-dev, @sserrgo12.
- **Bytecode and firmware:** Inspect and query CPython pyc and BEAM facts, inspect flattened devicetrees, and attribute MMIO peripheral regions in native disassembly. [#4826](https://github.com/morluto/rea/pull/4826), [#6928](https://github.com/morluto/rea/pull/6928), [#4833](https://github.com/morluto/rea/pull/4833), [#6943](https://github.com/morluto/rea/pull/6943), [#7009](https://github.com/morluto/rea/pull/7009), [#5348](https://github.com/morluto/rea/pull/5348), [#6922](https://github.com/morluto/rea/issues/6922), [#6938](https://github.com/morluto/rea/issues/6938). Thanks @gensokyo-dev, @liziye627-design, @mvanhorn.
- **JavaScript:** Retain queryable static route inventories, link assignment values to writes, and accept source selections as a JSON array or file. [#6019](https://github.com/morluto/rea/pull/6019), [#6206](https://github.com/morluto/rea/pull/6206), [#5029](https://github.com/morluto/rea/pull/5029), [#4772](https://github.com/morluto/rea/issues/4772), [#6193](https://github.com/morluto/rea/issues/6193). Thanks @gensokyo-dev, @IvenKooLab, @jacobmalibiran, @JoshOsullivan-au, @kaoru0822-kitauji, @KJLavender.
- **Data inspection:** Decode selected protobuf/gRPC bodies, inspect GGUF/safetensors declarations, and produce byte-entropy profiles. [#5031](https://github.com/morluto/rea/pull/5031), [#5603](https://github.com/morluto/rea/pull/5603), [#2331](https://github.com/morluto/rea/pull/2331), [#4986](https://github.com/morluto/rea/issues/4986), [#3323](https://github.com/morluto/rea/issues/3323). Thanks @AayushJB03, @gensokyo-dev, @kaoru0822-kitauji, @KJLavender, @michaelkillgta, @mvanhorn.
- **CLI input/output:** Accept structured request documents on stdin and expose version/runtime output formats. Row-oriented JSONL exports use the migration above. [#7040](https://github.com/morluto/rea/pull/7040), [#5486](https://github.com/morluto/rea/issues/5486), [#6530](https://github.com/morluto/rea/pull/6530), [169512a](https://github.com/morluto/rea/commit/169512a35bb015ff209168fb8bc1c9b31a2c678b), [#5483](https://github.com/morluto/rea/issues/5483). Thanks @Abelo9996, @ahmed-husssain, @CassieFox23, @DeryFerd, @eco-null, @ezrabrilliant, @GamerDubz, @gensokyo-dev, @gongfpp, @hifzabuildsai, @jayykernel, @mhamzasakhi, @pablodiazjorge, @Plastic-time, @raidnouredden-ux, @SandstromPL, @ShuaixinHuang, @Sriram-PR, @XiaoBinGan.
- **MCP and setup:** Add opt-in Streamable HTTP and FreeBuff setup registration. FreeBuff support first appears in 6.8.0; installed native FreeBuff loading and skill discovery remain unverified. [#4955](https://github.com/morluto/rea/pull/4955), [#2736](https://github.com/morluto/rea/pull/2736), [#3243](https://github.com/morluto/rea/issues/3243). Thanks @0xLLVEL, @codebuff-team, @earakely-scale, @gensokyo-dev, @kaoru0822-kitauji.
- **Recovery controls:** Adjust per-call WASM/SQLite/firmware deadlines, MCP startup budgets, regex matching deadlines/worker heap, capture decoder heap, ASAR header admission, Apple dispatch input, and the bridge request ceiling. MCP runtime limit recovery reports actionable settings. [#5798](https://github.com/morluto/rea/pull/5798), [#5818](https://github.com/morluto/rea/pull/5818), [aa53c06](https://github.com/morluto/rea/commit/aa53c065387c58b4189d82c47f1f3445fc505e30), [#5863](https://github.com/morluto/rea/pull/5863), [#6304](https://github.com/morluto/rea/pull/6304), [#6267](https://github.com/morluto/rea/pull/6267), [#6301](https://github.com/morluto/rea/pull/6301), [#6299](https://github.com/morluto/rea/pull/6299), [#6209](https://github.com/morluto/rea/pull/6209), [#6233](https://github.com/morluto/rea/pull/6233), [#6376](https://github.com/morluto/rea/pull/6376), [#7049](https://github.com/morluto/rea/pull/7049), [#5797](https://github.com/morluto/rea/issues/5797), [#5812](https://github.com/morluto/rea/issues/5812), [#5851](https://github.com/morluto/rea/issues/5851), [#6176](https://github.com/morluto/rea/issues/6176), [#3917](https://github.com/morluto/rea/issues/3917). Thanks @gensokyo-dev, @jaychou813, @kaoru0822-kitauji.
- **APK output:** Set `string_tables_only` or CLI `--string-tables-only` to omit duplicate primary strings and avoid their output-capacity charge. [7c458f0](https://github.com/morluto/rea/commit/7c458f04b9155707c8ba406f8b455b10016f1b99), [#4990](https://github.com/morluto/rea/pull/4990), [#4982](https://github.com/morluto/rea/issues/4982). Thanks @gensokyo-dev, @kaoru0822-kitauji, @N0zoM1z0.
- **Retained analysis:** Reuse successful validation of authenticated immutable native/imported-JavaScript parents and captures. Query retained Go build identity, Rust dependencies, JavaScript source-to-bundle mappings, and native export facts without repeating full output. [8f7d12e](https://github.com/morluto/rea/commit/8f7d12e30d63f3d3b4cfe2a90336362841438f56), [#4962](https://github.com/morluto/rea/pull/4962), [#5349](https://github.com/morluto/rea/pull/5349), [#5524](https://github.com/morluto/rea/pull/5524), [#5815](https://github.com/morluto/rea/pull/5815), [#6128](https://github.com/morluto/rea/pull/6128), [#6907](https://github.com/morluto/rea/pull/6907), [#4810](https://github.com/morluto/rea/issues/4810), [#5499](https://github.com/morluto/rea/issues/5499), [#5802](https://github.com/morluto/rea/issues/5802), [#6112](https://github.com/morluto/rea/issues/6112), [#6900](https://github.com/morluto/rea/issues/6900). Thanks @gensokyo-dev, @kaoru0822-kitauji, @N0zoM1z0.
- **Compact results:** Use retained Frida/GDB/objdump summaries, omit redundant Ghidra raw results, and defer the analysis runtime during MCP catalog discovery. [#5661](https://github.com/morluto/rea/pull/5661), [#5614](https://github.com/morluto/rea/pull/5614), [#5355](https://github.com/morluto/rea/pull/5355), [#4424](https://github.com/morluto/rea/pull/4424), [#5640](https://github.com/morluto/rea/issues/5640), [#5584](https://github.com/morluto/rea/issues/5584), [#5337](https://github.com/morluto/rea/issues/5337). Thanks @coygeek, @gensokyo-dev, @kaoru0822-kitauji, @leeguooooo.
- **Analysis work:** Reuse Hopper literal-string records, JavaScript workers and captured prefix selections, Interface Builder validation and plist scalar schemas; bound stable reads to one snapshot buffer and avoid decoding omitted GGUF strings. [#5017](https://github.com/morluto/rea/pull/5017), [#5819](https://github.com/morluto/rea/pull/5819), [31de177](https://github.com/morluto/rea/commit/31de177404461d122761d8243abe4fd24564f4da), [#5885](https://github.com/morluto/rea/pull/5885), [85e38ac](https://github.com/morluto/rea/commit/85e38ac199dff15e8c43343d9170db7e0e46d284), [#6966](https://github.com/morluto/rea/pull/6966), [#5781](https://github.com/morluto/rea/pull/5781), [#5010](https://github.com/morluto/rea/issues/5010), [#5855](https://github.com/morluto/rea/issues/5855), [#6954](https://github.com/morluto/rea/issues/6954), [#5774](https://github.com/morluto/rea/issues/5774). Thanks @gensokyo-dev, @kaoru0822-kitauji.
- **Native scheduling:** Batch modern IDA callee lookups, schedule decompilation reads on demand, index NativeAOT type closure, and retain call-path ancestry once per visited node. [0c6fed9](https://github.com/morluto/rea/commit/0c6fed90b74c75a9fd23d1ec1b510a7274f85887), [06fe7ee](https://github.com/morluto/rea/commit/06fe7eecbc8c387414b4c1aa0d88ad6314f54f0c), [ce61680](https://github.com/morluto/rea/commit/ce61680c04c95a9cdfad5335632a99542af26d37), [5e4ec0f](https://github.com/morluto/rea/commit/5e4ec0fa1b678aa3bf20704ec9110224ba8c1676).
- **Selected processing:** Prepare CLI positional schemas only for the selected command, separate entropy reads from report resolution, prune typed-array reference escapes, index state-write cutoffs, decode only selected replay query values, and skip payload text during WAT framing. [315b234](https://github.com/morluto/rea/commit/315b23403f0819967878cee418c3f9cb4b1a69d9), [#6950](https://github.com/morluto/rea/pull/6950), [#5139](https://github.com/morluto/rea/pull/5139), [#5350](https://github.com/morluto/rea/pull/5350), [96ea32b](https://github.com/morluto/rea/commit/96ea32b7e4e28d3c9cd79a1de4b8e1ba3b4244e9), [70835d3](https://github.com/morluto/rea/commit/70835d3d5f030deadf606e1c79c70a60883e50c9), [#5766](https://github.com/morluto/rea/pull/5766), [#6947](https://github.com/morluto/rea/issues/6947), [#5760](https://github.com/morluto/rea/issues/5760). Thanks @galleonli, @gensokyo-dev, @kaoru0822-kitauji.

### Fixes

- **IPS report fields:** Preserve the recorded terminating process and PID, termination flags, parent PID, and build/platform metadata. [#7079](https://github.com/morluto/rea/pull/7079), [#7078](https://github.com/morluto/rea/issues/7078). Thanks @rodricksz4h5.
- **Ghidra language selection:** Accept stock language IDs containing `LEBE` or slash-separated processor names, and report conflicting DOL language overrides as configuration errors naming `REA_GHIDRA_LANGUAGE_ID`. [#7070](https://github.com/morluto/rea/pull/7070), [#7072](https://github.com/morluto/rea/issues/7072), [#7081](https://github.com/morluto/rea/pull/7081), [#7082](https://github.com/morluto/rea/issues/7082). Thanks @Adolanium.
- **Setup and Hopper:** Preserve the Linux embedding runtime, supported x86_64 host restriction, readiness-based provider choices, orderly demo-helper shutdown, and installed apt dependency versions. Keep cleanup and skill publication ownership through retries. [#5041](https://github.com/morluto/rea/pull/5041), [#3422](https://github.com/morluto/rea/pull/3422), [f5d1012](https://github.com/morluto/rea/commit/f5d1012fabfe99af82523c3078ce9d93eb3780c1), [#4966](https://github.com/morluto/rea/pull/4966), [#6974](https://github.com/morluto/rea/pull/6974), [211e353](https://github.com/morluto/rea/commit/211e3533b34f81ae0910ad4f53f2a3d3c8587d3e), [#6920](https://github.com/morluto/rea/pull/6920), [#5015](https://github.com/morluto/rea/issues/5015), [#3419](https://github.com/morluto/rea/issues/3419), [#4921](https://github.com/morluto/rea/issues/4921), [#6975](https://github.com/morluto/rea/issues/6975). Thanks @Abel-I-Akhigbe, @Adolanium, @DavidFB-creator, @DeryFerd, @gensokyo-dev, @kaoru0822-kitauji, @sx4im.
- **Client setup:** Treat empty APPDATA as unset, distinguish MSIX Claude Desktop process views, preserve aliased Hermes server tables, reuse client dialect/alias bindings, and materialize the pinned package-runner cache before the first start. [#5126](https://github.com/morluto/rea/pull/5126), [#4903](https://github.com/morluto/rea/pull/4903), [#3785](https://github.com/morluto/rea/pull/3785), [b7eeded](https://github.com/morluto/rea/commit/b7eededf5af5061a834f93f57f2c888acf870344), [#7032](https://github.com/morluto/rea/pull/7032), [#5104](https://github.com/morluto/rea/issues/5104), [#4278](https://github.com/morluto/rea/issues/4278), [#3320](https://github.com/morluto/rea/issues/3320), [#7027](https://github.com/morluto/rea/issues/7027). Thanks @CmsChase, @coygeek, @myso-kr, @pablodiazjorge, @vaidehi-snk, @wxj006007.
- **Target admission:** Preserve thin arm64_32 Mach-O support, distinguish JVM identity before FAT admission, validate FAT format/CPU identity, preserve original DOS header padding, and reject NULs in local objdump/rizin paths. [#5788](https://github.com/morluto/rea/pull/5788), [6843dbe](https://github.com/morluto/rea/commit/6843dbea9bce4709ee2e8bf46c38f0bbf640716b), [497037e](https://github.com/morluto/rea/commit/497037e6e3975cbb37cfd89ea0ad300faa2a4769), [#7013](https://github.com/morluto/rea/pull/7013), [#3600](https://github.com/morluto/rea/pull/3600), [#5713](https://github.com/morluto/rea/issues/5713), [#6510](https://github.com/morluto/rea/issues/6510). Thanks @coygeek, @dhruvac29, @kaoru0822-kitauji, @Lew1sWong, @qorvr.
- **Mach-O and dylibs:** Preserve container framing, facts when dyld rejects a missing UUID, verified-signature snapshot identity, unsigned diagnostics, absolute paths inside the selected root, legacy platform rules, lazy-load payloads, and reasons for rejecting present dylibs. [cf3288d](https://github.com/morluto/rea/commit/cf3288d8cf7a09685acf89103b36c32359be56fa), [2b263a7](https://github.com/morluto/rea/commit/2b263a7fe9e9d4c185c7d6af6b4e67b21a73af30), [eb7acc7](https://github.com/morluto/rea/commit/eb7acc70bf06f119e8639e30a78081d5ba82b0bf), [1502cfb](https://github.com/morluto/rea/commit/1502cfbc8ca0d1d1d86eebf334018dfb418bbac0), [90062c0](https://github.com/morluto/rea/commit/90062c092228dea9d33fadc0d7e1b968105b8b2c), [#5650](https://github.com/morluto/rea/pull/5650), [3b67b36](https://github.com/morluto/rea/commit/3b67b362aa2cd79eac5af57d0965e81a7d0b8c2b), [#5551](https://github.com/morluto/rea/issues/5551). Thanks @coygeek.
- **Native facts:** Admit direct dispatch-metadata providers; preserve record-local Objective-C omissions, snapshot profiles, class-import binding identity, stripped class labels, version-like names, and qualified Swift protocol identities. [50b6975](https://github.com/morluto/rea/commit/50b6975d861069e2c6cfa202780621449f863802), [9eec57b](https://github.com/morluto/rea/commit/9eec57b469087fe9bff3d29dcc02f47074159e91), [0ba4d6f](https://github.com/morluto/rea/commit/0ba4d6f43ad610dacc861a1548be1a5c4712cd61), [4d7de00](https://github.com/morluto/rea/commit/4d7de00d4cc9a95ec2b7a3123b04e01db2daafa0), [22c84ce](https://github.com/morluto/rea/commit/22c84ce64aa6c7601aa81af86d4117b5a4c2feac), [4852c83](https://github.com/morluto/rea/commit/4852c830af1e3b9df437235b7a8fa8970a6d1c59), [aa9043f](https://github.com/morluto/rea/commit/aa9043f6b61c453e4735795cfe6a559bf6b6cc16).
- **Apple resources:** Preserve independent plist scalars, processing instructions, nonstandard table widths, unsupported NIB connector coverage, and strict IPS JSON surrogate validation; classify Interface Builder objects by their declared superclass chains. [fd728f2](https://github.com/morluto/rea/commit/fd728f271e7de7bcfa63890b573715720d5f948c), [#5806](https://github.com/morluto/rea/pull/5806), [4526862](https://github.com/morluto/rea/commit/4526862728af01f1135714079c0d8a8c754eb364), [14cd78c](https://github.com/morluto/rea/commit/14cd78c3224edcf79fca152915077112f547b9ed), [#6990](https://github.com/morluto/rea/pull/6990), [#5805](https://github.com/morluto/rea/issues/5805), [#5228](https://github.com/morluto/rea/pull/5228), [#5218](https://github.com/morluto/rea/issues/5218). Thanks @coygeek, @DeryFerd, @kaoru0822-kitauji, @Mangolycheematcha, @mhamzasakhi, @Shreyash021104.
- **Archives and files:** Complete positional ZIP reads, preserve bounded ASAR signatures, report stable symlink loops as resolution failures, retain target applicability, and report unknown traversal coverage. Retain reported integrity contradictions for members present in only one compared artifact. [#4414](https://github.com/morluto/rea/pull/4414), [e8da7e1](https://github.com/morluto/rea/commit/e8da7e1edd075feec0e6beedec93d5645fed8125), [#5571](https://github.com/morluto/rea/pull/5571), [#5763](https://github.com/morluto/rea/pull/5763), [#5867](https://github.com/morluto/rea/pull/5867), [#5521](https://github.com/morluto/rea/issues/5521), [#5731](https://github.com/morluto/rea/issues/5731), [#5837](https://github.com/morluto/rea/issues/5837), [#7076](https://github.com/morluto/rea/pull/7076). Thanks @Afloat16, @coygeek, @jdotc1, @kaoru0822-kitauji, @WenyuChiou.
- **Extraction and file ownership:** Restrict destination-case recovery to owned collisions, retain physical-read failures through late cancellation/cleanup, preserve cleanup capabilities for retry, and retain independent firmware extraction failures. [932fbb7](https://github.com/morluto/rea/commit/932fbb7d84a9a995b9aee3c1be7da05a8c4d7bbb), [9499667](https://github.com/morluto/rea/commit/949966712e68d8857a50a165ecddf04c2d7e6d3b), [56679dd](https://github.com/morluto/rea/commit/56679dd2ae31dda58e181f8bf99775014f7bb82b), [b3c912a](https://github.com/morluto/rea/commit/b3c912ab79ad147a37b6cfbe1552a1a5eecec629), [7298bd0](https://github.com/morluto/rea/commit/7298bd08d134860b84b4073f6703021916a5a4c5).
- **Processes and cancellation:** Retain partial samples and shutdown gaps, unresolved descendants and caller abort reasons; bind cleanup errors to their owners, propagate comparison contradictions, and report no normal exit code for signalled targets. [ba866a2](https://github.com/morluto/rea/commit/ba866a26ecbe179a717e746cbc0d1605ae616ad5), [#5270](https://github.com/morluto/rea/pull/5270), [#6144](https://github.com/morluto/rea/pull/6144), [a721c42](https://github.com/morluto/rea/commit/a721c42c07dc674c32ab939627355b8a1bee97a5), [#6298](https://github.com/morluto/rea/pull/6298), [#6486](https://github.com/morluto/rea/pull/6486), [#5935](https://github.com/morluto/rea/issues/5935), [#5944](https://github.com/morluto/rea/issues/5944), [#6100](https://github.com/morluto/rea/issues/6100), [#6101](https://github.com/morluto/rea/issues/6101), [#6110](https://github.com/morluto/rea/issues/6110), [#6113](https://github.com/morluto/rea/issues/6113), [#6121](https://github.com/morluto/rea/issues/6121), [#6131](https://github.com/morluto/rea/issues/6131), [#6132](https://github.com/morluto/rea/issues/6132), [#6218](https://github.com/morluto/rea/issues/6218), [#6445](https://github.com/morluto/rea/issues/6445). Thanks @agorevski, @coygeek, @gongfpp, @kwakhyun, @mhamzasakhi.
- **Provider cleanup:** Preserve Windows native handles until close is confirmed, native/Inspector/Electron cleanup ownership, Kuna probe identity and cleanup, IDA registration configuration, and Hopper preparation ownership. [#5772](https://github.com/morluto/rea/pull/5772), [87ab054](https://github.com/morluto/rea/commit/87ab054ea384b3fcbae2998b1f94685edcd5f624), [ff78165](https://github.com/morluto/rea/commit/ff78165978de9dbcf9fa16c2acf74bf85a69dc44), [04ae07a](https://github.com/morluto/rea/commit/04ae07ab8c9ae1a6697b6ad15489bbde515da8b5), [dd0015a](https://github.com/morluto/rea/commit/dd0015aaf156c5701ef9598bcc6c885e6b8da803), [b231c28](https://github.com/morluto/rea/commit/b231c28cf64c2f799ada99343f8f21e0e6acb15e), [#4505](https://github.com/morluto/rea/issues/4505), [#5616](https://github.com/morluto/rea/issues/5616).
- **Provider diagnostics:** Give Ghidra restart recovery, stable Homebrew aliases, unsupported-host results for Linux-only integrations, correct IDA regex/readiness handling, and clear diagnostics when Windows refuses a verified native addon. [#5356](https://github.com/morluto/rea/pull/5356), [7c6142e](https://github.com/morluto/rea/commit/7c6142efdc19a42c148d0e8c96b69d18e63c7f87), [#5793](https://github.com/morluto/rea/pull/5793), [#4862](https://github.com/morluto/rea/pull/4862), [99ccfb6](https://github.com/morluto/rea/commit/99ccfb6e709ac4bc0afe176315280abde9ebcb9f), [#6832](https://github.com/morluto/rea/pull/6832), [#5730](https://github.com/morluto/rea/issues/5730), [#4860](https://github.com/morluto/rea/issues/4860), [#5723](https://github.com/morluto/rea/issues/5723). Thanks @coygeek, @dark13b, @gensokyo-dev, @jgt87, @jpmorris41488, @Lew1sWong.
- **MCP results:** Preserve protocol envelopes on oversized errors, enforce and advertise absolute Evidence paths, retain typed output-filter errors and selected JSON paths, and give client/provider timeout recovery. Compact advertisements now normalize reported enum and union shapes for strict gateway translation. [562dab0](https://github.com/morluto/rea/commit/562dab00c5cbf76a9b2695bad93792eccdc9a49d), [3cf6206](https://github.com/morluto/rea/commit/3cf6206614e65b5ebb6284a5709090dfb8f9aaee), [0e83d92](https://github.com/morluto/rea/commit/0e83d92c583ae36afe00b2c23dd2a0f1d025cbca), [4714c7e](https://github.com/morluto/rea/commit/4714c7eaa3d1d8b6a5df0aff586e844b9d9ab06d), [1bfa60a](https://github.com/morluto/rea/commit/1bfa60ac20e1a344bcf3132c08d15b6860b05c61), [#5608](https://github.com/morluto/rea/pull/5608), [#3806](https://github.com/morluto/rea/pull/3806), [#5598](https://github.com/morluto/rea/issues/5598), [#3800](https://github.com/morluto/rea/issues/3800). Thanks @gensokyo-dev, @Hahaa909, @wang1xiang.
- **Browser lifecycles:** Retain historical outcomes through cleanup, stop late navigation before session release, stop expired work, observe aborted fetch settlement, and mark later scenario actions skipped after failure or cancellation. [2e5171e](https://github.com/morluto/rea/commit/2e5171e391b83f8a467d0861fd452c1f78621fd8), [599fdac](https://github.com/morluto/rea/commit/599fdac029912f96c511f859660483405d2de26f), [b2fad36](https://github.com/morluto/rea/commit/b2fad362f2b37f81dc9a6f784f4521e4ca24d41e), [13a8640](https://github.com/morluto/rea/commit/13a864020414577006dce58d7fdaa877ddd0cb52), [#6023](https://github.com/morluto/rea/pull/6023), [#5943](https://github.com/morluto/rea/issues/5943). Thanks @coygeek, @kaoru0822-kitauji.
- **Browser comparisons:** Preserve frame identity, default origin scope, unknown body/shape coverage, correspondence and uncertainty, and independent retained-observation budgets. [#4040](https://github.com/morluto/rea/pull/4040), [#4413](https://github.com/morluto/rea/pull/4413), [#4476](https://github.com/morluto/rea/pull/4476), [a0c22ff](https://github.com/morluto/rea/commit/a0c22ff0125b8af7612db54d3708413e2bfecb25), [a0fcc60](https://github.com/morluto/rea/commit/a0fcc60d89eb0cc09b08181eb9f961acfd07d8e9), [#3878](https://github.com/morluto/rea/issues/3878), [#3910](https://github.com/morluto/rea/issues/3910), [#3941](https://github.com/morluto/rea/issues/3941), [#4385](https://github.com/morluto/rea/issues/4385), [#4477](https://github.com/morluto/rea/issues/4477). Thanks @Adolanium, @coygeek, @eco-null, @gensokyo-dev, @kaoru0822-kitauji, @XY-code1.
- **Electron observations:** Preserve listener callback ownership and count registrations by source callsite; block trash calls in the active hook, retain window handles through cancelled selection, and preserve cancellation during finalization. [dfe8378](https://github.com/morluto/rea/commit/dfe8378cf5a727e3d93d47a5986233175c6ef898), [5064007](https://github.com/morluto/rea/commit/506400748eb1d6c674f0cf51330073929c45f939), [816a9dc](https://github.com/morluto/rea/commit/816a9dc98886e6d824cd8ae88b68731b161d5dda), [1707d17](https://github.com/morluto/rea/commit/1707d171d750955bf6387e028e378183b360ffe3), [4e2a566](https://github.com/morluto/rea/commit/4e2a566d6c7e053ecbbee1b684311ed31ea163bf).
- **JavaScript source maps:** Keep unmapped and missing mappings unknown, preserve partial indexed-map facts and section paths, propagate preparation capability errors, and retain observed worker failures through cancellation. [a4dbb36](https://github.com/morluto/rea/commit/a4dbb36d8ea83e9f94dd289ac1a2d220d2c72c9b), [2b2e362](https://github.com/morluto/rea/commit/2b2e362a00fc5ba2f93fa6c62e2d8780072d1b4b), [498a667](https://github.com/morluto/rea/commit/498a667234b0140c1cfa43c819b35454ab11d14e), [#6149](https://github.com/morluto/rea/pull/6149), [#6214](https://github.com/morluto/rea/pull/6214), [f01dcca](https://github.com/morluto/rea/commit/f01dccab77f712fb4ac936d0a6e92a70d12f0789), [#6082](https://github.com/morluto/rea/issues/6082), [#6061](https://github.com/morluto/rea/issues/6061). Thanks @coygeek, @diyasharma05, @kaoru0822-kitauji.
- **JavaScript semantics:** Preserve overflowing timer uncertainty, unavailable-scope comparisons, directory-form URL/ESM path intent, and artifact confinement. Replaced globals lose built-in effects; erased imports no longer become runtime bindings. Treat a known truthy `fork()` `silent` option as piped stdio unless a string/array `stdio` override takes precedence; unresolved options stay dynamic. [#3456](https://github.com/morluto/rea/pull/3456), [8d198d6](https://github.com/morluto/rea/commit/8d198d6ec707402d75276f516e0090d71767b7e4), [#4646](https://github.com/morluto/rea/pull/4646), [#2700](https://github.com/morluto/rea/pull/2700), [#4565](https://github.com/morluto/rea/pull/4565), [#6994](https://github.com/morluto/rea/pull/6994), [#3400](https://github.com/morluto/rea/issues/3400), [#3882](https://github.com/morluto/rea/issues/3882), [#3367](https://github.com/morluto/rea/issues/3367), [#7083](https://github.com/morluto/rea/pull/7083), [#7084](https://github.com/morluto/rea/issues/7084). Thanks @Adolanium, @amyanger, @coygeek, @gensokyo-dev, @HawkForge, @rohitg00, @viniciusdsandrade.
- **JavaScript routes and imports:** Treat path data as route candidates, preserve route flag and lexical RPC identities, package-main trailing-slash selection, catch aliases, and factory parameter ownership. [#6360](https://github.com/morluto/rea/pull/6360), [38ecc02](https://github.com/morluto/rea/commit/38ecc0248e1993d25a2f7dd350024484cce797bb), [#4219](https://github.com/morluto/rea/pull/4219), [21097b1](https://github.com/morluto/rea/commit/21097b192b1ab94647e3446b1a2a4dd00e924d5e), [f774dc4](https://github.com/morluto/rea/commit/f774dc420b3befe2b8e68971b4116da2d62fc800), [#6349](https://github.com/morluto/rea/issues/6349), [#4189](https://github.com/morluto/rea/issues/4189). Thanks @coygeek, @hemv-857, @kaoru0822-kitauji, @Nikhi00718.
- **Managed/IL2CPP:** Preserve extension-only scope uncertainty and type discovery after member limits, nested names, ReadyToRun/declaration facts, selected type scope, valid shared-suffix strings, and truncated IL2CPP metadata prefixes. [#5674](https://github.com/morluto/rea/pull/5674), [#5312](https://github.com/morluto/rea/pull/5312), [87fa1b6](https://github.com/morluto/rea/commit/87fa1b613d2b6bda1722855a00f1390f27731b64), [bc2d494](https://github.com/morluto/rea/commit/bc2d494030efd1ccabaeaa0bd49226aa87c378a2), [1f0eb22](https://github.com/morluto/rea/commit/1f0eb228e50908ee2a2aaa72d329178ae1a2cdbd), [4c5fae5](https://github.com/morluto/rea/commit/4c5fae5179dd54c4a0d427cd2a115b9c887e3841), [b3aadaf](https://github.com/morluto/rea/commit/b3aadaf474e59b33e5ff465236008a67eccefb87), [#5467](https://github.com/morluto/rea/issues/5467), [#5146](https://github.com/morluto/rea/issues/5146). Thanks @coygeek, @eco-null, @elricfd, @umi008.
- **Format boundaries:** Preserve independent facts across malformed inputs in model, GPU, WASM, Rust, Android, and SQLite inspection; report optional metadata warnings without discarding core results. [eb41f35](https://github.com/morluto/rea/commit/eb41f358cf83d5626f09de68332f9718f9aa6482), [#5789](https://github.com/morluto/rea/pull/5789), [00a9e95](https://github.com/morluto/rea/commit/00a9e95de91a4bd4d2a41f8aee704a53fa575750), [fc63fe8](https://github.com/morluto/rea/commit/fc63fe8682654086261540dcf3c59afc36c7d58f), [39a91d4](https://github.com/morluto/rea/commit/39a91d4db96ca13224c25936330ea84fe78970e5), [6c6e2ad](https://github.com/morluto/rea/commit/6c6e2ad62b20f810b54f5a567e66fc55241514b2), [929a0a7](https://github.com/morluto/rea/commit/929a0a76c870d9991e015dde58308fd9df0280b8), [d137a4c](https://github.com/morluto/rea/commit/d137a4cdde0049de967f1d5cd429ed9e1f7d0a10), [ef475fc](https://github.com/morluto/rea/commit/ef475fcf8b0601c61052b7091568ba574546417d), [#5749](https://github.com/morluto/rea/issues/5749). Thanks @coygeek, @gensokyo-dev.
- **Capture decoding:** Preserve malformed protobuf trailer facts and wire/schema identity, HTTP/2 URI and UTF-8 failure facts, WebMCP property coverage, and offline capture availability without a browser provider. Report invalid record ordinals as selection errors with actual bounds where available, and trim surrounding SP/HTAB from gRPC-web trailer values while preserving internal whitespace. [9cf7a7c](https://github.com/morluto/rea/commit/9cf7a7cb0d3c72a1121fde280cb11bf911af8055), [b3c3b21](https://github.com/morluto/rea/commit/b3c3b21e43cab4e71b460d08829d8c6e4e9b9c21), [4cb1f1d](https://github.com/morluto/rea/commit/4cb1f1d820df4498ee464bcf72a5f47d40cf8dab), [51e5938](https://github.com/morluto/rea/commit/51e593877642ab42fb5bf25812f4a4110ee7ac26), [d23be5c](https://github.com/morluto/rea/commit/d23be5c0898c39c9f0c54e2e0b43ee746d92d316), [#6725](https://github.com/morluto/rea/pull/6725), [#3947](https://github.com/morluto/rea/issues/3947), [#7067](https://github.com/morluto/rea/pull/7067), [#7068](https://github.com/morluto/rea/issues/7068), [#7069](https://github.com/morluto/rea/pull/7069), [#7071](https://github.com/morluto/rea/issues/7071). Thanks @Adolanium, @coygeek, @Sriram-PR.
- **Evidence and errors:** Authenticate ledger Evidence before committing; preserve parent-schema diagnostics, canonical correction details and owned cleanup outcomes; identify the rejected function-Evidence side/kind. Fixed allowances now name their actual limits. [0407bbf](https://github.com/morluto/rea/commit/0407bbfbe65e8fa475e8bb0c78c30170e2c2f55e), [#6361](https://github.com/morluto/rea/pull/6361), [1629266](https://github.com/morluto/rea/commit/1629266e3c08c90fed6bba5383528af7986a12b7), [#6969](https://github.com/morluto/rea/pull/6969), [#5860](https://github.com/morluto/rea/pull/5860), [#6034](https://github.com/morluto/rea/issues/6034), [#5932](https://github.com/morluto/rea/issues/5932), [#5847](https://github.com/morluto/rea/issues/5847). Thanks @AyoubElleuch, @coygeek, @dhruvac29, @kaoru0822-kitauji.
- **ADB and firmware recovery:** Report an unparsed push checksum as unverified, normalize absent installer-package sentinels, describe extraction-relative Unblob links, and avoid recommending a budget increase at its fixed ceiling. [#6010](https://github.com/morluto/rea/pull/6010), [#4073](https://github.com/morluto/rea/pull/4073), [#4573](https://github.com/morluto/rea/pull/4573), [#6971](https://github.com/morluto/rea/pull/6971), [#5924](https://github.com/morluto/rea/issues/5924), [#4175](https://github.com/morluto/rea/issues/4175). Thanks @coygeek, @Ganesh2325, @kaoru0822-kitauji, @Rinkia, @XiaoBinGan, @yankikucuk.
- **CLI formatting:** Share Markdown report formatting, exclude inherited row values, and preserve arrays of empty objects as JSON. Render Markdown table headers and cells literally while keeping intraword underscores readable. [b784912](https://github.com/morluto/rea/commit/b784912811fd10ac9dc425696dc0e9af632afa34), [#6984](https://github.com/morluto/rea/pull/6984), [#7058](https://github.com/morluto/rea/pull/7058), [#7057](https://github.com/morluto/rea/issues/7057), [#7073](https://github.com/morluto/rea/pull/7073). Thanks @Plastic-time, @ShuaixinHuang, @viniciusdsandrade.
- **Format identity:** Preserve Python marshal scalar/decode limits, empty optional BEAM chunks, PE resource branch identities and certificate alignment, unsupported compressed ELF notes, and codec-framed GPU bundle extents. [0603223](https://github.com/morluto/rea/commit/06032237c6755e3dd5f9a8db732c89958b238cc7), [c46064c](https://github.com/morluto/rea/commit/c46064c3f6eaba121c5de7b17390bfdecdd132ef), [66671e8](https://github.com/morluto/rea/commit/66671e874888e98f7e2b27e68a7c6fb320bbb827), [03077d5](https://github.com/morluto/rea/commit/03077d54afc49613db4e38f70c506bc60f5223aa), [#6721](https://github.com/morluto/rea/pull/6721), [9fb8c11](https://github.com/morluto/rea/commit/9fb8c114a03ad60e57c11586967c6df845a3f97e), [f6a1e2c](https://github.com/morluto/rea/commit/f6a1e2c892dc23c7583c3d03af9edb01632ff5a5), [#6694](https://github.com/morluto/rea/issues/6694). Thanks @coygeek, @Deepak-Kambala.
- **WASM and APK metadata:** Preserve ambiguous WASM identity and partial facts, glue URL query/fragment text across line terminators, APK signer identity, and raw issuer identity when comparison rules are unknown. [af8f0ba](https://github.com/morluto/rea/commit/af8f0badf64fd3546392b6aa4625777904b2f051), [#6802](https://github.com/morluto/rea/pull/6802), [f783f0f](https://github.com/morluto/rea/commit/f783f0f1e82472cdddd4de2156d974f729e332a6), [115a78f](https://github.com/morluto/rea/commit/115a78fe241276c34917b496621954c5f29bfc15), [#6639](https://github.com/morluto/rea/issues/6639). Thanks @coygeek, @gensokyo-dev, @gongfpp.
- **Source identity:** Preserve Next route spelling, module grammar and loader request identity, directory package-main behavior, accessor effects, exact source targets, and resolver-discovery versus module-loading distinctions. [ddd7ac7](https://github.com/morluto/rea/commit/ddd7ac7b846b48191ead1f7dcd0e3bd735468fa8), [9974512](https://github.com/morluto/rea/commit/99745126009b15060d71c38809418858a07d5afa), [f2e5fd1](https://github.com/morluto/rea/commit/f2e5fd148a85fa737302dd194a33172c4561093e), [baf1678](https://github.com/morluto/rea/commit/baf16784af3592534687052431c145daef55cfd1), [6e324b2](https://github.com/morluto/rea/commit/6e324b224405f2befd953234f6dc210cf72ad50a), [75daf0c](https://github.com/morluto/rea/commit/75daf0c7df108f04ab41f34aec1a31d4a7ceb322), [f91b7f8](https://github.com/morluto/rea/commit/f91b7f8009c9af27a5e0148e3b07d20bfe3b7a2a).
- **Graphs and selected facts:** Preserve JavaScript graph omissions/version facts, Electron native-loader facts, web JSON identity/coverage, module-path selection, feature-trace qualifications, selected native paths, endpoint context, and mixed Swift demangler outcomes. [30db499](https://github.com/morluto/rea/commit/30db499db310f073d9bf3d3acfd77985e1cb7e2e), [5a7bddb](https://github.com/morluto/rea/commit/5a7bddb3aeb0345854e76b79d529aed1c40e2054), [79805f2](https://github.com/morluto/rea/commit/79805f244a1ec0850f3109929168a9c8ebb1b908), [f719dc4](https://github.com/morluto/rea/commit/f719dc46c51a55b3926eec9659d06e7dfb95132b), [7784fdb](https://github.com/morluto/rea/commit/7784fdbad78f8b384d513f0e7dae8e983cd48ef8), [76500f1](https://github.com/morluto/rea/commit/76500f12b54e07b1ea700a403b2593890d63b42a), [676d29f](https://github.com/morluto/rea/commit/676d29f9eef794cea668f5f09f0ff510c848a513), [edf7b3d](https://github.com/morluto/rea/commit/edf7b3d32c3248f221e27f7ce5a3d34e8590285b), [93de7bc](https://github.com/morluto/rea/commit/93de7bc7e324a761162a31625b838ba0d4e3824d).
- **Managed boundaries:** Honor native platform symbol lookup, consume resolved IL2CPP ELF declarations, and attribute malformed comparison inputs to the supplied argument. [64fa1db](https://github.com/morluto/rea/commit/64fa1db1309218283df19f3ee4dba61f5fbd2a67), [87745af](https://github.com/morluto/rea/commit/87745af52ab0ccd3a172c2534c516d41b0095035), [96ad94f](https://github.com/morluto/rea/commit/96ad94f69eda5d68c7335ff775b6927b1376fd2b).
- **Provider and worker recovery:** Preserve output loss after successful command exit, physical refusal diagnostics, bounded worker control framing, JavaScript worker-phase/budget attribution, admitted ambiguity choices, and selected EVM limiter availability. Scope objdump debug-link limitations to DWARF requests and keep process-capture preparation nonexecuting. [e639edf](https://github.com/morluto/rea/commit/e639edf6204c05285d96840478926592daf95876), [171b33b](https://github.com/morluto/rea/commit/171b33b2c4defc6cbea49545bedf4272b72d1ea2), [34563fc](https://github.com/morluto/rea/commit/34563fcc9bd92af30668820dcac5635e27181094), [3f9357b](https://github.com/morluto/rea/commit/3f9357b5990d166a38440f56f439452266650093), [cec8f1e](https://github.com/morluto/rea/commit/cec8f1e8f305d6332272457a6ee419d3c5fb6359), [a74d859](https://github.com/morluto/rea/commit/a74d859a19122fb8f1282b3632d320997b1caae0), [c284168](https://github.com/morluto/rea/commit/c284168c4b1cd214ce7f504d43da28528d82d603), [4fb936f](https://github.com/morluto/rea/commit/4fb936fe86bb7a07f94f819ae8510301f2ef69c9).
- **Setup and limits:** Retain unknown environment-budget facts, selected-skill/maintenance uncertainty, Hopper URL admission and bookmark verification, and listener failure recovery that matches the system cause. [a718037](https://github.com/morluto/rea/commit/a7180370332350bc0f998fbd643888221759570e), [d1fbebb](https://github.com/morluto/rea/commit/d1fbebb578538dc94fd5e376e6e1959218efa835), [60accad](https://github.com/morluto/rea/commit/60accad2de8f2862fe91901502fe26cc5390fb36), [fd7da77](https://github.com/morluto/rea/commit/fd7da77fc02dcfaf7d1bc9f2fb240d71cdd27c59), [0c440bf](https://github.com/morluto/rea/commit/0c440bfc07f3cb343e2e836d27cccaed539cfe9c).
- **State and Evidence:** Retain export tarball ownership and SQLite primary outcomes through cleanup retry, count emitted SQLite schema names across encodings, scope display refresh to matching snapshot bindings, and report retained-result validation failures consistently. Reconstruction uses one effective completion scope and kind-based labels when names are blank. [ab58edc](https://github.com/morluto/rea/commit/ab58edcdf50b4bd687900ee2dc362ecc5c3dce15), [1006714](https://github.com/morluto/rea/commit/100671427105791a5c5913a918b63a394f6bc83e), [a47788a](https://github.com/morluto/rea/commit/a47788a6a4abb067273f954275a9d0a269adf1e7), [8aa40e9](https://github.com/morluto/rea/commit/8aa40e9a61155cff8b6f3c138c601bf805b20653), [b8c1b45](https://github.com/morluto/rea/commit/b8c1b45316882beeab4a9de49381d94e131fab0f), [a35b933](https://github.com/morluto/rea/commit/a35b9335a0124674ee5e3abe8c075f1fff6b4fa6), [#6137](https://github.com/morluto/rea/pull/6137), [#6126](https://github.com/morluto/rea/issues/6126). Thanks @carlogiovannineri-rgb, @mohithhhh.
- **Capture coverage:** Name browser bundle budgets and deadline recovery, separate domain readiness from worker attribution, attribute rendered-frame omissions to their producing stage, share offline-capture host admission with discovery, preserve selected signal-file semantics, and retain short Flutter GNU build IDs. [#6036](https://github.com/morluto/rea/pull/6036), [ba78133](https://github.com/morluto/rea/commit/ba781330d6d28b22d15498e63c144fb40e086156), [5934387](https://github.com/morluto/rea/commit/5934387f4185129efe9dc8b7338d8bc3fa5b25bd), [ad629b2](https://github.com/morluto/rea/commit/ad629b2e31c3a9495b27179360b508fa021fe86a), [928ba76](https://github.com/morluto/rea/commit/928ba76882bfd216dde8ed79118789b2c3aad4f9), [678c4cf](https://github.com/morluto/rea/commit/678c4cfa68e2fee12f620075e12dc87d9b1195b0).
- **Additional boundary facts:** Retain parser format/query occurrence identity and independent malformed-input facts, unresolved nested Swift identifiers, and completed signing-capture coverage; describe crash documents without assuming a provider. [5f702dd](https://github.com/morluto/rea/commit/5f702dd6ccd9e8e505e224854b91678439c3b41f), [99d2d7a](https://github.com/morluto/rea/commit/99d2d7ad22bcbd780919760008aba6a88e7d1077), [90e433d](https://github.com/morluto/rea/commit/90e433df06b3f83417176b8db1b0a905f9df1d3a), [#5548](https://github.com/morluto/rea/pull/5548), [ee12d51](https://github.com/morluto/rea/commit/ee12d517a25d34853d40e31fc039c7d1576c60e1), [#5538](https://github.com/morluto/rea/issues/5538). Thanks @coygeek, @ShuaixinHuang.
- **Documentation:** Add the Romanian README. [#7026](https://github.com/morluto/rea/pull/7026). Thanks @An3treiu.

Full contribution record: [1740 commits and 497 merged PRs](https://github.com/morluto/rea/blob/rea-agents-6.8.0/docs/releases/6.8.0.contributions.json).

## [6.7.0](https://github.com/morluto/rea/compare/rea-agents-6.6.0...rea-agents-6.7.0) (2026-10-18)

### Highlights

- Client configuration edits follow the duplicate-member semantics used by MCP clients.

### Changes

- Includes the [6.6.0 changes and migration notes](https://github.com/morluto/rea/releases/tag/rea-agents-6.6.0). That version was tagged but was not published to npm.

### Fixes

- **Client configuration:** Setup edits the last repeated JSON/JSONC member, matching the value clients actually read. Setup and uninstall refuse a removal that would reactivate a shadowed duplicate, preserving the original configuration. ([#4957](https://github.com/morluto/rea/pull/4957), [morluto/rea#4952](https://github.com/morluto/rea/issues/4952)). Thanks @kaoru0822-kitauji, @xu91102.

Full contribution record: [4 commits and 1 merged PR](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/releases/6.7.0.contributions.json).

## [6.6.0](https://github.com/morluto/rea/compare/rea-agents-6.5.0...rea-agents-6.6.0) (2026-10-18)

### Highlights

- Add Kuna as a caller-supplied static-analysis provider.
- Query selected JavaScript facts and multiple APK locale tables without repeating the underlying analysis.
- Extend Ghidra analysis to Windows ARM PE targets and explicit raw m68k images.
- Preserve completed Evidence, cancellation reasons and retryable cleanup across provider and CLI finalization.

### Changes

- **Kuna analysis:** Use a caller-installed Kuna for procedure listings, pseudocode, assembly, call relationships, exact-address xrefs and cached string searches. Project exports retain source spans and digests; repeated requests reuse completed work. Recorded real-provider coverage uses Kuna 1.833 on Linux; Windows, PE and universal Mach-O are unsupported. See [the provider guide](docs/kuna-provider.md). ([#3832](https://github.com/morluto/rea/pull/3832), [#3854](https://github.com/morluto/rea/pull/3854), [#4071](https://github.com/morluto/rea/pull/4071), [#4095](https://github.com/morluto/rea/pull/4095)). Thanks @gensokyo-dev, @kaoru0822-kitauji, @N0zoM1z0.
- **Retained JavaScript facts:** Query exact application paths, selected properties and filtered module references through `inspect_analysis_view`, with paging and complete row Evidence. These views reuse completed analysis and preserve source selection and unknown coverage. ([#4265](https://github.com/morluto/rea/pull/4265), [morluto/rea#4190](https://github.com/morluto/rea/issues/4190), [#4097](https://github.com/morluto/rea/pull/4097), [morluto/rea#4092](https://github.com/morluto/rea/issues/4092)). Thanks @kaoru0822-kitauji, @N0zoM1z0.
- **APK locale tables:** Request several resource locales in one decode with repeatable CLI `--locales` or MCP `locales`. Each table reports its status and coverage; existing single-locale fields remain available. ([#4804](https://github.com/morluto/rea/pull/4804), [morluto/rea#4777](https://github.com/morluto/rea/issues/4777)). Thanks @abhay-2108, @N0zoM1z0.
- **Windows ARM binaries:** Ghidra admits ARMNT/Thumb-2 and ARM64 PE applications and DLLs on the Windows x64 host lane. Recorded Ghidra 12.1.4 verification uses `WindowsResourceReference` disabled and raised startup budgets; default-analyzer completion, ARM64EC/ARM64X and Windows-on-Arm hosts remain unverified or unsupported. See [the exact scope](docs/windows-ghidra-p0.md#native-authority-and-target-identity). ([#3965](https://github.com/morluto/rea/pull/3965), [morluto/rea#2186](https://github.com/morluto/rea/issues/2186)). Thanks @N0zoM1z0, @WestLabsAI.
- **Raw m68k images:** Analyze explicitly selected big-endian m68k raw binaries using Ghidra’s fixed 68000 profile and a caller-supplied aligned entry. Real CLI/MCP verification used Ghidra 12.1.4 on macOS arm64; Linux is unverified and Windows P0 does not admit m68k. See [mapping requirements](docs/raw-binary.md). ([#4018](https://github.com/morluto/rea/pull/4018)). Thanks @icedac.
- **JADX deadlines:** Set `REA_JADX_OPERATION_TIMEOUT_MS` to extend APK loading and upstream operation deadlines together. Doctor reports the effective value and setup forwards an explicit selection. ([#4466](https://github.com/morluto/rea/pull/4466), [morluto/rea#3918](https://github.com/morluto/rea/issues/3918)). Thanks @jaychou813, @SandstromPL.
- **Electron window options:** Resolve stable local constant `BrowserWindow` options while retaining source provenance. Relevant writes and escapes keep the result unknown. ([#4400](https://github.com/morluto/rea/pull/4400), [morluto/rea#4366](https://github.com/morluto/rea/issues/4366)). Thanks @kaoru0822-kitauji, @N0zoM1z0.
- **Language editions:** Add the Greek website edition and Malayalam documentation, with Korean typography and translation corrections across the site. ([#3520](https://github.com/morluto/rea/pull/3520), [#4792](https://github.com/morluto/rea/pull/4792), [#3821](https://github.com/morluto/rea/pull/3821), [morluto/rea#3820](https://github.com/morluto/rea/issues/3820), [#3799](https://github.com/morluto/rea/pull/3799), [morluto/rea#3798](https://github.com/morluto/rea/issues/3798), [#4344](https://github.com/morluto/rea/pull/4344), [#3856](https://github.com/morluto/rea/pull/3856), [#4166](https://github.com/morluto/rea/pull/4166)). Thanks @gensokyo-dev, @hi2242, @kalayciburak, @kaoru0822-kitauji, @kraken-503, @kukinghan, @N0zoM1z0, @yeseong0412.

### Fixes

- **Cancellation and cleanup:** Keep completed observations, exact cancellation reasons and the original physical failure through finalization. Failed cleanup retains its process or file owner for retry; recovered resources disappear from pending-cleanup reports without replacing the original error. ([#4238](https://github.com/morluto/rea/pull/4238), [morluto/rea#4232](https://github.com/morluto/rea/issues/4232), [#4274](https://github.com/morluto/rea/pull/4274), [morluto/rea#3923](https://github.com/morluto/rea/issues/3923), [3e82366](https://github.com/morluto/rea/commit/3e8236639abffa39deb5d5e939ec8baf6aaf3ca3), [16924e2](https://github.com/morluto/rea/commit/16924e275e939d0543ba01493324959a9e1d731c), [bbfe6ed](https://github.com/morluto/rea/commit/bbfe6edd60290f9bfbec68c8a0bcf605d8bbf5b3), [1f23e97](https://github.com/morluto/rea/commit/1f23e977b50301e91f02a4a17c9f8d48bb7b60f3), [08fbeb8](https://github.com/morluto/rea/commit/08fbeb8bdab27118b6c57039aef7c0fa8b6463bc)). Thanks @coygeek.
- **Provider startup:** Join prerequisite probes and in-flight readiness work before shutdown, preserve typed timeout and JVM-memory failures, and retain startup diagnostics through cleanup. Ghidra recognizes keg-only Homebrew JDKs and names the setting responsible for a startup timeout. ([376eeca](https://github.com/morluto/rea/commit/376eeca770820b31f7f8d4c5fcc397315621643e), [ceeff5a](https://github.com/morluto/rea/commit/ceeff5a41788e47e5aee96a4baf191a6ce7fde4b), [3ad1032](https://github.com/morluto/rea/commit/3ad1032b11edea2dcb054e78f951cc43159ae83d), [964decd](https://github.com/morluto/rea/commit/964decd989acfa84c4bfc3295362c4c46877fc20), [3fa972a](https://github.com/morluto/rea/commit/3fa972af7c7cb6cf014ffc426bdf7130dc6f2fd2), [#4557](https://github.com/morluto/rea/pull/4557), [morluto/rea#4556](https://github.com/morluto/rea/issues/4556), [#4590](https://github.com/morluto/rea/pull/4590), [morluto/rea#4241](https://github.com/morluto/rea/issues/4241)). Thanks @DanielCvz1, @J0UH, @Rinkia, @RishTheFish21, @vadlachary2002.
- **Client configuration:** Preserve the selected launcher, destination file, caller timeout choices and unresolved configuration evidence. Setup/uninstall recovery stays bound to the exact published file, keeps current verified backups, and transfers failed cleanup ownership for retry. ([d0253c9](https://github.com/morluto/rea/commit/d0253c99d65afbbd12732a2fdaf711640574e17f), [7e4eed9](https://github.com/morluto/rea/commit/7e4eed9dd48485b6a7100300aa98401811c2deb9), [2fb5e20](https://github.com/morluto/rea/commit/2fb5e204a35723f6f843d56ca47b0db94d8fcc44), [8235210](https://github.com/morluto/rea/commit/823521085a28f825e7fee1929d852d420042d1f7), [d818c3d](https://github.com/morluto/rea/commit/d818c3d2639d3115edb8a5269a754101aea6c3bd), [19329e4](https://github.com/morluto/rea/commit/19329e43bb38ca9d64512d801b25abcb188d2512), [dadf909](https://github.com/morluto/rea/commit/dadf909dce2e8b3d055541de69b4118d21276316), [333e0ab](https://github.com/morluto/rea/commit/333e0ab0dfc126a9915907d5079ed6195190e38e), [c15c206](https://github.com/morluto/rea/commit/c15c2062ad815cc9a3222ccfaeb7ef53cacd8b72)). Thanks @Adolanium.
- **Configuration formats:** Read signed 64-bit TOML integers without rounding, handle large TOML documents without argument-spread failures, preserve JSONC trivia and Hermes YAML scalar text, and reject NUL bytes in registration environment values. ([#4937](https://github.com/morluto/rea/pull/4937), [morluto/rea#4917](https://github.com/morluto/rea/issues/4917), [c43bc0b](https://github.com/morluto/rea/commit/c43bc0bf66a4e245a0cafa40def0d0207bcbd73c), [4fd28fc](https://github.com/morluto/rea/commit/4fd28fc9e0c4f8358147af38c72ab9e814f52d61), [#3568](https://github.com/morluto/rea/pull/3568), [#4335](https://github.com/morluto/rea/pull/4335)). Thanks @alfredo1491, @gensokyo-dev, @kaoru0822-kitauji, @N0zoM1z0, @ShuaixinHuang, @xu91102.
- **Claude Code configuration:** Setup, doctor and uninstall now accept only the strict JSON format Claude Code reads, including a leading UTF-8 BOM. Comments and trailing commas are refused before backup or writing; clients that support JSONC retain their existing behavior. ([#4944](https://github.com/morluto/rea/pull/4944), [morluto/rea#4940](https://github.com/morluto/rea/issues/4940)). Thanks @kaoru0822-kitauji, @xu91102.
- **CLI output and dispatch:** Accept `--flag=value` and spaced global output values, keep array positions in filtered JSON, validate integer tokens before coercion, and exit quietly when the output reader closes. Cancellation remains effective through command finalization; app bundles and static native inspections select the intended workflow. ([#3811](https://github.com/morluto/rea/pull/3811), [#4823](https://github.com/morluto/rea/pull/4823), [2ae4e16](https://github.com/morluto/rea/commit/2ae4e1608f290c95ff7cff28c4d16a79b301d03d), [8d82579](https://github.com/morluto/rea/commit/8d8257928bbe8d43fedffc4db5fca26c8108820f), [#3781](https://github.com/morluto/rea/pull/3781), [279c590](https://github.com/morluto/rea/commit/279c590ef6bb737d4a48ea696a0ae5eb30010b3d), [#3511](https://github.com/morluto/rea/pull/3511), [morluto/rea#3321](https://github.com/morluto/rea/issues/3321), [f31b231](https://github.com/morluto/rea/commit/f31b231a92a61be6bd1800b16be0b3210ae82944)). Thanks @arjunprabhulal, @coygeek, @kaoru0822-kitauji, @ShuaixinHuang, @Sriram-PR, @Tapraj-Pathak.
- **Updates:** Route `--update` through the verified updater and bound retained package-manager diagnostics. ([4f7b5fb](https://github.com/morluto/rea/commit/4f7b5fb6023ce2ec449561782d09e3c7e5ac7c7b), [01cdbbd](https://github.com/morluto/rea/commit/01cdbbdc556262c47d04a5b3391dd9c17946d3fc)).
- **MCP contracts:** Advertise self-contained tool inputs while preserving tuple, array, Boolean and nested-JSON constraints across schema profiles. Schema-reference handling no longer rewrites literal metadata; catalog identity includes the output-schema profile. ([5e30969](https://github.com/morluto/rea/commit/5e30969cc5f1255d44ec7a1f1ca8dbac0af5e7c4), [10aa74d](https://github.com/morluto/rea/commit/10aa74dfedc3ae776f50d1fa1eb83b64ae82d3d6), [204b9f3](https://github.com/morluto/rea/commit/204b9f3ac140a993c3e458bb0e117de31818ab29), [b3389a5](https://github.com/morluto/rea/commit/b3389a5b0834265fe7a40391be315d810a53a97e), [a2e3016](https://github.com/morluto/rea/commit/a2e30168a046f3b79319eb7fbaf807b802104199), [ba98130](https://github.com/morluto/rea/commit/ba98130049fa40ade66b03611ff70c7ddc011a1d), [c5fb86d](https://github.com/morluto/rea/commit/c5fb86d1948af0a287a581b29b2b1d554743c607)). Thanks @akushonkamen, @HarsH-1877, @kaoru0822-kitauji, @xingzihai.
- **Session ordering:** Keep snapshot admission ahead of later calls on the same connection, retain shutdown signals until cleanup succeeds, and preserve inspection authority through investigation publication. ([#3661](https://github.com/morluto/rea/pull/3661), [morluto/rea#3334](https://github.com/morluto/rea/issues/3334), [8873b39](https://github.com/morluto/rea/commit/8873b39770e89eae22b7693bc492d7e423b22bea), [663d07f](https://github.com/morluto/rea/commit/663d07f02cd62c99d81c59391d2c6d745c875335)). Thanks @coygeek, @rudycelekli, @Swatantra-66.
- **JavaScript exports and resolution:** Retain CommonJS exports created with `Object.defineProperty` and track export receiver lifetimes. Resolve scoped packages, package `main`, JSON requires and `.mts`/`.cts` imports using the owning loader; overwritten `require` bindings and erased type-only imports no longer create false runtime links. ([#4725](https://github.com/morluto/rea/pull/4725), [morluto/rea#4724](https://github.com/morluto/rea/issues/4724), [#3567](https://github.com/morluto/rea/pull/3567), [morluto/rea#3541](https://github.com/morluto/rea/issues/3541), [#4838](https://github.com/morluto/rea/pull/4838), [morluto/rea#4632](https://github.com/morluto/rea/issues/4632), [#3844](https://github.com/morluto/rea/pull/3844), [morluto/rea#3383](https://github.com/morluto/rea/issues/3383), [#4164](https://github.com/morluto/rea/pull/4164), [morluto/rea#3915](https://github.com/morluto/rea/issues/3915), [#4223](https://github.com/morluto/rea/pull/4223), [#3801](https://github.com/morluto/rea/pull/3801), [morluto/rea#3393](https://github.com/morluto/rea/issues/3393), [#4165](https://github.com/morluto/rea/pull/4165), [morluto/rea#3932](https://github.com/morluto/rea/issues/3932)). Thanks @Abishek0070, @coygeek, @JNTMTMTM, @kaoru0822-kitauji, @prasad2512, @rodricksz4h5, @xu91102.
- **JavaScript value flow:** Preserve values captured before later assignments, guarded factory fallthrough and nested destructuring. Track exact property keys and setter writes; direct `eval`, compound assignments and incoming callbacks preserve unresolved effects instead of inventing certainty. ([#4196](https://github.com/morluto/rea/pull/4196), [morluto/rea#3881](https://github.com/morluto/rea/issues/3881), [#4341](https://github.com/morluto/rea/pull/4341), [morluto/rea#3963](https://github.com/morluto/rea/issues/3963), [bfb7ed0](https://github.com/morluto/rea/commit/bfb7ed0bd43edc605e00fc52c6e21e735b285904), [#3480](https://github.com/morluto/rea/pull/3480), [#3831](https://github.com/morluto/rea/pull/3831), [morluto/rea#3312](https://github.com/morluto/rea/issues/3312), [9ac76d3](https://github.com/morluto/rea/commit/9ac76d3d9486856d25395b413d7ac5ffa744cad0), [#4342](https://github.com/morluto/rea/pull/4342), [morluto/rea#4206](https://github.com/morluto/rea/issues/4206), [#4243](https://github.com/morluto/rea/pull/4243), [morluto/rea#3880](https://github.com/morluto/rea/issues/3880)). Thanks @coygeek, @kaoru0822-kitauji, @maxazure, @N0zoM1z0, @ShuaixinHuang.
- **JavaScript relationships:** Distinguish `Map` reads from network endpoints, associate response endpoints only with writes that reach the read, and preserve child-process receiver ownership and effective stdio choices. Version comparisons keep relocation and unknown relationships distinct from application changes. ([fbfdb6a](https://github.com/morluto/rea/commit/fbfdb6abe9d663be0be146a15a489e33ccba0f68), [#4759](https://github.com/morluto/rea/pull/4759), [morluto/rea#4606](https://github.com/morluto/rea/issues/4606), [#3819](https://github.com/morluto/rea/pull/3819), [morluto/rea#3362](https://github.com/morluto/rea/issues/3362), [#4336](https://github.com/morluto/rea/pull/4336), [morluto/rea#3355](https://github.com/morluto/rea/issues/3355), [556504e](https://github.com/morluto/rea/commit/556504edcbb0f8cd9eaf81a91b18ff891b8f5457), [4d980d0](https://github.com/morluto/rea/commit/4d980d017622d3175d86aaf3b0dcfbdf4ca3d091)). Thanks @Abdooo2235, @coygeek, @kaoru0822-kitauji, @Xinglan233.
- **JavaScript source admission:** Parse JavaScript with its own grammar, refuse FIFO recovery inputs without blocking, and report oversized or resource-skipped files with their actual capacity and coverage state. Malformed runtime events stay excluded rather than becoming policy-filtered facts. ([#3782](https://github.com/morluto/rea/pull/3782), [morluto/rea#3780](https://github.com/morluto/rea/issues/3780), [#3788](https://github.com/morluto/rea/pull/3788), [morluto/rea#3332](https://github.com/morluto/rea/issues/3332), [#4757](https://github.com/morluto/rea/pull/4757), [morluto/rea#4629](https://github.com/morluto/rea/issues/4629), [#3852](https://github.com/morluto/rea/pull/3852), [morluto/rea#3670](https://github.com/morluto/rea/issues/3670), [#4755](https://github.com/morluto/rea/pull/4755), [morluto/rea#4685](https://github.com/morluto/rea/issues/4685)). Thanks @andresaragon, @coygeek, @kaoru0822-kitauji, @sx4im.
- **Browser capture:** Bound CDP handshakes and command responses, preserve malformed inventory uncertainty and partial cleanup diagnostics, and report cancellation after content reads and final cleanup. Accessibility comparisons require observed coverage; attached emulation teardown limits remain explicit. ([#3555](https://github.com/morluto/rea/pull/3555), [morluto/rea#3553](https://github.com/morluto/rea/issues/3553), [#3901](https://github.com/morluto/rea/pull/3901), [morluto/rea#3379](https://github.com/morluto/rea/issues/3379), [4cc044b](https://github.com/morluto/rea/commit/4cc044be68f813e96907e6cedcf422d0a3170de3), [#4406](https://github.com/morluto/rea/pull/4406), [morluto/rea#4403](https://github.com/morluto/rea/issues/4403), [#2893](https://github.com/morluto/rea/pull/2893), [0123d59](https://github.com/morluto/rea/commit/0123d5976828bfe621bd51daa4cf39fee48a1349), [2ff0867](https://github.com/morluto/rea/commit/2ff086796ad7b8f60397956750584e170dbe2910)). Thanks @coygeek, @dakjdakd, @kaoru0822-kitauji, @maxazure, @N0zoM1z0, @YunzhouLi-hub.
- **Browser page facts:** Preserve URL path bytes when removing credentials, repeated document `Link` headers and complete COOP/COEP structured items. WebMCP discovery reads the actual schema properties and exact receiver path. ([#4731](https://github.com/morluto/rea/pull/4731), [df2fc25](https://github.com/morluto/rea/commit/df2fc251e318a1255309dba232f9f73c700777b6), [c360cfc](https://github.com/morluto/rea/commit/c360cfcd6d7901514b16dd6113eba2e0b0fdf422), [ebd5a82](https://github.com/morluto/rea/commit/ebd5a82c439f6deb3a06062225ce009eb03257cf), [38f92d1](https://github.com/morluto/rea/commit/38f92d108e3148cdf47e4ffbfe3de8a76e795d51)). Thanks @Abdooo2235, @geekwolf, @ShuaixinHuang.
- **Electron runtime capture:** Keep native IPC listener and one-shot dispatch behavior, block synchronous shell effects during capture, refuse active scenarios when the inspect fuse is disabled, and preserve fuse/transport cleanup ownership. ([#4389](https://github.com/morluto/rea/pull/4389), [morluto/rea#4390](https://github.com/morluto/rea/issues/4390), [#4605](https://github.com/morluto/rea/pull/4605), [morluto/rea#4593](https://github.com/morluto/rea/issues/4593), [#4562](https://github.com/morluto/rea/pull/4562), [morluto/rea#4393](https://github.com/morluto/rea/issues/4393), [#3605](https://github.com/morluto/rea/pull/3605), [morluto/rea#3453](https://github.com/morluto/rea/issues/3453), [f9de413](https://github.com/morluto/rea/commit/f9de41371f7536e2e22ce6e43c9314fa2f238a30), [e7df00e](https://github.com/morluto/rea/commit/e7df00e80777757b329bbe8aba6d421d8892b9d5)). Thanks @Adolanium, @gensokyo-dev, @gkobayashi0, @HarsH-1877, @kaoru0822-kitauji, @keeponlight, @N0zoM1z0, @Nitin13-git, @xu91102.
- **APK resource accuracy:** Retain completed tables and decode facts after interrupted or failed reads. Derive locale limits from resource configuration fields, disclose unselectable qualified tables, distinguish document failures from omitted entries, and bind Evidence to the decoded snapshot. ([34a88d6](https://github.com/morluto/rea/commit/34a88d6c1674710953e2c94bd0a17332cd69ca6f), [f5fcf52](https://github.com/morluto/rea/commit/f5fcf5216ffb3a266b8c00f6d9a0943051084ab5), [6385ef4](https://github.com/morluto/rea/commit/6385ef4355d7a794b3154ee38529cbddee583336), [98886ad](https://github.com/morluto/rea/commit/98886adddfcbd7b4f4236b3a9825f91878c3cb11), [dc2e811](https://github.com/morluto/rea/commit/dc2e8117b60c4481372ed89b077e6c1cf81ee653), [#4771](https://github.com/morluto/rea/pull/4771), [morluto/rea#4768](https://github.com/morluto/rea/issues/4768)). Thanks @abhay-2108, @gensokyo-dev, @Iyanuoluwa007, @kaoru0822-kitauji, @N0zoM1z0.
- **Apktool guidance:** Retain the observed version and disclose the matching platform/release advisory windows without treating a version string as proof of decoder safety. Missing prerequisites and decode refusals identify the selected APK or launcher. ([d38f099](https://github.com/morluto/rea/commit/d38f099692394ec90c582f9f0a14b036b421b160), [63696d2](https://github.com/morluto/rea/commit/63696d277328f556c971d1fc9f81ae83128d468b), [cc038da](https://github.com/morluto/rea/commit/cc038da218cada68c87700477aba3db4739791ff)). Thanks @GovinduSasanka, @peter-research.
- **Android method bodies:** Recover original bytecode bodies when Java source is omitted while preserving genuine native/abstract body absence and primary failures during retryable cleanup. ([63c65a2](https://github.com/morluto/rea/commit/63c65a22430a4bbc0c1807a0298edb867775001f), [742b6f5](https://github.com/morluto/rea/commit/742b6f587f3c4ef1b8212e7376d6f3a305b194dc), [9fa6d2b](https://github.com/morluto/rea/commit/9fa6d2b254cc390665974efb52463386a029e9fc)). Thanks @balkan16, @Chessing234.
- **ADB observations and transfers:** Preserve display-scoped focus, distinguish missing declarations from absent focus, retain numeric physical density and mark unknown permission coverage partial. Transfers use consumed snapshot identity and refuse unknown destination existence; uninstall requests explicitly select user zero. ([7086768](https://github.com/morluto/rea/commit/7086768a27242a15daa93486aefbaacc3c891e78), [3d028db](https://github.com/morluto/rea/commit/3d028dbc74a465f6f8df1813a931fbb5362e7dc3), [#4074](https://github.com/morluto/rea/pull/4074), [morluto/rea#3942](https://github.com/morluto/rea/issues/3942), [#4663](https://github.com/morluto/rea/pull/4663), [#4665](https://github.com/morluto/rea/pull/4665), [1342127](https://github.com/morluto/rea/commit/1342127e91d4db8b4113a7a4e85be909bc96e1db), [61e6880](https://github.com/morluto/rea/commit/61e688070f48016b6d178cd04c02fcc2f33e19ad), [be0b2d1](https://github.com/morluto/rea/commit/be0b2d138c46bb951fc3c8ee57ef7b0d57fed312)). Thanks @Copilot, @coygeek, @gongfpp, @Tapraj-Pathak, @yankikucuk.
- **Apple metadata:** Preserve exact plist/keyed-archive integers, negative zero, non-finite real identity and dictionary keys. Reject malformed XML before value decoding, retain undecodable dates as unknown and report unsupported OpenStep entries explicitly. ([#4324](https://github.com/morluto/rea/pull/4324), [morluto/rea#4292](https://github.com/morluto/rea/issues/4292), [2cf9c28](https://github.com/morluto/rea/commit/2cf9c28f27261b7e64af2ba7ecb4e23ea7714aee), [#4839](https://github.com/morluto/rea/pull/4839), [morluto/rea#4834](https://github.com/morluto/rea/issues/4834), [f2b7bbb](https://github.com/morluto/rea/commit/f2b7bbb31279a820f4cf32d439570f8e5381d010), [6c98708](https://github.com/morluto/rea/commit/6c98708793c23615de8053b2cd14d9f164b960c5), [78cf610](https://github.com/morluto/rea/commit/78cf6100f33ad2412c0a3d60b83f8a44a43fbbb5), [c7e9e09](https://github.com/morluto/rea/commit/c7e9e096d3e2444e4c251123b8e914e9c0941f4e), [#3793](https://github.com/morluto/rea/pull/3793), [#4105](https://github.com/morluto/rea/pull/4105), [morluto/rea#3892](https://github.com/morluto/rea/issues/3892)). Thanks @coygeek, @kaoru0822-kitauji, @mertkayacs, @pablodiazjorge, @pollychen-lab, @xu91102.
- **Apple application structure:** Derive bundle components and launchd domains from their owning directories, retain unavailable components, and select only exact `Assets.car` names as asset catalogs. Interface Builder keeps unresolved classes and counts hierarchy records beyond the returned object page. ([149a0fc](https://github.com/morluto/rea/commit/149a0fc06c3c67ee45624e6da14dfb0754473758), [5d6029e](https://github.com/morluto/rea/commit/5d6029ea62a65ec34fd739ee40223c77c6fdb63b), [c192c58](https://github.com/morluto/rea/commit/c192c58815ddeaf5cf30159e7082c742c0bc36b7), [#4094](https://github.com/morluto/rea/pull/4094), [morluto/rea#3914](https://github.com/morluto/rea/issues/3914), [#4118](https://github.com/morluto/rea/pull/4118), [morluto/rea#3958](https://github.com/morluto/rea/issues/3958), [#4162](https://github.com/morluto/rea/pull/4162), [morluto/rea#3950](https://github.com/morluto/rea/issues/3950)). Thanks @coygeek, @kaoru0822-kitauji.
- **Native names and layout:** Keep valid Objective-C records beside malformed neighbors, preserve leading U+FEFF and repeated load-command fields, and select exact arm64e.x1 slices. PE resource ownership and NativeAOT reads stay within declared image/header ranges. ([#3833](https://github.com/morluto/rea/pull/3833), [morluto/rea#3336](https://github.com/morluto/rea/issues/3336), [#4549](https://github.com/morluto/rea/pull/4549), [morluto/rea#4540](https://github.com/morluto/rea/issues/4540), [morluto/rea#4541](https://github.com/morluto/rea/issues/4541), [#4730](https://github.com/morluto/rea/pull/4730), [#4048](https://github.com/morluto/rea/pull/4048), [morluto/rea#4008](https://github.com/morluto/rea/issues/4008), [#3500](https://github.com/morluto/rea/pull/3500), [morluto/rea#3389](https://github.com/morluto/rea/issues/3389), [#4463](https://github.com/morluto/rea/pull/4463), [morluto/rea#4373](https://github.com/morluto/rea/issues/4373), [morluto/rea#4455](https://github.com/morluto/rea/issues/4455), [3fc0075](https://github.com/morluto/rea/commit/3fc007534bb2104d662b43cc712281f9d1d6a7d3), [4a076f3](https://github.com/morluto/rea/commit/4a076f368c62bdfb19415accad342e03a38d1005)). Thanks @coygeek, @Iyanuoluwa007, @jayinvers, @kaoru0822-kitauji, @kevinjosh10, @maxazure, @ShuaixinHuang.
- **Native analysis providers:** Keep Ghidra byte matches within examined coverage, retain PE PDB/function-boundary limitations and preserve configured MIPS choices. Attached IDA refuses universal Mach-O rather than silently choosing a slice; request timeout identity and captured output survive adapter handling. ([#4531](https://github.com/morluto/rea/pull/4531), [#2933](https://github.com/morluto/rea/pull/2933), [morluto/rea#2259](https://github.com/morluto/rea/issues/2259), [01a1b3f](https://github.com/morluto/rea/commit/01a1b3fda6a7dacd24a0b10619d41d12153080d4), [50dd9fc](https://github.com/morluto/rea/commit/50dd9fcad1efb47cb404192c30bdf190dcdaca58), [#4765](https://github.com/morluto/rea/pull/4765), [morluto/rea#3871](https://github.com/morluto/rea/issues/3871), [c0cfccb](https://github.com/morluto/rea/commit/c0cfccb45fe43e7eeff18e56c64caa5b121988f9)). Thanks @BeLit-Development-2, @coygeek, @kaoru0822-kitauji, @N0zoM1z0, @ShuaixinHuang.
- **Recorded crashes:** Prevent GDB from discovering an executable named by an untrusted core, reject core mapping paths that escape the isolated sysroot, and preserve pwntools worker ownership across launcher exec. Completed decode facts and cancellation reasons remain available through failed final cleanup. ([5bf4fff](https://github.com/morluto/rea/commit/5bf4fffc1b835130ddb16f96db9ce13b639591db), [b33c0df](https://github.com/morluto/rea/commit/b33c0df02e93fabca00a44f2de625b1a63637ee9), [#4435](https://github.com/morluto/rea/pull/4435), [morluto/rea#4011](https://github.com/morluto/rea/issues/4011)). Thanks @coygeek, @N0zoM1z0.
- **Cutter and Rizin:** Read Cutter’s active document from core configuration and attribute its host version correctly. Keep interrupted Rizin frames and output whitespace before completion markers, with exact command and cleanup failure attribution. ([#4507](https://github.com/morluto/rea/pull/4507), [morluto/rea#4497](https://github.com/morluto/rea/issues/4497), [#4514](https://github.com/morluto/rea/pull/4514), [morluto/rea#4498](https://github.com/morluto/rea/issues/4498), [#4459](https://github.com/morluto/rea/pull/4459), [morluto/rea#4015](https://github.com/morluto/rea/issues/4015), [d5fc7e6](https://github.com/morluto/rea/commit/d5fc7e6ebf9af050081fc4c6e18b9079cfaa5cdc), [199396f](https://github.com/morluto/rea/commit/199396f61c8f61da326d059606a992304a760147)). Thanks @coygeek, @N0zoM1z0, @Xander-AJ.
- **Windows cleanup:** Retain unpublished runtimes after failed removal, handle read-only attributes and sharing conflicts, preserve primary snapshot failures and honor caller environment overrides. ([f78d137](https://github.com/morluto/rea/commit/f78d137b42741a0ed5fb8ac161286f9a50220c4d), [d69acc3](https://github.com/morluto/rea/commit/d69acc3455c33f90a2fc4381db43d38b6af50622), [0679a79](https://github.com/morluto/rea/commit/0679a7972b4f2b02eee6a86a44f50f4c2967d3cb), [5f9ac2c](https://github.com/morluto/rea/commit/5f9ac2c98a6fe11988c41afb737df9b6d5c3a1b3), [1bbf4bd](https://github.com/morluto/rea/commit/1bbf4bd16ca134cdb2187eaf29291cae90d14a57)). Thanks @DeryFerd.
- **Managed metadata:** Compare nominal signatures and declaring identities across builds, preserve empty names without display substitutions, verify ABI-prefixed Mach-O exports exactly, and charge cached metadata once. Metadata errors report artifact file offsets; mixed-mode assemblies retain their actual boundary classification. ([#3059](https://github.com/morluto/rea/pull/3059), [#3079](https://github.com/morluto/rea/pull/3079), [#3853](https://github.com/morluto/rea/pull/3853), [morluto/rea#3352](https://github.com/morluto/rea/issues/3352), [#3974](https://github.com/morluto/rea/pull/3974), [morluto/rea#3961](https://github.com/morluto/rea/issues/3961), [#3491](https://github.com/morluto/rea/pull/3491), [morluto/rea#3449](https://github.com/morluto/rea/issues/3449), [#4418](https://github.com/morluto/rea/pull/4418), [morluto/rea#4372](https://github.com/morluto/rea/issues/4372), [#3516](https://github.com/morluto/rea/pull/3516), [morluto/rea#3366](https://github.com/morluto/rea/issues/3366)). Thanks @8rulerstar, @coygeek, @duckhunt113, @Hahaa909, @JayOfTheKeyboard, @kaoru0822-kitauji, @keeponlight, @N0zoM1z0, @tomyrms.
- **Archive and filesystem identity:** Reject colliding extraction paths before writing, classify ZIP offsets beyond EOF as malformed, normalize ZIP current-directory prefixes once, and preserve symlink and unreadable-path provenance. A directory named `*.map` is no longer mistaken for a source-map file. ([862a0b2](https://github.com/morluto/rea/commit/862a0b2631785492f8dc20c8acd396646c545fd1), [c209dcb](https://github.com/morluto/rea/commit/c209dcb209118069f123e789949eeba1ef78853e), [6b1c36e](https://github.com/morluto/rea/commit/6b1c36e336eeacbb7159b211e687b4b84f99b9f5), [25c2222](https://github.com/morluto/rea/commit/25c22222abe7a681491bdb4d7316250fdcf32973), [d6e4fe4](https://github.com/morluto/rea/commit/d6e4fe4a4dd8914ec3db50d2a7fc3d0802649262), [#4131](https://github.com/morluto/rea/pull/4131), [morluto/rea#3909](https://github.com/morluto/rea/issues/3909)). Thanks @Adkid-Zephyr, @coygeek, @jackie-cqz, @kaoru0822-kitauji, @maxazure, @XY-code1.
- **Evidence and reconstruction:** Authenticate all retained inventory substeps, preserve source-attributed caveats in composed workflows, and require comparable cited Evidence before declaring reconstruction coverage or readiness. Missing Evidence and residual replay uncertainty stay explicit. ([9ac91e0](https://github.com/morluto/rea/commit/9ac91e0c1e13e91cd21341635ad5be89b0e8642d), [c4608a2](https://github.com/morluto/rea/commit/c4608a29620ea3e7bb8259b47357b942fe4e4709), [#4075](https://github.com/morluto/rea/pull/4075), [morluto/rea#3357](https://github.com/morluto/rea/issues/3357), [#3526](https://github.com/morluto/rea/pull/3526), [morluto/rea#3363](https://github.com/morluto/rea/issues/3363), [153017d](https://github.com/morluto/rea/commit/153017d750322188c1a112b2284c1b8065c67320)). Thanks @coygeek, @gensokyo-dev, @kaoru0822-kitauji, @N0zoM1z0, @rudycelekli.
- **Offline data:** Preserve exact UTC packet-capture instants, SQLite column identity and snapshot admission failures, and cooked WASM directive literals. Cleanup cancellation retains completed EVM/WASM observations rather than losing them. ([796faa0](https://github.com/morluto/rea/commit/796faa0e4e6bf745bcdc33acef65af8ccfc3622d), [748ac7f](https://github.com/morluto/rea/commit/748ac7f0df340f0d0569eca2e803a59cd51ffdbd), [bc51d0e](https://github.com/morluto/rea/commit/bc51d0ea5df7dcee1fcc42dfae3ab0c62c9cca5e), [4f87f02](https://github.com/morluto/rea/commit/4f87f02bb19bf77349a683a5bcb2da2d1da427d0), [d694aef](https://github.com/morluto/rea/commit/d694aef227e90164e6654ea9e5ce6a854d099404), [321cacb](https://github.com/morluto/rea/commit/321cacb84a020f447e1110df5c58fa71d99b7bf1)). Thanks @himamaheswarreddy, @mertkayacs, @rollroyces, @viniciusdsandrade.
- **Kuna recovery:** Share concurrent single-function requests and cache repeats, validate warm exports once, stream string inventories beyond the former fixed buffer ceiling, and keep unproven processes in their run slots until close confirms release. Failure messages distinguish final buffer refusals from configurable deadlines. ([#4045](https://github.com/morluto/rea/pull/4045), [#4169](https://github.com/morluto/rea/pull/4169), [#4049](https://github.com/morluto/rea/pull/4049), [#4318](https://github.com/morluto/rea/pull/4318), [#4052](https://github.com/morluto/rea/pull/4052), [#4098](https://github.com/morluto/rea/pull/4098), [#4343](https://github.com/morluto/rea/pull/4343)). Thanks @kaoru0822-kitauji.
- **Flutter snapshots:** Check symbol-table ranges against loadable segments and retain completed inspection facts when cancellation occurs during snapshot cleanup. ([#3859](https://github.com/morluto/rea/pull/3859), [morluto/rea#3346](https://github.com/morluto/rea/issues/3346), [#4766](https://github.com/morluto/rea/pull/4766), [morluto/rea#4717](https://github.com/morluto/rea/issues/4717), [#4762](https://github.com/morluto/rea/pull/4762), [morluto/rea#4640](https://github.com/morluto/rea/issues/4640)). Thanks @coygeek, @kaoru0822-kitauji.
- **Native metadata recovery:** Keep unknown Objective-C category classes, empty protocol names, undecoded Swift aliases and unfinished property types explicit instead of discarding neighboring valid records. Preserve unnamed segment identity and exclude a dylib’s own install name from dependencies. ([#4093](https://github.com/morluto/rea/pull/4093), [morluto/rea#4012](https://github.com/morluto/rea/issues/4012), [#4078](https://github.com/morluto/rea/pull/4078), [morluto/rea#3873](https://github.com/morluto/rea/issues/3873), [#4085](https://github.com/morluto/rea/pull/4085), [morluto/rea#3934](https://github.com/morluto/rea/issues/3934), [#3825](https://github.com/morluto/rea/pull/3825), [morluto/rea#3345](https://github.com/morluto/rea/issues/3345), [#4051](https://github.com/morluto/rea/pull/4051), [morluto/rea#3875](https://github.com/morluto/rea/issues/3875), [#4050](https://github.com/morluto/rea/pull/4050), [morluto/rea#3872](https://github.com/morluto/rea/issues/3872)). Thanks @coygeek, @kaoru0822-kitauji.
- **Document selection:** Preserve explicitly selected plist paths and bundle defaults, and only use document fallback after confirming its applicability. Finalization keeps completed selection facts and cancellation outcomes. ([e6c4877](https://github.com/morluto/rea/commit/e6c487799bb64f559e66b69be1863e6ec5187548), [#3774](https://github.com/morluto/rea/pull/3774), [9df559b](https://github.com/morluto/rea/commit/9df559b7e712298a761ff26e9caae8d659b7e54b)). Thanks @kaoru0822-kitauji.
- **Capture and comparison accuracy:** Admit schema-valid HAR numeric values while retaining exact-publication limits, preserve empty URL path segments, and keep unrelated process traces and unnamed reference endpoints distinct or unknown. ([#3159](https://github.com/morluto/rea/pull/3159), [morluto/rea#3145](https://github.com/morluto/rea/issues/3145), [#3792](https://github.com/morluto/rea/pull/3792), [morluto/rea#3307](https://github.com/morluto/rea/issues/3307), [#4178](https://github.com/morluto/rea/pull/4178), [morluto/rea#3931](https://github.com/morluto/rea/issues/3931), [#3809](https://github.com/morluto/rea/pull/3809), [morluto/rea#3388](https://github.com/morluto/rea/issues/3388)). Thanks @coygeek, @gensokyo-dev, @kaoru0822-kitauji, @N0zoM1z0, @pablodiazjorge, @xu91102.
- **Evidence publication:** Recheck staged output identity after its final write, classify missing review Evidence and duplicate ledger entries as caller input, and preserve the selected freshness requirement in comparison parameters. ([#4764](https://github.com/morluto/rea/pull/4764), [morluto/rea#4613](https://github.com/morluto/rea/issues/4613), [#4452](https://github.com/morluto/rea/pull/4452), [morluto/rea#4444](https://github.com/morluto/rea/issues/4444), [#4065](https://github.com/morluto/rea/pull/4065), [morluto/rea#4000](https://github.com/morluto/rea/issues/4000)). Thanks @amyanger, @coygeek, @kaoru0822-kitauji, @Rinkia, @Swatantra-66.

### ⚠ BREAKING CHANGES

- **Saved Evidence:** Evidence and analysis snapshots now require explicit nullable `relationship_coverage` in their identity commitments. Earlier records whose digest omitted null coverage are incompatible even when the serialized field is explicitly null. Artifact inventories require scoped coverage and explicit `integrity_contradictions`; obsolete `coverage_status` and prose-based coverage inference are removed. Regenerate old Evidence/snapshots and inventory observations with this release: saved files are not migrated and omitted facts are not filled with guessed defaults. ([db8128d](https://github.com/morluto/rea/commit/db8128dc0d1c4f731f3d19877fa00d25cf17f657), [0405c9d](https://github.com/morluto/rea/commit/0405c9d361de6d904dfa16cc0b6d8350407f2c9b), [a9588be](https://github.com/morluto/rea/commit/a9588be4ebdd20eeda975cb63ffcdb1cd868b340)).
- **Browser capture results:** Consumers must retain resolved capture limits, event families and omission facts. Set desired budgets through the supported capture options; omitted caller inputs still select defaults, but stored observations must report the resolved values. Admitted content reads queue behind bounded concurrency. ([57a23f0](https://github.com/morluto/rea/commit/57a23f0a2da0fdc3835e203718ded8acea5a34e6)).
- **Android version codes:** `inspect_adb_package.version_code` is a decimal string rather than a JSON number. Read it as a string, or use `BigInt` for numeric comparison. ([#3485](https://github.com/morluto/rea/pull/3485), [morluto/rea#3368](https://github.com/morluto/rea/issues/3368), [7666a48](https://github.com/morluto/rea/commit/7666a482b69dc7cabdbac3bbaf89a43e32300192)). Thanks @coygeek, @kaoru0822-kitauji.
- **Native UI failures:** Failed or cancelled native UI scenarios now return typed errors with the collected report in `partial_observation`. Handle the error path and read that report instead of expecting a successful result containing failed steps. ([d909919](https://github.com/morluto/rea/commit/d9099190ab3a819bd3a9fd62a8714cef398016d5)).
- **Provider status:** `binary_session` candidate availability can be unknown during owner finalization. Preserve that state rather than treating it as unavailable; internal consumers must await the asynchronous session status API. ([150e996](https://github.com/morluto/rea/commit/150e996a86f2bec4982ba87f37bf502a8d5e8214)).
- **Swift symbol locations:** `swift_symbols` entries may have a null `address` when the provider supplies no location. Handle unknown addresses; optional `evidence.reported_address` retains the original provider value. ([8116dc0](https://github.com/morluto/rea/commit/8116dc06512b4609d8db63cebc9f2ff8cb964151)).
- **Linux Hopper admission:** Older builds previously admitted by a fixed allowlist need retained publisher-signed package evidence or an approved update to the current public demo. Update explicit `HOPPER_LAUNCHER_PATH` selections when migrating; the live feed offers only its current release. The official RPM metadata mismatch remains unresolved and is refused. ([#3590](https://github.com/morluto/rea/pull/3590), [morluto/rea#3577](https://github.com/morluto/rea/issues/3577), [70cd4cb](https://github.com/morluto/rea/commit/70cd4cbfb849b61f05d97d2690372a9782831426)). Thanks @gensokyo-dev, @kaoru0822-kitauji, @N0zoM1z0.

Full contribution record: [571 commits and 236 merged PRs](https://github.com/morluto/rea/blob/rea-agents-6.6.0/docs/releases/6.6.0.contributions.json).

## [6.5.0](https://github.com/morluto/rea/compare/rea-agents-6.4.0...rea-agents-6.5.0) (2026-10-13)

Provider prerequisites and recorded verification scope are listed in [the testing guide](docs/testing.md).

### Highlights

- Analyze selected JavaScript files and recover cross-bundle relationships without expanding the selected source scope.
- Read compact summaries and page retained Evidence across binary, managed, Android, Dart, WASM and network workflows.
- Inspect SQLite snapshots, packet and signal recordings, WebAssembly, Rust dependency metadata and Electron fuses offline.
- Keep completed Evidence and partial observations available when analysis or cleanup fails.

### Changes

- **JavaScript source selection:** analyze exact application paths without expanding imports into the selected scope. Unselected files retain identity and explicit unknown coverage; summary delivery remains separate from source selection. ([#1944](https://github.com/morluto/rea/pull/1944), [issue morluto/rea#1848](https://github.com/morluto/rea/issues/1848)). Thanks @kaoru0822-kitauji, @N0zoM1z0.
- **Code-split recovery:** recover related bundles from multiple selected inputs, retaining per-file provenance and downstream cross-chunk imports. Recorded CLI/MCP coverage is Linux x64 with Wakaru 1.14.0 and source-owned esbuild/webpack fixtures; other hosts, releases and arbitrary application equivalence remain unverified. ([#1686](https://github.com/morluto/rea/pull/1686), [issue morluto/rea#1605](https://github.com/morluto/rea/issues/1605)). Thanks @JingHao-Leon, @pionxzh.
- **Package imports:** resolve exact package import aliases using the selected loader and package ancestry, rather than guessing sibling files. ([#1862](https://github.com/morluto/rea/pull/1862), [issue morluto/rea#1838](https://github.com/morluto/rea/issues/1838)). Thanks @AWUQAQ, @mvanhorn.
- **Retained analysis views:** opt into compact inventory/WASM, managed metadata, Android manifest, Dart AOT, Mach-O and EVM summaries, then page retained Evidence without rerunning analysis. Summary delivery preserves the complete recorded result and its original coverage. ([#2122](https://github.com/morluto/rea/pull/2122), [#2193](https://github.com/morluto/rea/pull/2193), [#2413](https://github.com/morluto/rea/pull/2413), [#2438](https://github.com/morluto/rea/pull/2438), [#2455](https://github.com/morluto/rea/pull/2455), [#2634](https://github.com/morluto/rea/pull/2634), [#2308](https://github.com/morluto/rea/pull/2308), [9a18251](https://github.com/morluto/rea/commit/9a18251426f891e6a24856b715ef8002ab8b9610)). Thanks @kaoru0822-kitauji, @N0zoM1z0.
- **Managed assemblies:** Select declaring types when inspecting members, decode inspected `ldstr` literals with independent coverage, and page retained member summaries. Call and field targets expose `target_declaring_type` and `field_declaring_type`, including supported generic method targets; unresolved metadata remains unknown. ([#1706](https://github.com/morluto/rea/pull/1706), [#2125](https://github.com/morluto/rea/pull/2125), [issue morluto/rea#2121](https://github.com/morluto/rea/issues/2121), [#2162](https://github.com/morluto/rea/pull/2162), [issue morluto/rea#2158](https://github.com/morluto/rea/issues/2158), [#3061](https://github.com/morluto/rea/pull/3061), [issue morluto/rea#3010](https://github.com/morluto/rea/issues/3010), [#2163](https://github.com/morluto/rea/pull/2163), [issue morluto/rea#2160](https://github.com/morluto/rea/issues/2160)). Thanks @kaoru0822-kitauji, @N0zoM1z0, @Nelglor, @skoodster.
- **Packet captures:** inspect saved packets with bounded TShark output, compact capture summaries and retained pages; discover installed protocol/field definitions. Recorded real-engine coverage uses Linux and Wireshark 4.6.6; native Windows/macOS and Bun behavior remain unverified. ([#2318](https://github.com/morluto/rea/pull/2318), [#2340](https://github.com/morluto/rea/pull/2340), [#2496](https://github.com/morluto/rea/pull/2496)). Thanks @3QL, @N0zoM1z0, @Olorinm.
- **Recorded signals:** decode existing recordings and discover installed decoders/options through caller-supplied sigrok-cli 0.7.2. This is Linux-only and requires util-linux `prlimit`; it acquires no hardware samples. ([#2339](https://github.com/morluto/rea/pull/2339), [#2487](https://github.com/morluto/rea/pull/2487)). Thanks @N0zoM1z0, @Olorinm.
- **Web captures:** derive an inferred method/origin/path-template API surface from retained HAR data including observed query-parameter names while retaining unknowns; query values, headers and bodies remain excluded. ([#1891](https://github.com/morluto/rea/pull/1891), [#2982](https://github.com/morluto/rea/pull/2982), [issue morluto/rea#2913](https://github.com/morluto/rea/issues/2913)). Thanks @mvanhorn, @wunianze666-netizen, @zhangguiping-xydt.
- **QUIC captures:** inspect retained aioquic 1.5.0 JSON qlog 0.3 objects and page traces/streams/observations. Other qlog layouts remain unsupported; overlap and loss declarations do not prove retransmission or network loss. ([#2277](https://github.com/morluto/rea/pull/2277)). Thanks @LuisTaffelli, @N0zoM1z0.
- **Fiddler captures:** inspect native SAZ archives with retained HTTP provenance and bounded decoding. Recorded producer coverage is the pinned public encoding corpus; current Fiddler Everywhere variants and Bun-native execution remain unverified. ([#2409](https://github.com/morluto/rea/pull/2409)). Thanks @N0zoM1z0, @zahhak.
- **SQLite snapshots:** inspect an explicitly selected offline database with table/column selection and bounded Evidence. This operation requires Node 24.x >=24.15 or 26+ with `DatabaseSync.limits`; supported Node 22 and earlier 24 runtimes cannot use it. A live database/WAL copy does not establish an atomic snapshot. ([#2271](https://github.com/morluto/rea/pull/2271)). Thanks @N0zoM1z0, @Y0UW1SH.
- **WASM artifacts:** Inspect local modules with bring-your-own WABT 1.0.42 without executing them. Compare imports/exports from two complete core-module inspection Evidence records without requiring an active WABT installation; unsupported signatures and duplicate identities remain unknown, and comparisons do not establish runtime compatibility. Recorded real-tool inspection coverage is macOS arm64. ([#1533](https://github.com/morluto/rea/pull/1533), [issue morluto/rea#884](https://github.com/morluto/rea/issues/884), [#2464](https://github.com/morluto/rea/pull/2464), [issue morluto/rea#2356](https://github.com/morluto/rea/issues/2356)). Thanks @matbrgz, @N0zoM1z0, @thangldw.
- **Go binaries:** inspect embedded build metadata, including file-backed unmapped Mach-O debug segments. ([#1363](https://github.com/morluto/rea/pull/1363), [7fb097d](https://github.com/morluto/rea/commit/7fb097d72c9931dd5dfae481ad2b9d3bb6029f15)). Thanks @Y0UW1SH.
- **Flutter APKs:** identify snapshot/engine builds and inspect AOT structure without an external engine. Recorded real APK coverage uses the documented Flutter Gallery fixture; macOS/Windows and complete pool semantics remain unverified, and pool coverage stays partial. ([#1582](https://github.com/morluto/rea/pull/1582)). Thanks @3QL.
- **HarmonyOS packages:** inventory HAP/HSP/App Pack structures without executing code. The recorded real workflow covers one pinned HAP through repository-built CLI/MCP; installed-package and real HSP/App Pack coverage remain unverified. ([#1447](https://github.com/morluto/rea/pull/1447)). Thanks @BaaRai.
- **Ghidra raw inputs and references:** compatible Linux/macOS Ghidra profiles accept caller-selected raw architecture/entry information and expose typed incoming references at exact addresses. Windows Ghidra P0 admits the raw NMOS 6502 profile described below; other raw targets and the incoming-reference facet remain outside Windows P0. ([#1868](https://github.com/morluto/rea/pull/1868), [issue morluto/rea#1836](https://github.com/morluto/rea/issues/1836), [#1715](https://github.com/morluto/rea/pull/1715), [issue morluto/rea#1245](https://github.com/morluto/rea/issues/1245)). Thanks @bugstan, @casesolved-co-uk, @mvanhorn, @N0zoM1z0.
- **Ghidra MIPS:** Add bounded MIPS32r2/o32 relocatable objects, soft-float integer-register storage, admitted MIPS16 shared ELF, and a narrowly admitted recordless legacy MIPS32 executable profile. The latter pins an endian-matched 32-bit language and records inferred o32 as an analysis assumption. Admission follows each documented ABI/flag/relocation boundary. ([#1949](https://github.com/morluto/rea/pull/1949), [issue morluto/rea#1937](https://github.com/morluto/rea/issues/1937), [#1950](https://github.com/morluto/rea/pull/1950), [issue morluto/rea#1938](https://github.com/morluto/rea/issues/1938), [#1991](https://github.com/morluto/rea/pull/1991), [issue morluto/rea#1851](https://github.com/morluto/rea/issues/1851), [#1898](https://github.com/morluto/rea/pull/1898), [issue morluto/rea#1620](https://github.com/morluto/rea/issues/1620)). Thanks @AurelioB, @BaaRai, @bqw371, @kaoru0822-kitauji, @N0zoM1z0.
- **Ghidra RISC-V:** admit little-endian RV32/RV64 `ET_EXEC` ELF declaring the supported double-float ABI. Relocatable/shared, big-endian and other ABI profiles remain refused; see [the profile and recorded lane](docs/ghidra-riscv.md). ([#2151](https://github.com/morluto/rea/pull/2151)). Thanks @NIU-123370.
- **PSP static ELF profile:** the Ghidra profile is Linux x64, bounded little-endian ELF32 `ET_EXEC` with the documented PSP/ABI declarations and a compatible caller-installed Allegrex extension. PRX, shared/relocatable images, PBP/ISO/CSO and runtime emulation are outside scope. Historical extension experiments are separate from public-provider verification; real public Ghidra PSP coverage remains unverified. ([#1599](https://github.com/morluto/rea/pull/1599)). Thanks @jaelliot.
- **Ghidra analysis settings:** apply validated analyzer overrides before analysis while retaining the selected analysis profile. ([#1913](https://github.com/morluto/rea/pull/1913)). Thanks @akushonkamen, @kaoru0822-kitauji, @N0zoM1z0.
- **Attached native IDA MCP:** add an optional native bridge alongside existing legacy/headless profiles. Recorded native runs use Linux IDA Free 9.4 with a navigation correction and Windows IDA Pro 9.3 with a loopback-listener change; stock native switching, native macOS and Windows IDA Free remain unverified. Attached databases remain read-only and are never saved or closed. ([#1544](https://github.com/morluto/rea/pull/1544)). Thanks @imissapixel, @N0zoM1z0.
- **Frida instrumentation:** add explicit local/remote target selection, caller-supplied scripts and retained messages, with script-read/input diagnostics and bounded message eviction. Recorded real coverage is the Linux local Node marker workflow; macOS, Windows and remote devices/servers remain unverified. Instrumentation executes foreign code and is destructive, not read-only. ([#1359](https://github.com/morluto/rea/pull/1359), [#2211](https://github.com/morluto/rea/pull/2211), [issue morluto/rea#2209](https://github.com/morluto/rea/issues/2209), [#2217](https://github.com/morluto/rea/pull/2217), [issue morluto/rea#2213](https://github.com/morluto/rea/issues/2213), [#2628](https://github.com/morluto/rea/pull/2628)). Thanks @dandgabr, @kaoru0822-kitauji, @N0zoM1z0.
- **Client setup:** register Qoder, Trae, ZCode, DeepSeek Harness, Kimi Code, Factory Droid and WorkBuddy through the existing scoped setup flow. DeepSeek is included from 6.5.0; the historical npm 6.4 check did not cover it. Live Trae and DeepSeek API integration remain unverified. ([#1564](https://github.com/morluto/rea/pull/1564), [#1572](https://github.com/morluto/rea/pull/1572), [#1573](https://github.com/morluto/rea/pull/1573), [#1929](https://github.com/morluto/rea/pull/1929), [issue morluto/rea#1839](https://github.com/morluto/rea/issues/1839), [#2744](https://github.com/morluto/rea/pull/2744), [#2309](https://github.com/morluto/rea/pull/2309), [#3041](https://github.com/morluto/rea/pull/3041), [issue morluto/rea#3040](https://github.com/morluto/rea/issues/3040)). Thanks @0xRafie, @BaaRai, @cainiao1992, @IvenKooLab, @whoishaha, @ysntony.
- **Website:** Add maintained language editions, persistent/system-aware themes, keyboard styling and nested Evidence indentation, plus the reverse-engineering models essay. A simpler home page and beginner journey connect platform prerequisites, client/provider setup and a supplied first investigation. ([#1779](https://github.com/morluto/rea/pull/1779), [issue morluto/rea#1022](https://github.com/morluto/rea/issues/1022), [#1699](https://github.com/morluto/rea/pull/1699), [#1714](https://github.com/morluto/rea/pull/1714), [#1894](https://github.com/morluto/rea/pull/1894), [#2250](https://github.com/morluto/rea/pull/2250), [#2432](https://github.com/morluto/rea/pull/2432), [#2732](https://github.com/morluto/rea/pull/2732), [#3274](https://github.com/morluto/rea/pull/3274)). Thanks @CassieFox23, @kaoru0822-kitauji, @N0zoM1z0.

- **Rust dependency metadata:** Inspect embedded cargo-auditable package/dependency records in ELF, PE and thin Mach-O without executing the file. Missing metadata and inferred compiler hashes retain explicit limitations; universal Mach-O requires a selected thin slice. ([#2456](https://github.com/morluto/rea/pull/2456)). Thanks @mvanhorn.
- **Electron fuses:** Read packaged fuse bytes and per-slice runtime implications without launching or modifying the app. Missing, truncated and unknown wires remain explicit; fuse observations do not prove other Inspector-enablement paths. ([#2399](https://github.com/morluto/rea/pull/2399)). Thanks @kaoru0822-kitauji, @mvanhorn, @N0zoM1z0.
- **Ghidra PowerPC:** Admit bounded ELF32 big-endian `ET_EXEC` PowerPC with an explicit language profile on supported Linux/macOS hosts. PPC64, DOL and other variants remain outside this lane; see [the profile and verification prerequisites](docs/ghidra-ppc.md). ([#1747](https://github.com/morluto/rea/pull/1747)). Thanks @arielfikru.

- **Reference-source summaries:** Use CLI `import-reference-source --detail summary` for compact manifest, count, state and path-outline output. The complete graph remains available and is still the default; hidden outline entries retain separate coverage counts. ([#2768](https://github.com/morluto/rea/pull/2768), [issue morluto/rea#2442](https://github.com/morluto/rea/issues/2442)). Thanks @matbrgz, @To3akaRin.

- **Recorded AArch64 crashes:** Decode 34 ABI register values per thread from supported Linux ELF64 little-endian core notes using the documented caller-provided Python dependencies. These are recorded facts, not proof of current process or library identity. ([#2505](https://github.com/morluto/rea/pull/2505), [issue morluto/rea#2353](https://github.com/morluto/rea/issues/2353)). Thanks @matbrgz, @NIU-123370.

- **Ghidra byte search:** Search initialized analyzed memory using wildcards, bit masks, address bounds and paged results. Unloaded, overlay and uninitialized blocks retain skipped coverage; this is not a raw-file search. ([#2341](https://github.com/morluto/rea/pull/2341)). Thanks @mvanhorn.

- **Raw NMOS 6502 images:** Analyze explicitly selected headerless images with Ghidra, including Windows P0, using a caller-selected entry and source mapping within the 16-bit address space. Cartridge parsing, reset-vector inference and 65C02/65816 are outside this profile. ([#2079](https://github.com/morluto/rea/pull/2079)). Thanks @Zhong-fan.

- **Swift String observations:** Ghidra function dossiers derive supported AArch64 Swift String literals from constant-register pairs at recognized use sites, retaining instruction/register provenance and explicit omissions. This is a bounded derivation, not a complete string inventory. ([#2049](https://github.com/morluto/rea/pull/2049), [issue morluto/rea#2030](https://github.com/morluto/rea/issues/2030)). Thanks @thefolahan.

- **Headless IDA procedure lookup:** Resolve addresses to canonical containing-procedure entries and identify the session’s admitted program document in the modern headless profile. Incomplete surveys remain errors; attached profiles do not advertise this containment capability. ([#2374](https://github.com/morluto/rea/pull/2374), [issue morluto/rea#2335](https://github.com/morluto/rea/issues/2335)). Thanks @nikolay-dementiev.

- **Passive browser attachment:** Six existing passive browser tools accept an explicit-port loopback browser WebSocket endpoint when HTTP target discovery is unavailable. Existing consent and target/origin checks remain required; this does not launch a browser or enable runtime instrumentation. ([#2346](https://github.com/morluto/rea/pull/2346)). Thanks @all-black-493.

- **Android DEX references:** Retain exact method descriptors and individual direct-invoke observations with source method, DEX entry, opcode and code-unit offset. These are static references; unavailable instruction facts remain separate from method-level usage totals. ([#2439](https://github.com/morluto/rea/pull/2439)). Thanks @LcokHcak.

- **Offline EVM metadata:** Retain bounded, lossless facts from plausible terminal Solidity CBOR root-map candidates. Candidates do not prove Solidity origin or source/compiler identity, and linked metadata is not fetched. ([#2790](https://github.com/morluto/rea/pull/2790)). Thanks @matbrgz.

### Fixes

- **JavaScript loader and export identity:** Respect import/require conditions and unavailable package metadata, keep export links separate from writes, and resolve default identifier exports to the value captured at the export statement. ([7e5cffa](https://github.com/morluto/rea/commit/7e5cffa2ae9dfc9afaeca0715110d4dd41c0dcdd), [322506d](https://github.com/morluto/rea/commit/322506d0c0d39d3cd1e2e1c285c2cc23cfa73ee7), [81f7638](https://github.com/morluto/rea/commit/81f763820319a762f003cf95651ed14ce9326a4c), [dae1e55](https://github.com/morluto/rea/commit/dae1e55381f0d6cfee7f2082d5d27b938e55704c)). Thanks @paoValle, @VarunGore36, @xu91102.
- **JavaScript traces:** Retain nested bridge calls and surviving early-return predicates. Honor node-ID match options, match route seeds against source values, and keep ambiguous runtime candidates unknown. ([0351328](https://github.com/morluto/rea/commit/0351328e54ce70ea3f2814482e76b132774aff48), [5031099](https://github.com/morluto/rea/commit/503109995f9dcf8a955585d39a344fc846d2f59e), [44c9d29](https://github.com/morluto/rea/commit/44c9d2924d5b95d7a86595e8d7b7cf4fd4f0f6ac), [5e79d46](https://github.com/morluto/rea/commit/5e79d468e5864204cbe79a7ca2898541cee5e012)). Thanks @jpdefo.
- **Browser comparison coverage:** Compare only known redirect response fields and retain network-selection recovery guidance alongside independent event changes. Missing response facts do not prove equality or a change. ([2b60e09](https://github.com/morluto/rea/commit/2b60e097f281f7708c69f1f7ba9263694547bcc0)).
- **Evidence comparison and ledger input:** Report display-only bundle differences as unchanged while retaining digests, and classify noncanonical bundle records as invalid caller input. ([030c477](https://github.com/morluto/rea/commit/030c47732833c9cedcc31db1309eb3a1ca2c62e8), [3a34ad3](https://github.com/morluto/rea/commit/3a34ad37bdb7b8debba0f6515ba85b80141f2716)).
- **Capture and admission cleanup:** Keep deleted-file observations and original bytes when a parent becomes a file, preserve unrelated I/O failures during cancellation, and require explicit pre-launch proof before releasing an unknown LLDB target owner. LLDB failure controls used simulated boundaries. ([e67c364](https://github.com/morluto/rea/commit/e67c3642c8920a2a9c0e231ee2f16f50b245df31), [2daeff4](https://github.com/morluto/rea/commit/2daeff4b243e1cd137c591ca394e18a1c05c8bbc), [45b6a7f](https://github.com/morluto/rea/commit/45b6a7fe8f51a89951aaa823ffa627f6f5453a33)). Thanks @SII-YDD, @xu91102.
- **Client configuration:** Validate MCP output-schema profiles before setup writes, ignore untrusted Gemini workspace settings before parsing them, and identify installed skills independently of marker-only client roots. ([0930e94](https://github.com/morluto/rea/commit/0930e94e077ab7fb4d695f62785919a8a25c2e21), [aade9bb](https://github.com/morluto/rea/commit/aade9bbcb79aa8504ab6921b25f8ab082aba78e7), [ba33c70](https://github.com/morluto/rea/commit/ba33c706d26b63e43308be50c0249c72cff62cc6)). Thanks @CmsChase, @paoValle, @sx4im.
- **Host tool discovery:** Share macOS Hopper launcher discovery across setup and runtime, preserve explicit paths, and report validated ADB and Apktool availability. ([7582f0d](https://github.com/morluto/rea/commit/7582f0dff29ae0e80c97b885ddd386ac61a92570), [e5deb83](https://github.com/morluto/rea/commit/e5deb832cb09bb524877d0df40f49d5b5bb7dea4)). Thanks @Chessing234, @kaoru0822-kitauji, @viniciusdsandrade.
- **SAZ encoding validation:** Reject invalid XML bytes, unsupported encodings and declarations that contradict the archive bytes, including records outside the selected request. ([1250aae](https://github.com/morluto/rea/commit/1250aaedd8b4d1e471d8a382f76418bde65c05d2)).
- **Managed member matching:** Keep malformed TypeDef list ownership unknown, distinguish constants during structural method matching, and accept legacy small exception-section sizes. ([3f6b575](https://github.com/morluto/rea/commit/3f6b5755b3e699bd9373641acffe0f2c5d2ab094), [ee5cfbe](https://github.com/morluto/rea/commit/ee5cfbe05cd309a88003c711721e67a3bee36554)).
- **Bounded diagnostics:** Bound SDK validation messages and terminal normalization before allocation while retaining diagnostics and explicit unknown final output sizes. ([7fb0a0c](https://github.com/morluto/rea/commit/7fb0a0cc577f7c9033a2674d877d8242b5864556), [1d826f3](https://github.com/morluto/rea/commit/1d826f304f032acfe69dad3ff824b300aacaeb43)). Thanks @CRYPTONIKAV.

- **Windows artifact classification:** identify `.exe`, `.com`, `.bat` and `.cmd` artifacts as launchable host executables. ([#1823](https://github.com/morluto/rea/pull/1823), [#1824](https://github.com/morluto/rea/pull/1824), [issue morluto/rea#1819](https://github.com/morluto/rea/issues/1819)). Thanks @dollarsmoney, @JasonBuildAI, @kaoru0822-kitauji.

- **CLI/MCP delivery:** defer command-specific startup work, bundle runtime entries, retain field/input correction details across output formats and preserve shared optional-provider lifetime. MCP selectors, paging continuation and retained partial-error references remain explicit; session liveness/provider-attribution corrections retain their controlled-provider verification limits. ([#1691](https://github.com/morluto/rea/pull/1691), [issue morluto/rea#1685](https://github.com/morluto/rea/issues/1685), [#1705](https://github.com/morluto/rea/pull/1705), [issue morluto/rea#1695](https://github.com/morluto/rea/issues/1695), [#1755](https://github.com/morluto/rea/pull/1755), [issue morluto/rea#1746](https://github.com/morluto/rea/issues/1746), [#1773](https://github.com/morluto/rea/pull/1773), [issue morluto/rea#1771](https://github.com/morluto/rea/issues/1771), [#1780](https://github.com/morluto/rea/pull/1780), [#1814](https://github.com/morluto/rea/pull/1814), [#1910](https://github.com/morluto/rea/pull/1910), [issue morluto/rea#1849](https://github.com/morluto/rea/issues/1849), [#1996](https://github.com/morluto/rea/pull/1996), [#2140](https://github.com/morluto/rea/pull/2140), [issue morluto/rea#2135](https://github.com/morluto/rea/issues/2135), [#2205](https://github.com/morluto/rea/pull/2205), [issue morluto/rea#2195](https://github.com/morluto/rea/issues/2195), [#2230](https://github.com/morluto/rea/pull/2230), [issue morluto/rea#2180](https://github.com/morluto/rea/issues/2180), [#2294](https://github.com/morluto/rea/pull/2294), [#2482](https://github.com/morluto/rea/pull/2482), [a82d14e](https://github.com/morluto/rea/commit/a82d14e4db4dca989ffa2e7dbe78fd43551da256), [a4dd4e8](https://github.com/morluto/rea/commit/a4dd4e8e8700ce350e1a0c612ebd61b91ca5e585), [48c352b](https://github.com/morluto/rea/commit/48c352b6bfa34c820a530272cd36600158c37b1e), [07b36c1](https://github.com/morluto/rea/commit/07b36c148946f46b99a4ce04e55726e97d0ee03a), [570c40c](https://github.com/morluto/rea/commit/570c40cde55d31e455ef9bc484b7b908658ded58), [8fc2043](https://github.com/morluto/rea/commit/8fc2043eb8bcedbf34dce064f977e455438635d6), [7fc0b5e](https://github.com/morluto/rea/commit/7fc0b5ec9c2532bbf789d7783b7a0cab6fc054d8)). Thanks @369Apps, @chqcjq, @cold-atom, @coygeek, @JackOdegard, @kaoru0822-kitauji, @N0zoM1z0, @sx4im.
- **Evidence import/replay:** import bundles across session transitions while authenticating selected target and file identities, preserve literal keys, metadata/mutation intent and relationship coverage, and honor cancellation before session mutation. Reuse authenticated snapshots and comparisons within their owned lifetime; reject malformed/non-object snapshots and unsupported metadata without disguising uncertainty. ([#1694](https://github.com/morluto/rea/pull/1694), [#1716](https://github.com/morluto/rea/pull/1716), [issue morluto/rea#1680](https://github.com/morluto/rea/issues/1680), [#1721](https://github.com/morluto/rea/pull/1721), [issue morluto/rea#1718](https://github.com/morluto/rea/issues/1718), [#1733](https://github.com/morluto/rea/pull/1733), [issue morluto/rea#1723](https://github.com/morluto/rea/issues/1723), [issue morluto/rea#1724](https://github.com/morluto/rea/issues/1724), [#1776](https://github.com/morluto/rea/pull/1776), [#1873](https://github.com/morluto/rea/pull/1873), [#2001](https://github.com/morluto/rea/pull/2001), [#2013](https://github.com/morluto/rea/pull/2013), [issue morluto/rea#2009](https://github.com/morluto/rea/issues/2009), [#2083](https://github.com/morluto/rea/pull/2083), [#2303](https://github.com/morluto/rea/pull/2303), [#2685](https://github.com/morluto/rea/pull/2685), [issue morluto/rea#2675](https://github.com/morluto/rea/issues/2675), [c002b89](https://github.com/morluto/rea/commit/c002b89e2d8130a3c07e25e5fd604876be18c703), [9c85114](https://github.com/morluto/rea/commit/9c8511409c0706f9979c2b68dd56aaaf9f21e191), [aada0ca](https://github.com/morluto/rea/commit/aada0ca8126bf14c60750a4ccd4a79667770a1e4), [4a4d36f](https://github.com/morluto/rea/commit/4a4d36f881861bbab3c734b0dd459f805766caec), [1c64fe3](https://github.com/morluto/rea/commit/1c64fe3eff48679c6880f42d2f0a4af46686ade7), [6fb3a34](https://github.com/morluto/rea/commit/6fb3a345fe952b8e8f59221aec993acc37ccbf31), [3bcc68c](https://github.com/morluto/rea/commit/3bcc68c037e9415c78093cb286069c1fcca6a2f8), [6bae774](https://github.com/morluto/rea/commit/6bae774328724403255590aa2ddad4d7a2aa727f), [e997085](https://github.com/morluto/rea/commit/e9970855ba16ba711816ac30212c5ca17ae085cd), [d1dcebc](https://github.com/morluto/rea/commit/d1dcebce2c0820469ed63e33497a14258971b710), [b123b2e](https://github.com/morluto/rea/commit/b123b2e51cc7d6d2157525664be2df88fb1ba3bd), [049132a](https://github.com/morluto/rea/commit/049132ab43fa962d31774f2b258c15a71217148b), [042dcaa](https://github.com/morluto/rea/commit/042dcaa1ee66f1b8668f08b193f38ab01bceaacb), [acf75e6](https://github.com/morluto/rea/commit/acf75e6700ace28bb1db25e54e56673ac15e0ed3), [1f7f808](https://github.com/morluto/rea/commit/1f7f808c4f3bb5eca6b13bcc71d5cceb2ace6614), [26bffb9](https://github.com/morluto/rea/commit/26bffb94bf80355c35e22a98a8fc629c6210307e)). Thanks @coygeek, @DeryFerd, @jiangjiang248, @kaoru0822-kitauji, @khanukov, @N0zoM1z0, @NIU-123370, @rohitg00, @sx4im.
- **Ghidra setup and analysis:** preserve launcher/JVM diagnostics, Java-property and extension identity, stale-client recovery, UTF-8 bridge output and pending-startup progress. File-offset decompilation is Ghidra-specific; recorded coverage is Linux x64 with Ghidra 12.1.4. Startup/progress/compiler failure paths that use simulations remain unverified with a real engine. ([#1698](https://github.com/morluto/rea/pull/1698), [#1877](https://github.com/morluto/rea/pull/1877), [#1931](https://github.com/morluto/rea/pull/1931), [#2011](https://github.com/morluto/rea/pull/2011), [issue morluto/rea#1992](https://github.com/morluto/rea/issues/1992), [#2014](https://github.com/morluto/rea/pull/2014), [#2101](https://github.com/morluto/rea/pull/2101), [issue morluto/rea#2078](https://github.com/morluto/rea/issues/2078), [#2206](https://github.com/morluto/rea/pull/2206), [issue morluto/rea#2204](https://github.com/morluto/rea/issues/2204), [2187e16](https://github.com/morluto/rea/commit/2187e16f149a7a7b512a4cb45d5f468cc04091fe), [b953f96](https://github.com/morluto/rea/commit/b953f96c0aae27e1876c317a8f7db1d6f292b8ff)). Thanks @EDMND-SRC, @Ha1baraA11, @kaoru0822-kitauji, @lovecontroing, @lyly-bonbon, @N0zoM1z0, @nosmile99, @Petru101, @sx4im, @Zhong-fan.
- **Process and cleanup ownership:** retain private runtime/file owners and detailed incomplete-cleanup observations, bound trace cycles/order state, preserve caller paths, and use monotonic time for budgets while retaining wall dates. Windows affinity/admission ([#2202](https://github.com/morluto/rea/pull/2202), [issue morluto/rea#2181](https://github.com/morluto/rea/issues/2181)) and Bun memory-enforcement paths retain their recorded native-versus-controlled-fixture limits; these fixes are not a general process-ownership guarantee. ([#1700](https://github.com/morluto/rea/pull/1700), [issue morluto/rea#1697](https://github.com/morluto/rea/issues/1697), [#1730](https://github.com/morluto/rea/pull/1730), [#1756](https://github.com/morluto/rea/pull/1756), [issue morluto/rea#1753](https://github.com/morluto/rea/issues/1753), [#1760](https://github.com/morluto/rea/pull/1760), [issue morluto/rea#1757](https://github.com/morluto/rea/issues/1757), [#1826](https://github.com/morluto/rea/pull/1826), [#1907](https://github.com/morluto/rea/pull/1907), [issue morluto/rea#1856](https://github.com/morluto/rea/issues/1856), [#1999](https://github.com/morluto/rea/pull/1999), [issue morluto/rea#1993](https://github.com/morluto/rea/issues/1993), [#2232](https://github.com/morluto/rea/pull/2232), [issue morluto/rea#2170](https://github.com/morluto/rea/issues/2170), [#2252](https://github.com/morluto/rea/pull/2252), [issue morluto/rea#2218](https://github.com/morluto/rea/issues/2218), [#2467](https://github.com/morluto/rea/pull/2467), [issue morluto/rea#2257](https://github.com/morluto/rea/issues/2257), [#2468](https://github.com/morluto/rea/pull/2468), [#2488](https://github.com/morluto/rea/pull/2488), [09b6828](https://github.com/morluto/rea/commit/09b68285166bef2b7633402c8adf7eb25823b47e), [7285e15](https://github.com/morluto/rea/commit/7285e15839a4fecf9940683699b781a60ccc4775), [b5ededd](https://github.com/morluto/rea/commit/b5ededd0f9c28d0f696a205103066928117368ee), [d8c76b6](https://github.com/morluto/rea/commit/d8c76b629639bda4405afa9ae2f7676b694f2f10), [98d8470](https://github.com/morluto/rea/commit/98d8470d36cfbf7cd25820a4ed430aebae20c0c5), [c22111e](https://github.com/morluto/rea/commit/c22111eca2c4bc84a084f12711f405b3e7422a40), [cecc6ec](https://github.com/morluto/rea/commit/cecc6ecbffe84689a173d1634f342e046b0c8ceb), [10935b7](https://github.com/morluto/rea/commit/10935b7b1136accab2a43b308ab380749da0f7ae), [63e796d](https://github.com/morluto/rea/commit/63e796d50ea323ae8dcfef80f86c8154bb106790), [d9e9fb2](https://github.com/morluto/rea/commit/d9e9fb2273543caab4eb21d896c33d462ada6971), [9049dba](https://github.com/morluto/rea/commit/9049dbaf0c3df32357419f9899965df2b611f493), [ed881c6](https://github.com/morluto/rea/commit/ed881c6d2ef6a8adba0c2a241ebc9ab4603b7868)). Thanks @Ashen00001, @charan-rathore, @coygeek, @EDMND-SRC, @JasonBuildAI, @jimpablo, @kaoru0822-kitauji, @N0zoM1z0, @NIU-123370, @Rinkia, @rudycelekli, @sx4im, @xeropresence, @XiaoBinGan, @xthunder0, @hzh666kevin-hue.
- **Native image identity:** preserve universal Mach-O containers and selected slice/subtype identity, chained fixup locations and library ordinals, exact signing text, PE resource capacity and ELF/header framing. Mach-O summary selection and independent slice commands avoid unnecessary delivery/work. Controlled routing/parser fixtures do not establish every installed-provider path. ([#1703](https://github.com/morluto/rea/pull/1703), [issue morluto/rea#1702](https://github.com/morluto/rea/issues/1702), [#1708](https://github.com/morluto/rea/pull/1708), [#1709](https://github.com/morluto/rea/pull/1709), [#1713](https://github.com/morluto/rea/pull/1713), [#1772](https://github.com/morluto/rea/pull/1772), [issue morluto/rea#1765](https://github.com/morluto/rea/issues/1765), [#1784](https://github.com/morluto/rea/pull/1784), [issue morluto/rea#1775](https://github.com/morluto/rea/issues/1775), [#1982](https://github.com/morluto/rea/pull/1982), [#1995](https://github.com/morluto/rea/pull/1995), [issue morluto/rea#1990](https://github.com/morluto/rea/issues/1990), [#2040](https://github.com/morluto/rea/pull/2040), [#2107](https://github.com/morluto/rea/pull/2107), [#2161](https://github.com/morluto/rea/pull/2161), [issue morluto/rea#2105](https://github.com/morluto/rea/issues/2105), [#2248](https://github.com/morluto/rea/pull/2248), [issue morluto/rea#2176](https://github.com/morluto/rea/issues/2176), [#2281](https://github.com/morluto/rea/pull/2281), [issue morluto/rea#2274](https://github.com/morluto/rea/issues/2274), [#2292](https://github.com/morluto/rea/pull/2292), [#2466](https://github.com/morluto/rea/pull/2466), [#2506](https://github.com/morluto/rea/pull/2506), [#2733](https://github.com/morluto/rea/pull/2733), [issue morluto/rea#2661](https://github.com/morluto/rea/issues/2661), [f598bab](https://github.com/morluto/rea/commit/f598bab488e38c378d69346fa3c106f9e18529ed), [108b5f9](https://github.com/morluto/rea/commit/108b5f94254281639badd25b1f448cca35dc89a2), [f1924cf](https://github.com/morluto/rea/commit/f1924cf9c1910d5d29d11e7bf634b51af8d738cf), [8bd5ba2](https://github.com/morluto/rea/commit/8bd5ba2d234cbd9a5bb9dd5daeaa191c3a1cad24), [b38429c](https://github.com/morluto/rea/commit/b38429cb6a0de8f4bb5ae01633e24abe2d7cde46), [8d4d631](https://github.com/morluto/rea/commit/8d4d631606c701aac150cf009d3b80ae4a7ae7d5), [ac57c88](https://github.com/morluto/rea/commit/ac57c88efe64c3125850b54d3d833227e6b8ec51), [dc038d1](https://github.com/morluto/rea/commit/dc038d16bba9046afd28970de9c47f6259a43524), [34a4bb6](https://github.com/morluto/rea/commit/34a4bb6508006fa113463ef20ed799a2994e9ee8), [ebc22d9](https://github.com/morluto/rea/commit/ebc22d99d62225505c0a84f6e39823ba4ef2f829), [c02fb0e](https://github.com/morluto/rea/commit/c02fb0ea8055f98def2b12ad557aed0faefd3639)). Thanks @1NormalGuy, @Aliciawque, @baron, @coygeek, @dhl84, @hemanthrayuduu, @JasonBuildAI, @kaoru0822-kitauji, @N0zoM1z0, @thangldw, @viniciusdsandrade, @XiaoBinGan, @Zburgers.
- **Archive and artifact provenance:** keep physical ZIP occurrence identity, exact signatures/names and partial inventory coverage; bound decompression and reject malformed keys/integers. Directory/ASAR/DMG reads retain ownership through cleanup and publication cancellation. Duplicate ZIP names remain explicitly ambiguous where the public projection cannot represent them; synthetic archive/cleanup cases do not prove every real Unblob or DMG failure path. ([#1726](https://github.com/morluto/rea/pull/1726), [issue morluto/rea#1725](https://github.com/morluto/rea/issues/1725), [#1854](https://github.com/morluto/rea/pull/1854), [issue morluto/rea#1844](https://github.com/morluto/rea/issues/1844), [#1865](https://github.com/morluto/rea/pull/1865), [issue morluto/rea#1860](https://github.com/morluto/rea/issues/1860), [#2069](https://github.com/morluto/rea/pull/2069), [#2106](https://github.com/morluto/rea/pull/2106), [#2144](https://github.com/morluto/rea/pull/2144), [#2365](https://github.com/morluto/rea/pull/2365), [#2493](https://github.com/morluto/rea/pull/2493), [918713a](https://github.com/morluto/rea/commit/918713af376e307ecf24d75e6a0dd9d1b544545b), [eb97da3](https://github.com/morluto/rea/commit/eb97da33881e3d1472d97a7d788ee35944fb6b07), [2260887](https://github.com/morluto/rea/commit/2260887f2092be6a3d9c79509e4ae4a3e52fce7f), [74d7da6](https://github.com/morluto/rea/commit/74d7da6ced0f869936ee0316b00616931b088066), [ed485a3](https://github.com/morluto/rea/commit/ed485a3dc8cc3a4baf8cabe01acb7aa0490b73b3), [921bb95](https://github.com/morluto/rea/commit/921bb9575505065f6cfd57b14d97d80d0f238546), [d8ceb3f](https://github.com/morluto/rea/commit/d8ceb3f276a65c181b146f68c0729ff4b6f9fa61), [9435c7a](https://github.com/morluto/rea/commit/9435c7aae279ba184937c0dfeb713fd574ba3f29), [bb54082](https://github.com/morluto/rea/commit/bb540826d65316c164d2de8ba4ef10f81a8ad073), [a73a55f](https://github.com/morluto/rea/commit/a73a55f53cc2b2e5b7618effe6ecb5cee6e0cee2), [3c57e1a](https://github.com/morluto/rea/commit/3c57e1a8b21b379fca55032d177078e1d8426e64), [ec0b081](https://github.com/morluto/rea/commit/ec0b081371f118e6e5e042fbef3479359c672ddb), [e7882b3](https://github.com/morluto/rea/commit/e7882b34f4ac4a26f903c5f49264acc2c19bb562), [b955b82](https://github.com/morluto/rea/commit/b955b825fc002a4bb408f2910b78768c566c2cd1)). Thanks @1052326311, @1NormalGuy, @baron, @Bortlesboat, @Chaoqi31, @DeryFerd, @kaoru0822-kitauji, @N0zoM1z0, @XiaoBinGan.
- **Setup/uninstall recovery:** preserve unrelated YAML text, caller-selected roots, symlinked data and existing recovery snapshots; explain malformed configuration shapes and retain failed rollback/cleanup owners. Show terminal dry-run plans and each selected skill location. Bunx registration and fault-injected recovery cases remain simulated rather than live-client verification. ([#1731](https://github.com/morluto/rea/pull/1731), [#1754](https://github.com/morluto/rea/pull/1754), [#1821](https://github.com/morluto/rea/pull/1821), [issue morluto/rea#1816](https://github.com/morluto/rea/issues/1816), [#1983](https://github.com/morluto/rea/pull/1983), [#2118](https://github.com/morluto/rea/pull/2118), [issue morluto/rea#2111](https://github.com/morluto/rea/issues/2111), [#2154](https://github.com/morluto/rea/pull/2154), [issue morluto/rea#2152](https://github.com/morluto/rea/issues/2152), [#2157](https://github.com/morluto/rea/pull/2157), [#2182](https://github.com/morluto/rea/pull/2182), [issue morluto/rea#2159](https://github.com/morluto/rea/issues/2159), [#2481](https://github.com/morluto/rea/pull/2481), [bb50813](https://github.com/morluto/rea/commit/bb508134efbba392a404b651d6ec05be8b7eac1e), [c240768](https://github.com/morluto/rea/commit/c2407689cb04df082e8db0b6afa8f8d022f6bcd1), [dcfc5d4](https://github.com/morluto/rea/commit/dcfc5d403ac997c2b08bee4753e57a1a4a8a8538), [21eff3b](https://github.com/morluto/rea/commit/21eff3bae10f58711a35ad44f86e9f96f9bb4790), [94153f1](https://github.com/morluto/rea/commit/94153f1c757e07a6d092e00903aa8b125d4a0afa), [2397137](https://github.com/morluto/rea/commit/23971376158e7815edcbe6c04a8df7c9504650dc), [c339f9e](https://github.com/morluto/rea/commit/c339f9ebe7bd1f30608d6ccb7175da523dd3c485), [f6775a3](https://github.com/morluto/rea/commit/f6775a36694a6a9c620f4248638e8056a6cbcb66)). Thanks @BeqaKs, @Jax367, @kaoru0822-kitauji, @NIU-123370, @shoyann, @viniciusdsandrade, @xeropresence, @zaydiscold.
- **Bun updates:** locate global installations before changing directories and reuse parsed client activation during maintenance. The update flow is covered with package-manager/filesystem simulations; a real Bun global installation update remains unverified. ([#1735](https://github.com/morluto/rea/pull/1735), [e90acae](https://github.com/morluto/rea/commit/e90acaea674f5f7f9f17ea472104afdc1422ada6), [b045df1](https://github.com/morluto/rea/commit/b045df100e1489e08a36d6ff04cea7feecf1332c)). Thanks @xeropresence.
- **JavaScript relationships:** preserve loader-specific package/TypeScript/CommonJS boundaries, exact file-URL and source-map identity, Electron intrinsic receivers/IPC guards and chunk metadata. Index repeated lookups and retain completed facts through resource limits and cancellation. Real Electron integration, Bun worker integration and failure-path cleanup remain unverified where the recorded lanes use fixtures. ([#1740](https://github.com/morluto/rea/pull/1740), [#1759](https://github.com/morluto/rea/pull/1759), [issue morluto/rea#1748](https://github.com/morluto/rea/issues/1748), [#1762](https://github.com/morluto/rea/pull/1762), [issue morluto/rea#1761](https://github.com/morluto/rea/issues/1761), [#1767](https://github.com/morluto/rea/pull/1767), [#1788](https://github.com/morluto/rea/pull/1788), [issue morluto/rea#1781](https://github.com/morluto/rea/issues/1781), [issue morluto/rea#1782](https://github.com/morluto/rea/issues/1782), [#1789](https://github.com/morluto/rea/pull/1789), [#1799](https://github.com/morluto/rea/pull/1799), [issue morluto/rea#1793](https://github.com/morluto/rea/issues/1793), [#1827](https://github.com/morluto/rea/pull/1827), [issue morluto/rea#1802](https://github.com/morluto/rea/issues/1802), [#1833](https://github.com/morluto/rea/pull/1833), [issue morluto/rea#1831](https://github.com/morluto/rea/issues/1831), [#1857](https://github.com/morluto/rea/pull/1857), [issue morluto/rea#1842](https://github.com/morluto/rea/issues/1842), [#1871](https://github.com/morluto/rea/pull/1871), [#1874](https://github.com/morluto/rea/pull/1874), [#1905](https://github.com/morluto/rea/pull/1905), [#1912](https://github.com/morluto/rea/pull/1912), [issue morluto/rea#1909](https://github.com/morluto/rea/issues/1909), [#1915](https://github.com/morluto/rea/pull/1915), [issue morluto/rea#1911](https://github.com/morluto/rea/issues/1911), [#1916](https://github.com/morluto/rea/pull/1916), [#1921](https://github.com/morluto/rea/pull/1921), [#1934](https://github.com/morluto/rea/pull/1934), [#1939](https://github.com/morluto/rea/pull/1939), [issue morluto/rea#1881](https://github.com/morluto/rea/issues/1881), [issue morluto/rea#1882](https://github.com/morluto/rea/issues/1882), [issue morluto/rea#1883](https://github.com/morluto/rea/issues/1883), [#1941](https://github.com/morluto/rea/pull/1941), [#2062](https://github.com/morluto/rea/pull/2062), [issue morluto/rea#2058](https://github.com/morluto/rea/issues/2058), [#2104](https://github.com/morluto/rea/pull/2104), [#2422](https://github.com/morluto/rea/pull/2422), [#2475](https://github.com/morluto/rea/pull/2475), [#2737](https://github.com/morluto/rea/pull/2737), [issue morluto/rea#2663](https://github.com/morluto/rea/issues/2663), [d3088c3](https://github.com/morluto/rea/commit/d3088c3795f6c37cb3b6aec0bb0c371dd0640ee8), [1dfb933](https://github.com/morluto/rea/commit/1dfb933e47db0156cf1cb61f28715b81e740c57b), [f8513a4](https://github.com/morluto/rea/commit/f8513a42dc44451a621127f06edde5d38bc93f69), [b8fab74](https://github.com/morluto/rea/commit/b8fab7429771bb17a7ca0297661de3c9935212af), [42b0ed1](https://github.com/morluto/rea/commit/42b0ed126df7d5b908ac369715378d5e519051b7), [c0904b4](https://github.com/morluto/rea/commit/c0904b4c1aabfccf2f0ab12f44960a0a1fbbbfae), [9f67e44](https://github.com/morluto/rea/commit/9f67e44e5d451d705bae9a579ad9802d5c9f097c), [e4532b5](https://github.com/morluto/rea/commit/e4532b537663026c3e5b784380eecd009c959a36), [1c37914](https://github.com/morluto/rea/commit/1c37914306b3ff257d7a0360f11c9bf2a3f2cac7), [5ab0cbb](https://github.com/morluto/rea/commit/5ab0cbb48ea5a4f11542eac44479b9af48f1dabd), [b7169c8](https://github.com/morluto/rea/commit/b7169c8b747cbc032913b31f008a3b81c77b6219), [f43fc02](https://github.com/morluto/rea/commit/f43fc0247527aebb8efc7d9db04276fe2d489323), [3ae826c](https://github.com/morluto/rea/commit/3ae826ceba6f25b08bce50bcb51001209bc16b57), [1b95302](https://github.com/morluto/rea/commit/1b953021eadf4cac09e20be388d79536903633b3), [eaa9616](https://github.com/morluto/rea/commit/eaa961658578522cecfbba7c7be1acf1c64da65a), [c923fb0](https://github.com/morluto/rea/commit/c923fb0dc9462e302b84a15770131ff899f89455), [c7a890d](https://github.com/morluto/rea/commit/c7a890d12987d9b2d496119c1fbf1a88c0fc298e)). Thanks @Aurantium-47, @baron, @chqcjq, @coygeek, @cyanseek, @fengdwx, @flitzrrr, @immanuwell, @kaoru0822-kitauji, @N0zoM1z0, @Nelglor, @ranmori, @rudycelekli, @shoyann, @xu91102.
- **Browser observations:** preserve effective source-map URLs, empty query/fragment identity, response-body provenance, service-worker policies and explicit uncertainty for malformed events. Bound discovery lifetimes and retain cleanup ownership. Interrupt/retry/failure cases validated with controlled CDP/session fixtures do not establish those paths in real Chromium. ([#1742](https://github.com/morluto/rea/pull/1742), [issue morluto/rea#1729](https://github.com/morluto/rea/issues/1729), [#1829](https://github.com/morluto/rea/pull/1829), [#2074](https://github.com/morluto/rea/pull/2074), [#2099](https://github.com/morluto/rea/pull/2099), [#2239](https://github.com/morluto/rea/pull/2239), [issue morluto/rea#2169](https://github.com/morluto/rea/issues/2169), [#2477](https://github.com/morluto/rea/pull/2477), [486b567](https://github.com/morluto/rea/commit/486b56724c4eaba50719177bcb9eae84d6907297), [a82e37c](https://github.com/morluto/rea/commit/a82e37c8065cc200a0ca3e14e7c4f85e4e468580), [a8d4984](https://github.com/morluto/rea/commit/a8d4984404b611e60b88bc42289c0ba07eee4578), [966f7cc](https://github.com/morluto/rea/commit/966f7cc84b4a8bb0043641cb64d7a7aaf8715e05), [221c856](https://github.com/morluto/rea/commit/221c85648108e9846d9920b0964dafa7f108d581), [951b095](https://github.com/morluto/rea/commit/951b095e11adf9faa9c4a27e212260060aa6b095), [f09bb8a](https://github.com/morluto/rea/commit/f09bb8a99773f79c7306b8799c86f856fe2c0d4b), [6bd2b28](https://github.com/morluto/rea/commit/6bd2b28161411f70ed5dc72e42c2736a1aab758b)). Thanks @1052326311, @chAng-L19, @chqcjq, @coygeek, @evenafterallisaid, @fisforfaheem, @itsF4LCON, @N0zoM1z0, @shayanxcyber.
- **Managed metadata/CIL:** preserve ExportedType and pointer-table ownership, generic/array/function-pointer/modifier signatures, ReadyToRun host identity, metadata ExtraData and signed zero. Charge retained facts and decoded instruction counts instead of broad decoding bounds; malformed layouts remain caller input errors. ([#1743](https://github.com/morluto/rea/pull/1743), [issue morluto/rea#1736](https://github.com/morluto/rea/issues/1736), [#1768](https://github.com/morluto/rea/pull/1768), [#1822](https://github.com/morluto/rea/pull/1822), [issue morluto/rea#1801](https://github.com/morluto/rea/issues/1801), [#1828](https://github.com/morluto/rea/pull/1828), [issue morluto/rea#1812](https://github.com/morluto/rea/issues/1812), [#1835](https://github.com/morluto/rea/pull/1835), [issue morluto/rea#1832](https://github.com/morluto/rea/issues/1832), [#1886](https://github.com/morluto/rea/pull/1886), [#1893](https://github.com/morluto/rea/pull/1893), [#1897](https://github.com/morluto/rea/pull/1897), [issue morluto/rea#1878](https://github.com/morluto/rea/issues/1878), [#1943](https://github.com/morluto/rea/pull/1943), [issue morluto/rea#1940](https://github.com/morluto/rea/issues/1940), [#1985](https://github.com/morluto/rea/pull/1985), [#2194](https://github.com/morluto/rea/pull/2194), [issue morluto/rea#2191](https://github.com/morluto/rea/issues/2191), [#2437](https://github.com/morluto/rea/pull/2437), [52e76c5](https://github.com/morluto/rea/commit/52e76c5d39b58d1685bb5e22bd40d19524dfa2cb)). Thanks @ac1982, @chqcjq, @fisHarly0, @flitzrrr, @JasonBuildAI, @JayOfTheKeyboard, @jhuang-tw, @kaoru0822-kitauji, @N0zoM1z0, @Nelglor.
- **Hopper failure ownership:** preserve startup/process outcomes, retain cleanup leases across one-shot failures, wait for late bridges, and stop owned Linux demo children when their REA owner exits. Denied/crashed/late-bridge/queued-request failure paths use simulated process or bridge fixtures; they are not fresh installed-Hopper verification. ([#1763](https://github.com/morluto/rea/pull/1763), [issue morluto/rea#1751](https://github.com/morluto/rea/issues/1751), [#1817](https://github.com/morluto/rea/pull/1817), [#1866](https://github.com/morluto/rea/pull/1866), [#1927](https://github.com/morluto/rea/pull/1927), [#2474](https://github.com/morluto/rea/pull/2474), [#2499](https://github.com/morluto/rea/pull/2499), [issue morluto/rea#2459](https://github.com/morluto/rea/issues/2459)). Thanks @coygeek, @Joshwong1908, @kaoru0822-kitauji, @N0zoM1z0, @rudycelekli.
- **IDA session boundaries:** retain non-x86 call coverage and unresolved-procedure uncertainty, and bound private universal-Mach-O inputs to the exact selected slice. Transient headless busy recovery was exercised on macOS arm64 IDA Pro 9.1; Linux headless, attached GUI navigation and worker-reaped cleanup paths retain their documented verification gaps. ([#1764](https://github.com/morluto/rea/pull/1764), [issue morluto/rea#1712](https://github.com/morluto/rea/issues/1712), [#1778](https://github.com/morluto/rea/pull/1778), [issue morluto/rea#1766](https://github.com/morluto/rea/issues/1766), [#1785](https://github.com/morluto/rea/pull/1785), [issue morluto/rea#1769](https://github.com/morluto/rea/issues/1769), [#1906](https://github.com/morluto/rea/pull/1906), [issue morluto/rea#1794](https://github.com/morluto/rea/issues/1794), [#2201](https://github.com/morluto/rea/pull/2201), [issue morluto/rea#2139](https://github.com/morluto/rea/issues/2139), [#2291](https://github.com/morluto/rea/pull/2291), [issue morluto/rea#2285](https://github.com/morluto/rea/issues/2285), [#2324](https://github.com/morluto/rea/pull/2324), [12fa8fd](https://github.com/morluto/rea/commit/12fa8fd9f986dbd4ff58165c3ec71a46dc8a8a3b)). Thanks @akushonkamen, @coygeek, @kaoru0822-kitauji, @N0zoM1z0, @nikolay-dementiev, @zecaro.
- **Input and capability diagnostics:** identify invalid paths, format refusals, missing host tools and non-retryable errors without losing caller selections or retryable capability facts. Foreign execution/device mutation annotations remain destructive, analysis-target text is untrusted, and output ordering follows code points rather than host locale. ([#1770](https://github.com/morluto/rea/pull/1770), [#1867](https://github.com/morluto/rea/pull/1867), [#1869](https://github.com/morluto/rea/pull/1869), [issue morluto/rea#1855](https://github.com/morluto/rea/issues/1855), [#1872](https://github.com/morluto/rea/pull/1872), [#1879](https://github.com/morluto/rea/pull/1879), [issue morluto/rea#1853](https://github.com/morluto/rea/issues/1853), [#1899](https://github.com/morluto/rea/pull/1899), [#1902](https://github.com/morluto/rea/pull/1902), [#1904](https://github.com/morluto/rea/pull/1904), [#1908](https://github.com/morluto/rea/pull/1908), [#1925](https://github.com/morluto/rea/pull/1925), [#1987](https://github.com/morluto/rea/pull/1987), [issue morluto/rea#1979](https://github.com/morluto/rea/issues/1979), [#2004](https://github.com/morluto/rea/pull/2004), [issue morluto/rea#2002](https://github.com/morluto/rea/issues/2002), [#2026](https://github.com/morluto/rea/pull/2026), [#2091](https://github.com/morluto/rea/pull/2091), [#2133](https://github.com/morluto/rea/pull/2133), [issue morluto/rea#2129](https://github.com/morluto/rea/issues/2129), [#2145](https://github.com/morluto/rea/pull/2145), [issue morluto/rea#2143](https://github.com/morluto/rea/issues/2143), [#2472](https://github.com/morluto/rea/pull/2472), [#2478](https://github.com/morluto/rea/pull/2478), [issue morluto/rea#2454](https://github.com/morluto/rea/issues/2454), [#2494](https://github.com/morluto/rea/pull/2494), [#2507](https://github.com/morluto/rea/pull/2507), [#2509](https://github.com/morluto/rea/pull/2509), [#2708](https://github.com/morluto/rea/pull/2708), [3d83135](https://github.com/morluto/rea/commit/3d8313598785359c424d7305f503cb69fc8639a6), [c9fed50](https://github.com/morluto/rea/commit/c9fed50691ae014890e91a72534773d2fb58ce44), [8b18171](https://github.com/morluto/rea/commit/8b181716aca2cb467be499cba226abfb5ae19141), [7a2cd1e](https://github.com/morluto/rea/commit/7a2cd1ea0a63e8c44166860b7ee9c7a1aa43492b)). Thanks @astralyx0129, @CassieFox23, @DeryFerd, @dollarsmoney, @fisforfaheem, @flitzrrr, @Ha1baraA11, @jimpablo, @kaoru0822-kitauji, @larinyo, @N0zoM1z0, @rudycelekli, @SII-YDD, @viniciusdsandrade, @XiaoBinGan.
- **Android analysis:** retain decoded values, duplicate-class inventories and executable static initializers, reject malformed JADX UTF-8, and keep inline search provenance. Apktool accepts `--no-strings` and explains host requirements. Windows batch-launcher selection also resolves PATH/PATHEXT before choosing its launch mode. Recorded Apktool coverage is Linux/OpenJDK, and changed JADX/batch failure paths do not establish native Windows behavior. ([#1777](https://github.com/morluto/rea/pull/1777), [issue morluto/rea#1774](https://github.com/morluto/rea/issues/1774), [#1876](https://github.com/morluto/rea/pull/1876), [issue morluto/rea#1846](https://github.com/morluto/rea/issues/1846), [#1890](https://github.com/morluto/rea/pull/1890), [issue morluto/rea#1850](https://github.com/morluto/rea/issues/1850), [#1946](https://github.com/morluto/rea/pull/1946), [issue morluto/rea#1945](https://github.com/morluto/rea/issues/1945), [#2707](https://github.com/morluto/rea/pull/2707), [issue morluto/rea#2672](https://github.com/morluto/rea/issues/2672), [0677468](https://github.com/morluto/rea/commit/0677468877465c8dfbe25c72f142a7b5bc8a3212), [fe8d0bd](https://github.com/morluto/rea/commit/fe8d0bdd36fe12bc0836468d1a702a34fbdc219b), [#2802](https://github.com/morluto/rea/pull/2802)). Thanks @akushonkamen, @coygeek, @HeadmasterEggy, @kaoru0822-kitauji, @N0zoM1z0, @psipher.
- **ADB acquisition:** preserve device paths and directory identity, prevent host destination collisions/overwrites, count UTF-8 logcat bytes and restricted permissions, and evaluate the complete Activity Manager start report. Launch attempts, status, activity and raw failure output remain observations; real-device timeout/mixed-report and Android 8 directory-read paths remain unverified beyond the documented fixtures. ([#1962](https://github.com/morluto/rea/pull/1962), [#2212](https://github.com/morluto/rea/pull/2212), [issue morluto/rea#2175](https://github.com/morluto/rea/issues/2175), [#2221](https://github.com/morluto/rea/pull/2221), [issue morluto/rea#2220](https://github.com/morluto/rea/issues/2220), [#2359](https://github.com/morluto/rea/pull/2359), [c42232f](https://github.com/morluto/rea/commit/c42232f566d55fe7191763649755148c768eef9f), [55b6148](https://github.com/morluto/rea/commit/55b61485e9f7568b69597eef8696ff6abfe53cfd), [3bdc873](https://github.com/morluto/rea/commit/3bdc8730bd98e073522bcb8ba86527be402c0cbe), [c89972c](https://github.com/morluto/rea/commit/c89972c8777d0114566fe76a060849a18bdd2659), [e1cd292](https://github.com/morluto/rea/commit/e1cd292aa6e8f5f13441d408c66126782c8dbb0d)). Thanks @coygeek, @dakjdakd, @DeryFerd, @huiq777, @sx4im.
- **WASM names and diagnostics:** preserve debug/custom-section names including NUL and leading BOM, accept unpadded WABT section rows, and avoid irrelevant tool-remediation advice on unrelated runtime-root failures. ([#1963](https://github.com/morluto/rea/pull/1963), [issue morluto/rea#1956](https://github.com/morluto/rea/issues/1956), [#1967](https://github.com/morluto/rea/pull/1967), [#1981](https://github.com/morluto/rea/pull/1981), [#2084](https://github.com/morluto/rea/pull/2084), [#2102](https://github.com/morluto/rea/pull/2102)). Thanks @1052326311, @bugstan, @N0zoM1z0, @sathariels, @STiFLeR7, @viniciusdsandrade.

- **Source-map and path handling:** retain source-map entries when embedded-content counts differ or an optional `sourceMappingURL` is used, and keep `file:` URLs out of operator-relative path resolution. ([#2873](https://github.com/morluto/rea/pull/2873), [#2886](https://github.com/morluto/rea/pull/2886), [#2882](https://github.com/morluto/rea/pull/2882), [issue morluto/rea#2821](https://github.com/morluto/rea/issues/2821), [issue morluto/rea#2883](https://github.com/morluto/rea/issues/2883), [issue morluto/rea#2577](https://github.com/morluto/rea/issues/2577)). Thanks @JFSAS, @rileygramlich, @shoyann, @shubhamahuja9999, @coygeek.
- **Native metadata:** accept declared facts in native dispatch inventories and share native verification input diagnostics. ([#2906](https://github.com/morluto/rea/pull/2906), [#2901](https://github.com/morluto/rea/pull/2901), [issue morluto/rea#2564](https://github.com/morluto/rea/issues/2564), [issue morluto/rea#2621](https://github.com/morluto/rea/issues/2621)). Thanks @ShitK, @coygeek.

### ⚠ BREAKING CHANGES

- **Runtime attachment state:** `attached` may be `null` in JavaScript, browser and Electron discovery/inspection results. Treat null as unknown; do not coerce it to false. ([e55ef72](https://github.com/morluto/rea/commit/e55ef7213515ba204c3d88a4487b4ee6a2773b06)).
- **Source maps:** original-source and mapping rows preserve a null source name when unavailable. Handle null explicitly instead of expecting an invented unknown-source string; new index fields remain optional when reading older Evidence. ([ee50ed1](https://github.com/morluto/rea/commit/ee50ed121e38cc6e1a2ff0dc8b789f15f71c5402)).
- **Streamed filtered JSON:** `--filter-output` now emits JSON `null` instead of `{}` when the selected value is null; consumers must distinguish a present null from a missing selection. Use `--full-output` when an object envelope is required. ([#2333](https://github.com/morluto/rea/pull/2333)). Thanks @Jackmeson1.
- **Call graphs:** `get_call_graph.normalized_result` is now `{ graph, limitations }`; read traversal-depth groups under `graph` and retain relationship-specific caveats. Contract/fixture validation does not establish new Ghidra or IDA engine coverage. ([5dfb9d0](https://github.com/morluto/rea/commit/5dfb9d050c2cc44a61b183dae765bef4d22a53b7)).
- **MCP discovery:** `binary_session` no longer repeats `server_identity.catalog.tools`. Use the connected server tool list, grouped `tool_availability` and provider capabilities; see [MCP contracts](docs/mcp-contracts.md). Origin: [6395e8d](https://github.com/morluto/rea/commit/6395e8d3007d5ee453477460e7ee1c51cff76be0). ([#1988](https://github.com/morluto/rea/pull/1988)). Thanks @kaoru0822-kitauji, @N0zoM1z0.

- **Provider admission:** MIPS targets with unresolved GNU ABI attributes are refused. Supply supported ABI declarations. Saved Hopper databases on macOS are unavailable because the launcher cannot run the analysis bridge when opening a database; select an executable target instead. Database support requires a script-capable database launch route. ([d4bd65c](https://github.com/morluto/rea/commit/d4bd65c53c0254d0195cc7ab8da163dcadfd3b9b)).
- **Segment extents:** `binary_overview` segment length may be null when Hopper coordinates cannot establish a finite extent in one address space. Preserve unknown rather than converting it to zero or a saturated value. ([36db19c](https://github.com/morluto/rea/commit/36db19c59)).
- **Invocation identity:** `server.command_path` may be null, and registration/setup statuses or doctor classifications may be unknown. Preserve these states and establish the actual invocation before treating a registration as aligned. ([187f113](https://github.com/morluto/rea/commit/187f113f7)). Thanks @hemv-857, @qorvr.
- **ADB installation:** the optional `replace` input is unchanged. Results now require `replace_requested` to record the requested `adb install -r` mode; `replaced` is nullable because prior device package state was not observed. Update result readers to accept null instead of treating reinstall intent as proof of replacement. ([864314a](https://github.com/morluto/rea/commit/864314ac857924a7e6e65bfb37e8dc720fcc21e7)).
- **Managed/native verification:** unresolved P/Invoke results may retain `matched_native` and candidate facts when module identity is unknown. Interpret `status`, `basis` and `limitations`; `module-identity-unknown` does not verify correspondence, and unresolved no longer implies empty observations. ([3f6b575](https://github.com/morluto/rea/commit/3f6b5755b3e699bd9373641acffe0f2c5d2ab094)).

Full contribution record: [893 commits and 529 merged PRs](https://github.com/morluto/rea/blob/rea-agents-6.5.0/docs/releases/6.5.0.contributions.json).


## [6.4.0](https://github.com/morluto/rea/compare/rea-agents-6.3.0...rea-agents-6.4.0) (2026-10-11)

### Highlights

- Android: added device inspection, split-APK acquisition, logs, screenshots, file transfers and explicit app lifecycle actions through ADB, plus manifest and localized-string decoding with Apktool. ([#1552](https://github.com/morluto/rea/pull/1552), [#1556](https://github.com/morluto/rea/pull/1556)) Thanks @3QL.
- JEB: browse project units and decompile selected items through a caller-started local JEB MCP server. ([#1536](https://github.com/morluto/rea/pull/1536)) Thanks @3QL.
- Large analyses: discover retained Evidence without loading every payload, and inspect JavaScript graphs, binary layouts and function dossiers through summaries and selected views. ([#1682](https://github.com/morluto/rea/pull/1682), [#1568](https://github.com/morluto/rea/pull/1568), [#1570](https://github.com/morluto/rea/pull/1570), [#1345](https://github.com/morluto/rea/pull/1345), [#1507](https://github.com/morluto/rea/pull/1507), [#1247](https://github.com/morluto/rea/issues/1247)) Thanks @jhuang-tw, @kaoru0822-kitauji, @N0zoM1z0.
- JavaScript: isolate source analysis in an owned process with configurable heap and timeout limits; retain completed facts and explicit unknowns when analysis runs out of resources. ([#1651](https://github.com/morluto/rea/pull/1651), [#1563](https://github.com/morluto/rea/issues/1563), [#1565](https://github.com/morluto/rea/issues/1565)) Thanks @N0zoM1z0, @peter-research.
- Ghidra: configure import language/compiler specifications and seed functions, code and labels before auto-analysis. ([#1667](https://github.com/morluto/rea/pull/1667)) Thanks @sqmagellan.
- RPC discovery: recognize supported tRPC calls, HTTP-link URLs and named GraphQL operations in JavaScript applications and web bundles. ([#1670](https://github.com/morluto/rea/pull/1670)) Thanks @pompiliodonatoapp.

### Changes

- Added Ghidra support for Windows PE DLLs and bounded MIPS ELF analysis, including carved MIPS inputs with incomplete section tables. Windows P0 remains read-only. ([#1303](https://github.com/morluto/rea/pull/1303), [#1362](https://github.com/morluto/rea/pull/1362), [#1629](https://github.com/morluto/rea/pull/1629), [#1290](https://github.com/morluto/rea/issues/1290), [#718](https://github.com/morluto/rea/issues/718), [#1619](https://github.com/morluto/rea/issues/1619)) Thanks @bqw371, @jaelliot, @kvalls, @N0zoM1z0.
- Enabled `set_address_name` and `set_addresses_names` for Ghidra sessions with mutation authority, including namespace-aware data labels and per-address batch results. ([#1635](https://github.com/morluto/rea/pull/1635), [#1634](https://github.com/morluto/rea/issues/1634)) Thanks @giri256.
- Recovered additional signed AArch64 relative jump-table patterns. ([#1592](https://github.com/morluto/rea/pull/1592)) Thanks @RishTheFish21.
- Added PE resource inspection and read-only NativeAOT metadata parsing for supported x64 PE32+/.NET 8 RTR 9.1 inputs. The NativeAOT parser’s Windows-host Ghidra workflow remains unverified on a real Windows host. ([#1482](https://github.com/morluto/rea/pull/1482), [76d8f68](https://github.com/morluto/rea/commit/76d8f68cb918dfb43869f2b649a0b6c0c1cf266d), [#1254](https://github.com/morluto/rea/issues/1254)) Thanks @N0zoM1z0, @thangldw.
- Added Pi, Hermes and Qwen Code setup, including Hermes active-profile support. ([#1376](https://github.com/morluto/rea/pull/1376), [#1403](https://github.com/morluto/rea/pull/1403), [#1415](https://github.com/morluto/rea/pull/1415), [#1409](https://github.com/morluto/rea/issues/1409)) Thanks @rasatpetabit, @yiliang114, @zaydiscold.
- Added `REA_MCP_INPUT_SCHEMA_PROFILE=compact` for size-capped MCP clients such as Kimi/Moonshot, while retaining canonical runtime validation. ([#1514](https://github.com/morluto/rea/pull/1514), [#1580](https://github.com/morluto/rea/pull/1580), [#1484](https://github.com/morluto/rea/issues/1484), [#1581](https://github.com/morluto/rea/issues/1581)) Thanks @haythemsellami, @N0zoM1z0.
- Added live process-capture progress and optional `finalization_ms` to capture shutdown output before timeout escalation; cancellation remains immediate. ([#1483](https://github.com/morluto/rea/pull/1483), [#1583](https://github.com/morluto/rea/pull/1583), [#1252](https://github.com/morluto/rea/issues/1252), [#1253](https://github.com/morluto/rea/issues/1253), [modelcontextprotocol/typescript-sdk#2997](https://github.com/modelcontextprotocol/typescript-sdk/issues/2997)) Thanks @N0zoM1z0, @nikolay-dementiev, @sathariels.
- Improved Codex onboarding and recovery from observed client, PATH and provider blockers. ([#1613](https://github.com/morluto/rea/pull/1613)) Thanks @N0zoM1z0.
- Reduced redirected JSON and terminal output size, and deferred heavy imports until their commands need them. ([#1413](https://github.com/morluto/rea/pull/1413), [#1450](https://github.com/morluto/rea/pull/1450), [#1439](https://github.com/morluto/rea/pull/1439), [21dbcf7](https://github.com/morluto/rea/commit/21dbcf7a1458219989ad291e44ce7d017378b727)) Thanks @kaoru0822-kitauji.

### Fixes

- Electron analysis: follow renamed and default-imported APIs and optional calls, ignore overwritten identities and media preload attributes, and resolve packaged `app.asar` pages and unpacked companions. ([#1391](https://github.com/morluto/rea/pull/1391), [#1393](https://github.com/morluto/rea/pull/1393), [#1400](https://github.com/morluto/rea/pull/1400), [#1664](https://github.com/morluto/rea/pull/1664), [#1673](https://github.com/morluto/rea/pull/1673)) Thanks @kaoru0822-kitauji, @marnixpluim, @N0zoM1z0, @suninrain086.
- JavaScript data flow: preserve returned/yielded reference uncertainty, invalidate property-stored aliases correctly, and retain bundled-module runtime scope. ([#1437](https://github.com/morluto/rea/pull/1437), [#1445](https://github.com/morluto/rea/pull/1445), [#1471](https://github.com/morluto/rea/pull/1471), [#1577](https://github.com/morluto/rea/pull/1577), [#1428](https://github.com/morluto/rea/issues/1428), [#1442](https://github.com/morluto/rea/issues/1442), [#1449](https://github.com/morluto/rea/issues/1449), [#1576](https://github.com/morluto/rea/issues/1576)) Thanks @CassieFox23, @dakjdakd, @N0zoM1z0.
- JavaScript packages: resolve exact exports subpaths, preserve trailing-slash directory requests and exact CommonJS keys, and respect shadowed `require` bindings. ([#1424](https://github.com/morluto/rea/pull/1424), [#1615](https://github.com/morluto/rea/pull/1615), [5485483](https://github.com/morluto/rea/commit/5485483f7da2f6cb66441bb784aaf2a1a5f8731a), [8b2f851](https://github.com/morluto/rea/commit/8b2f8514c50e469c3add8ce9ba7ebebef888b14f), [f998fcb](https://github.com/morluto/rea/commit/f998fcb1cca9994c3589fb70d6e0127fc215f76f), [1e51c73](https://github.com/morluto/rea/commit/1e51c732bbf08191688d6526bf58ab2650b601e3), [#1365](https://github.com/morluto/rea/issues/1365)) Thanks @akshitkhokhani, @AWUQAQ, @immanuwell, @rudycelekli.
- Large JavaScript inputs: handle oversized inline source maps, deep returns and reassignment loops; avoid argument expansion limits and yield during large analysis passes. ([#1386](https://github.com/morluto/rea/pull/1386), [#1368](https://github.com/morluto/rea/pull/1368), [#1390](https://github.com/morluto/rea/pull/1390), [#1539](https://github.com/morluto/rea/pull/1539), [#1525](https://github.com/morluto/rea/pull/1525), [#1542](https://github.com/morluto/rea/pull/1542), [#1545](https://github.com/morluto/rea/pull/1545), [#1557](https://github.com/morluto/rea/pull/1557), [#1380](https://github.com/morluto/rea/issues/1380), [#1401](https://github.com/morluto/rea/issues/1401), [#1538](https://github.com/morluto/rea/issues/1538), [#1462](https://github.com/morluto/rea/issues/1462)) Thanks @cold-atom, @KadirJeager, @kaoru0822-kitauji, @marnixpluim, @N0zoM1z0, @rudycelekli.
- JavaScript receivers: expand escaped methods once, index returned-object targets, and avoid replaying earlier writes or duplicating retained graph allocations. ([#1517](https://github.com/morluto/rea/pull/1517), [#1537](https://github.com/morluto/rea/pull/1537), [#1444](https://github.com/morluto/rea/pull/1444), [#1601](https://github.com/morluto/rea/pull/1601), [#1495](https://github.com/morluto/rea/issues/1495)) Thanks @CassieFox23, @geekwolf, @kaoru0822-kitauji, @N0zoM1z0, @zeynelacikgoez.
- Browser captures: retain WebSocket URLs, empty connections and frame order; compare only common known payload coverage and preserve incomplete WebMCP replay coverage. ([db4e360](https://github.com/morluto/rea/commit/db4e3608465486466591b594cf77037ac150c988), [aa257ea](https://github.com/morluto/rea/commit/aa257ea4b16f2d2a35c12df63359d650b48b1154), [e52c0a7](https://github.com/morluto/rea/commit/e52c0a72c59c740315e89149881a27ce4d89a11c))
- Browser scenarios: seed storage in the correct partition, normalize loopback attach identities, retain declared-secret redaction and require verified lineage before Windows Electron signals. ([#1604](https://github.com/morluto/rea/pull/1604), [#1590](https://github.com/morluto/rea/pull/1590), [#1588](https://github.com/morluto/rea/pull/1588), [8b4c3de](https://github.com/morluto/rea/commit/8b4c3de3b3a3b580adec266f94f29ccedf1da228), [#1497](https://github.com/morluto/rea/issues/1497), [#1591](https://github.com/morluto/rea/issues/1591), [#1589](https://github.com/morluto/rea/issues/1589)) Thanks @Adolanium, @akushonkamen, @dakjdakd.
- Added Termux Android browser-scenario support. ([#1655](https://github.com/morluto/rea/pull/1655)) Thanks @tyloryang.
- Web inputs: accept BOM-prefixed HAR, preserve the first duplicate DOM attribute and resolve SVG/XLink URLs in HTML and XHTML. ([#1509](https://github.com/morluto/rea/pull/1509), [#1516](https://github.com/morluto/rea/pull/1516), [#1602](https://github.com/morluto/rea/pull/1602), [#1683](https://github.com/morluto/rea/pull/1683), [#1496](https://github.com/morluto/rea/issues/1496), [#1586](https://github.com/morluto/rea/issues/1586)) Thanks @CassieFox23, @kaoru0822-kitauji, @sathariels, @taljeri.
- Screenshot comparisons: validate PNG chunks, distinguish corruption from unsupported encodings and bound comparison memory. ([4e4b15b](https://github.com/morluto/rea/commit/4e4b15b8250b29e176d4191c9610a3931b693474), [b3e977e](https://github.com/morluto/rea/commit/b3e977e6d073ab1783cece8581279f87fc360411)) Thanks @rudycelekli.
- Archives: preserve case-distinct names, report collisions at their diverging segment, detect nested formats from bytes and reject Windows alternate-stream extraction paths. ([#1480](https://github.com/morluto/rea/pull/1480), [#1505](https://github.com/morluto/rea/pull/1505), [#1553](https://github.com/morluto/rea/pull/1553), [573598c](https://github.com/morluto/rea/commit/573598c6324698cc48ceafd24ed3864670e08d00), [#1470](https://github.com/morluto/rea/issues/1470), [#1491](https://github.com/morluto/rea/issues/1491)) Thanks @CassieFox23, @kaoru0822-kitauji.
- Cleanup: retain failed readers, ASAR handles, output trees and provider workers for retry without discarding completed output or partial observations. ([ffe0574](https://github.com/morluto/rea/commit/ffe0574e17b9d973860371083cb1a351be912131), [de0d341](https://github.com/morluto/rea/commit/de0d341524dc68250a45b41eb7e49fcecc1e32a9), [3f8c51e](https://github.com/morluto/rea/commit/3f8c51e9b506d88fc41aded7b1a22b9a09037c26), [d1235fa](https://github.com/morluto/rea/commit/d1235fadc901e1fb9ab3149d53063306c8545414), [026126e](https://github.com/morluto/rea/commit/026126eafe741e5a8b857433587fd615cdd44c19))
- Providers: canonicalize IDA workspace roots before identity checks, respect IDA cancellation, serialize JEB acquisition and correct Ghidra no-return/imported-symbol recovery. ([#1481](https://github.com/morluto/rea/pull/1481), [#1419](https://github.com/morluto/rea/pull/1419), [5f30ea6](https://github.com/morluto/rea/commit/5f30ea6ff2dd89aab7af6da6e8dfa5e508ed459b), [f88c990](https://github.com/morluto/rea/commit/f88c99021b88ce67e513025901f57478d8107d0c), [49e6f00](https://github.com/morluto/rea/commit/49e6f00ed08b225abf9ddb7c762553607fdab115)) Thanks @AS9929, @JonahSimon, @Y0UW1SH.
- Binary metadata: respect PE/.NET section extents, bound binary-plist expansion, scope keyed-archive traversal and decode app `Info.plist` files without `plutil`. ([#1678](https://github.com/morluto/rea/pull/1678), [#1515](https://github.com/morluto/rea/pull/1515), [#1378](https://github.com/morluto/rea/pull/1378), [#1476](https://github.com/morluto/rea/pull/1476), [975dff2](https://github.com/morluto/rea/commit/975dff2e25b14b634e14dd5e0db1537d0ca9815b), [76296c5](https://github.com/morluto/rea/commit/76296c5a3868ba3b54be6ed3896719283d6de5f8)) Thanks @jayhemnani9910, @kaoru0822-kitauji, @rudycelekli.
- Windows runtimes: preserve drive-root paths when creating private provider directories. ([ee46323](https://github.com/morluto/rea/commit/ee46323b493994902b04824a7dc8aae2a8117903))
- Compatibility: load Windows native controls under Node-API hosts with renamed executables, preserve dylib directory requirements, support Wakaru 1.x and reject directory-valued Hopper launchers. ([#1531](https://github.com/morluto/rea/pull/1531), [#1623](https://github.com/morluto/rea/pull/1623), [#1540](https://github.com/morluto/rea/pull/1540), [#1426](https://github.com/morluto/rea/pull/1426)) Thanks @evenafterallisaid, @Fazmin, @pionxzh, @xeropresence.
- Reference imports: normalize internal symlink lookup consistently, preserve exact paths and exclusion provenance, report root access failures and reject FIFO replacements without blocking. ([#1535](https://github.com/morluto/rea/pull/1535), [2ca3ad2](https://github.com/morluto/rea/commit/2ca3ad238608adfca80a7ff1aaadea6e59a58225), [6636045](https://github.com/morluto/rea/commit/6636045c9c5b472bba51afee9d434394861e93a4), [3967cfa](https://github.com/morluto/rea/commit/3967cfa43e786c65a57e89c265343983d19ef9d0), [f1c58cc](https://github.com/morluto/rea/commit/f1c58cc53fbd83b968e11b3e2eccebca51299c54)) Thanks @anujsingh-cse.
- Setup: honor active configuration and skill roots, preserve configured MCP environments, validate Hermes/OMP profiles before writing, recognize Omarchy and retain recovery backups. ([#1504](https://github.com/morluto/rea/pull/1504), [#1607](https://github.com/morluto/rea/pull/1607), [#1528](https://github.com/morluto/rea/pull/1528), [#1562](https://github.com/morluto/rea/pull/1562), [#1662](https://github.com/morluto/rea/pull/1662), [a011485](https://github.com/morluto/rea/commit/a01148553e2a37c72ae78405418ab648876a96a6), [#1606](https://github.com/morluto/rea/issues/1606), [#1521](https://github.com/morluto/rea/issues/1521), [#1561](https://github.com/morluto/rea/issues/1561)) Thanks @Adkid-Zephyr, @CassieFox23, @LuisTaffelli, @N0zoM1z0, @peter-research.
- Process capture: retain descendant lineage after launcher exit, preserve identity uncertainty before signaling and release terminals after observation failures. ([80896a1](https://github.com/morluto/rea/commit/80896a1d64b216ef893907249cd4252f86215d49), [c916850](https://github.com/morluto/rea/commit/c9168508527302ac57bc86385ccf0d824697b5dc)) Thanks @Y0UW1SH.
- CLI/MCP errors: accept JSON files for web comparisons, preserve native option help and union correction details, remove invalid aliases and validate doctor against its discovered output contract. ([#1397](https://github.com/morluto/rea/pull/1397), [#1395](https://github.com/morluto/rea/pull/1395), [#1425](https://github.com/morluto/rea/pull/1425), [#1461](https://github.com/morluto/rea/pull/1461), [8b4c96e](https://github.com/morluto/rea/commit/8b4c96e6c6b3ed6806e4cd72b556b5db6114304a), [#1421](https://github.com/morluto/rea/issues/1421), [#1454](https://github.com/morluto/rea/issues/1454)) Thanks @Fazmin, @kaoru0822-kitauji, @N0zoM1z0.

### ⚠ BREAKING CHANGES

- WebSocket results: use `network.websocket_connections` instead of `network.websocket_events`. Connections contain `request_id`, `url` and `events`; allow `payload_bytes: null` when size is unknown. No legacy alias remains. ([db4e360](https://github.com/morluto/rea/commit/db4e3608465486466591b594cf77037ac150c988))
- Direct resource APIs: pass a caller-owned `ArtifactResourceScope` to inventory/extraction, JavaScript analysis, reference imports and web exports; retain it through cleanup/shutdown. For `readJavaScriptArtifactFiles`, scope is argument three and abort signal is argument four. Keep each root inventory source’s single cleanup owner. Use `OwnedFileHandle` owners, injected ASAR `fd`/`read` handles instead of `createReadStream`, VCS `Result` values, and `WebScriptExportError`’s options object. CLI/MCP inputs for the scoped operations are unchanged. ([ffe0574](https://github.com/morluto/rea/commit/ffe0574e17b9d973860371083cb1a351be912131), [53e7fad](https://github.com/morluto/rea/commit/53e7fadbd078422ba3d55b5499a70d237c5f4908), [684199b](https://github.com/morluto/rea/commit/684199ba0be7822266d57ddb8a40e95f087fdc42), [be75ed5](https://github.com/morluto/rea/commit/be75ed5e4b4bfb146af497f8fa5d172a1ea19462), [be6272f](https://github.com/morluto/rea/commit/be6272f26115bd8e94f2ab0df4cf092004587a18), [e0e49e9](https://github.com/morluto/rea/commit/e0e49e9dd53d9d1f1d2330b23f7f880dc1c81774), [95a77b6](https://github.com/morluto/rea/commit/95a77b6e25420b3879bd0e32bdbb14d452b38776))
- Saved reference graphs: exclusions require their matching `pattern` and distinguish `project-ignored` from `default-ignored`. Re-import graphs missing that provenance. ([6585293](https://github.com/morluto/rea/commit/6585293c562853b95c3a70df02c12ad8cc17afc4))
- Terminal captures: keep initial and resized buffers within 1,000,000 cells using `columns × (rows + scrollback)`; oversized scenarios are rejected before launch. ([f9ea9a9](https://github.com/morluto/rea/commit/f9ea9a9268c854d31048da9f8a50cfa37703fe5a))
- Optional agent-verification reports: accept schema version 4, nullable `expectedFirstTool` and `targetClarificationPassed`. Production CLI/MCP contracts are unchanged. ([#1613](https://github.com/morluto/rea/pull/1613))
- Capture comparisons: recapture both sides with matching `literal-replacements-v1` semantics when custom normalization patterns are used. Legacy unversioned pattern captures remain readable but cannot be compared with new pattern captures; captures without patterns are unaffected. ([#1456](https://github.com/morluto/rea/pull/1456), [2b6f14f](https://github.com/morluto/rea/commit/2b6f14f528297cf12c776c960af0859f5cfbefbf)) Thanks @Madhavan006, @N0zoM1z0.
- Artifact graph edges: read child artifact IDs and paths from the occurrence selected by `occurrence_id`, not edge fields `child_artifact_id`/`logical_path`. Earlier inventory Evidence no longer validates against the new commitment. ([#1493](https://github.com/morluto/rea/pull/1493)) Thanks @kaoru0822-kitauji.
- Semantic graph schema: nodes and relations no longer include `identifier_strategy`, and relation IDs no longer hash it. Earlier Evidence no longer validates against this schema. ([#1474](https://github.com/morluto/rea/pull/1474)) Thanks @kaoru0822-kitauji.
- Semantic identities: select IDs from the parent graph; read exact event names from `event_name`, endpoints from `endpoint` and literal values from `properties.value`. New analyses use digest-based IDs for long/reserved event and endpoint names and `value-sha256` literal role keys, with shorter labels; string literal labels now read `string literal`. Previously stored graphs retain their original IDs and remain valid workflow inputs. ([#1427](https://github.com/morluto/rea/pull/1427), [#1423](https://github.com/morluto/rea/pull/1423), [#1407](https://github.com/morluto/rea/pull/1407)) Thanks @N0zoM1z0.

### Contributors

- Thanks also to @BaaRai, @commit-regrets, @coygeek, @Franky100-pig, @inii-sayaa, @jopemachine, @JosephDemarest, @keemsisi, @Totopo27 for contributions included in this release.

Full contribution record: [336 commits and 163 merged PRs](https://github.com/morluto/rea/blob/rea-agents-6.4.0/docs/releases/6.4.0.contributions.json).

## [6.3.0](https://github.com/morluto/rea/compare/rea-agents-6.2.0...rea-agents-6.3.0) (2026-10-09)


### ⚠ BREAKING CHANGES

* **captures:** Historical captures without current producer accounting or transaction identity, and web diffs missing accessibility or storage dimensions, are rejected. Preserve original captures and recapture with the current producer; update comparison consumers to include every dimension rather than synthesizing missing observations. See the [process capture guide](docs/process-capture.md) and [browser scenario contract](docs/browser-scenario-contract.md). ([3283a45](https://github.com/morluto/rea/commit/3283a45d09457c79e3adadb50a48620926d4bc5b))
* **browser:** JSON shape paths now contain typed property and array-element segments. WebMCP input_schema_shape is replaced by input_schema and input_schema_sha256, retaining declared examples and defaults.
* **process:** Filesystem digest omission entries now require system_code; budget and changed-file omissions use null, and unavailable-file omissions preserve the operating-system error code.
* **contracts:** Provider analysis outputs must explicitly supply metadata previously repaired with defaults; unsupported nullable facets must be reported as null.
* **javascript:** Semantic graph facts now store evidence context IDs and locations. Graph and semantic trace results require an inline evidence_contexts table.
* **contracts:** source-map URLs now live in target observations selected by declared_url_sha256, and doctor skill identity no longer emits installed_catalog_digest. Use the documented observation join and identity.skill.state instead.
* **javascript:** remove the never-incremented truncated_scopes statistic from JavaScript application analysis results and schemas.
* **native:** Objective-C attribute tokens now contain only name and value. Properties report nullable atomicity and readonly facts; class flags, ivar counts, and method requirement flags are nullable when unobserved.

### Features

* **setup:** register OMP during setup ([#1301](https://github.com/morluto/rea/pull/1301)) ([8b4c359](https://github.com/morluto/rea/commit/8b4c3591358ee59297d8298ede1b63d08459d817))
* **javascript:** record Electron integrity mismatches ([7915ee5](https://github.com/morluto/rea/commit/7915ee51781878ed67e094259924b6e6f3093b3f))


### Bug Fixes

* **inspector:** retain observations after capture failures ([dea3498](https://github.com/morluto/rea/commit/dea3498b2b8d919606eefc4fd62f6ebcbbe5ed30))
* **artifacts:** bind ASAR interpretation to owned snapshots ([d79317c](https://github.com/morluto/rea/commit/d79317cda0bbe8240eb7e25b0a5de90dcffca5fa))
* **artifacts:** infer legacy Mach-O simulator platforms ([5aa2002](https://github.com/morluto/rea/commit/5aa200285ab066e48b37b716495936e6e2a963fd))
* **artifacts:** preserve archive facts and Unicode path identity ([5751f5c](https://github.com/morluto/rea/commit/5751f5caac86c770123ae739a4e4101a72b0989c))
* **artifacts:** reject incomplete inventoried extraction ([5e8fb53](https://github.com/morluto/rea/commit/5e8fb531e255a4a04fc053c54096f66d5c84cde3))
* **artifacts:** retain DMG ownership through uncertain attachment ([a27794c](https://github.com/morluto/rea/commit/a27794c246b3f11d7f92ae7f6d276718190ab731))
* **artifacts:** validate only active extraction entries ([cfb12e4](https://github.com/morluto/rea/commit/cfb12e47dc241f057be93a00892f7d7361d6119d))
* **browser:** follow only HTTP redirect statuses for source maps ([82bbe74](https://github.com/morluto/rea/commit/82bbe743336244d398e67512659ea6943d43a4a4))
* **browser:** preserve payload shapes and WebMCP declarations ([4951a89](https://github.com/morluto/rea/commit/4951a897c53bb6882300c5d7a9660a3f43e374f5))
* **browser:** release attached viewport overrides without resizing the external page ([f6cfbfc](https://github.com/morluto/rea/commit/f6cfbfcc554ff24173dd7ad5333e8e26ab9c962d))
* **browser:** retain attached scenario emulation until cleanup ([a0523b3](https://github.com/morluto/rea/commit/a0523b375eb3147f1d2d1e7eb10a2f4546f5d0fc))
* **browser:** retain malformed redirect diagnostics ([617cd84](https://github.com/morluto/rea/commit/617cd84d27d100e7cc3cd4b5721dea4a996c9775))
* **browser:** serialize attached scenarios through cleanup settlement ([cfce91d](https://github.com/morluto/rea/commit/cfce91d418fbcde4a9ef283a61549279751854e7))
* **ci:** scope verification and reuse native runners ([#1344](https://github.com/morluto/rea/issues/1344)) ([d5cb8ae](https://github.com/morluto/rea/commit/d5cb8aee063065a48233458e04771635167825c8))
* **cli:** avoid duplicate primary cleanup diagnostics ([37fcea7](https://github.com/morluto/rea/commit/37fcea78cecbeeadd869e9a3d77dd133ed264a0a))
* **cli:** classify JSON input permission denials ([08daf05](https://github.com/morluto/rea/commit/08daf056cc8e4d092f9592574d09d5182457b7bc))
* **cli:** classify oversized JSON inputs ([f7cf4c8](https://github.com/morluto/rea/commit/f7cf4c890d4b9c70b1f56e6c627b44a59e58fd73))
* **cli:** stream JSON inputs beyond the whole-document string limit ([#1360](https://github.com/morluto/rea/issues/1360)) ([6ce3288](https://github.com/morluto/rea/commit/6ce3288f3bd65a886e47905455ed5c9b661015e6)), closes [#1331](https://github.com/morluto/rea/issues/1331)
* **cli:** stream JSON results at the shared command boundary ([810107a](https://github.com/morluto/rea/commit/810107a2ad15cc52afd6662aec24d231d8c77225))
* **contracts:** advertise NUL with a portable hex escape ([3f59a84](https://github.com/morluto/rea/commit/3f59a84bd1039763bb349894542601ed78be2033)), closes [#1329](https://github.com/morluto/rea/issues/1329)
* **contracts:** require observed provider output metadata ([a4ba8ae](https://github.com/morluto/rea/commit/a4ba8aecd507637b6261026afc17f79516840d50))
* **electron:** preserve unrepresentable numeric option evidence ([41a228c](https://github.com/morluto/rea/commit/41a228c1b01a89127858b1706879ede08a81deaf))
* **evidence:** order canonical projections independently of locale ([614fb76](https://github.com/morluto/rea/commit/614fb7681ee9e4eba7219c1ee9e90d6a85d78095))
* **files:** reject nonregular capture and JSON inputs ([5f16124](https://github.com/morluto/rea/commit/5f16124a31fa4a82bd03037506809d6be959d768))
* **filesystem:** reject unstable artifact targets ([7829b1a](https://github.com/morluto/rea/commit/7829b1aeef8f43f186be2d2adbd6c67541306a7a))
* **ghidra:** reject a native decompiler built for another host ([#1280](https://github.com/morluto/rea/issues/1280)) ([3728c82](https://github.com/morluto/rea/commit/3728c8267b4fb6da78cbae42a2a6cbddff80ea84)), closes [#1192](https://github.com/morluto/rea/issues/1192)
* **ghidra:** retain process ownership after failed launch rollback ([07675f7](https://github.com/morluto/rea/commit/07675f78c66ce9e8706e808d417265e18ba9f3a5))
* **ghidra:** verify dense jump tables on an optimized fixture ([#1374](https://github.com/morluto/rea/issues/1374)) ([73a664b](https://github.com/morluto/rea/commit/73a664bc78ee618045a2733b8714821281f77403))
* **hopper:** allow restart after verified owned-provider shutdown ([1c12349](https://github.com/morluto/rea/commit/1c123493a21cc579ba7532c40e7ef30df45db3e8))
* **hopper:** probe interior navigation from multi-byte instructions ([#1285](https://github.com/morluto/rea/issues/1285)) ([bf934d5](https://github.com/morluto/rea/commit/bf934d5592e707ba5e7769043de3a430ed8d4923))
* **ida:** compare admitted document paths consistently ([890bb66](https://github.com/morluto/rea/commit/890bb66b35d5f9f8ee54ff0049bf7dc7b82b2480))
* **javascript:** avoid positive-zero evidence for signed zero ([9055bd6](https://github.com/morluto/rea/commit/9055bd695b75f72fb1b8a538d1485d30c0b0ee0b))
* **javascript:** decline source-map UNC references with an unusable host ([#1372](https://github.com/morluto/rea/issues/1372)) ([f504c2a](https://github.com/morluto/rea/commit/f504c2a351027f17ac353fba2d7cfc3505ee17d6))
* **javascript:** distinguish prefix-only builtins from packages ([2b4abbf](https://github.com/morluto/rea/commit/2b4abbf1ccb6dd6ad1248cf48e381df0842542c1))
* **javascript:** honor module-sync package exports ([#1361](https://github.com/morluto/rea/issues/1361)) ([d0e6069](https://github.com/morluto/rea/commit/d0e606930acb701790c286340226b1e3e7060b4f))
* **javascript:** parse declaration artifacts in ambient mode ([4896adc](https://github.com/morluto/rea/commit/4896adcd0f9316034e83129685ed3807ade6f3ea))
* **javascript:** preserve agreeing module provenance ([db171be](https://github.com/morluto/rea/commit/db171be6e570fd1261a30d711e4da2d17de85a93))
* **javascript:** preserve capture-time guards and ordering ([001851f](https://github.com/morluto/rea/commit/001851fde6f972e6ebd01fddccdff4c645a85f63))
* **javascript:** preserve semantic evidence through satisfies ([e995b19](https://github.com/morluto/rea/commit/e995b19f834ba78faa294f5959fd3ad8a97290ca))
* **javascript:** preserve uncertainty after references escape to calls ([#1292](https://github.com/morluto/rea/issues/1292)) ([355a292](https://github.com/morluto/rea/commit/355a292198bf58245c67ae315fdb4f77e62769cc))
* **javascript:** reject invalid package exports configurations ([7a4f268](https://github.com/morluto/rea/commit/7a4f2685d41b134507331c322f0f5da8e1f6c3f4))
* **javascript:** resolve exported callables through lexical bindings ([#1351](https://github.com/morluto/rea/issues/1351)) ([a9f5dad](https://github.com/morluto/rea/commit/a9f5dad5a8f196c88f6305d8d958b355cc0b52c2))
* **javascript:** resolve query-only HTML references to their document ([55a46f7](https://github.com/morluto/rea/commit/55a46f7c7176075c9edda4fe61ed995f2ceadf6a))
* **javascript:** retain array identity after length mutations ([4bcea1a](https://github.com/morluto/rea/commit/4bcea1aa76e3e7ca665197181739c5e27a62c40a))
* **javascript:** retain conditional mutation ordering uncertainty ([b8a8190](https://github.com/morluto/rea/commit/b8a8190b2f30e377eee2d69d1ba31ea454fa70b9))
* **javascript:** retain distinct module provenance path components ([2bd7de6](https://github.com/morluto/rea/commit/2bd7de6f8ca62fc1d48334cfa7fdced461b7b153))
* **javascript:** retain unresolved value frontiers in provenance queries ([3e19875](https://github.com/morluto/rea/commit/3e19875c7fa9c61cff655bbe6046ddc4ab558533))
* **javascript:** store source map URLs once ([ed8fcae](https://github.com/morluto/rea/commit/ed8fcae94b699b62b44162f880faa077a36c455d))
* **json:** preserve runtime limits across JSON file readers ([#1350](https://github.com/morluto/rea/issues/1350)) ([9c4a68b](https://github.com/morluto/rea/commit/9c4a68bc19a0f7d39557e3cc039f5877f6550f63))
* **managed:** bind graph facts to their source Evidence ([cc7b5af](https://github.com/morluto/rea/commit/cc7b5af0777fc68ebba10ec061244729ebf2357d))
* **mcp:** admit composed analysis through result bookkeeping ([e11f4d3](https://github.com/morluto/rea/commit/e11f4d371abaa8cb65ebf7b94fa216329fd78d88))
* **mcp:** advertise object roots for union input schemas ([#1373](https://github.com/morluto/rea/issues/1373)) ([39dabd0](https://github.com/morluto/rea/commit/39dabd0608ed9617d60f16ece05993089f24ff38))
* **mcp:** advertise primitive semantic literal seeds ([f62b449](https://github.com/morluto/rea/commit/f62b44971deee0e99df6fcf32758c8e5592400ed))
* **mcp:** preserve JavaScript workflow identity validation ([#1366](https://github.com/morluto/rea/issues/1366)) ([53ed942](https://github.com/morluto/rea/commit/53ed942a85f51ff9f0e4f01cbb53359df476071d)), closes [#1364](https://github.com/morluto/rea/issues/1364) [#1065](https://github.com/morluto/rea/issues/1065)
* **mcp:** retry failed shutdown resources and retain failure reasons ([e64678e](https://github.com/morluto/rea/commit/e64678e8f9768dd819d8f5f12cc844a6660ff2c5))
* **native:** distinguish symbol definitions from metadata ([70bad53](https://github.com/morluto/rea/commit/70bad53847b0e14489acee73d204ff645e1adfcd))
* **native:** preserve unknown Objective-C metadata ([b112d44](https://github.com/morluto/rea/commit/b112d44a3961939881779c81a57e7a3f9d1372f7))
* **native:** refuse to list architectures of non-Mach-O targets ([#1325](https://github.com/morluto/rea/issues/1325)) ([1b73b5a](https://github.com/morluto/rea/commit/1b73b5ab4bc75bd424e643de8e49f142ffa2b336))
* **native:** retain LLDB cleanup ownership through client close ([7ad353f](https://github.com/morluto/rea/commit/7ad353fa8b3f07e14face80336678d23cc7c6507))
* **process:** keep unobserved file contents unknown ([#1358](https://github.com/morluto/rea/issues/1358)) ([f91f279](https://github.com/morluto/rea/commit/f91f2798b4dc6adb61b3ffe28a24a5d55adbd6ff))
* **process:** retain per-file digest open failures ([415145d](https://github.com/morluto/rea/commit/415145d04f09a15cbfb7dda8ea9dc363a77f9bf0))
* **reference:** report malformed UTF-8 before import parsing ([f166a2a](https://github.com/morluto/rea/commit/f166a2ae15b072216173a51a8f5cad930a858366))
* report malformed application evidence as input errors ([218c131](https://github.com/morluto/rea/commit/218c13160ec0ed7116d6633fc76559ec39dae4d7))
* retain completed observations when later analysis steps fail ([35f121f](https://github.com/morluto/rea/commit/35f121f4acac821e848c485fb82a2c42f51f6ea1))
* **setup:** install the skill for Claude Code ([b4a1919](https://github.com/morluto/rea/commit/b4a19193fe3baf9075f8ac419517021ea0c71ea3))
* **setup:** recognize supported Nobara hosts ([f0dc233](https://github.com/morluto/rea/commit/f0dc233d64de4c215c453c346e516b7622713e95))
* **skill:** pin packaged commands to the shipping package version ([2793672](https://github.com/morluto/rea/commit/2793672ee2a575f97a8011c7fec5288098cdd5d1))
* **skill:** pin packaged commands to the shipping package version ([#1346](https://github.com/morluto/rea/issues/1346)) ([f39e71c](https://github.com/morluto/rea/commit/f39e71ce1897bb5c704b33a8b0049567f11e3a13))
* **snapshot:** preserve complete investigation revision histories ([#1354](https://github.com/morluto/rea/issues/1354)) ([1c0cc8a](https://github.com/morluto/rea/commit/1c0cc8a6753b5ac781b28ebb1832f3a6a1771a68))
* **targets:** cancel resolution before provider admission ([f3c4a33](https://github.com/morluto/rea/commit/f3c4a332f7bd198bd67f0187bc2a85c7b31bb960))
* **update:** preserve disabled client registrations ([abf5e24](https://github.com/morluto/rea/commit/abf5e243c4d2cae03404b6e1fb1ccc77be917b53))


### Performance Improvements

* **javascript:** index version relationships once per comparison ([#1347](https://github.com/morluto/rea/issues/1347)) ([b1e85ad](https://github.com/morluto/rea/commit/b1e85ad711743a594c572dbd5b0d5cb664e2a502))
* **javascript:** validate the version change graph once ([#1370](https://github.com/morluto/rea/issues/1370)) ([037709a](https://github.com/morluto/rea/commit/037709a52c0824f4d2bbee90d8e2642b2d88d364))
* **json:** encode streamed JSON iteratively ([#1322](https://github.com/morluto/rea/issues/1322)) ([56598be](https://github.com/morluto/rea/commit/56598beb4e82968a313deb9efdf4b98db5bd1f4f))


### Code Refactoring

* use canonical implementations and types directly ([765e809](https://github.com/morluto/rea/commit/765e809e366eff21b4b9c224f1a813ad64245ea3))
* **artifacts:** remove unused root classifier ([5291bca](https://github.com/morluto/rea/commit/5291bca108af781214572fac709f9808bb8aa4db))
* **artifacts:** test inventory changes at materialization boundary ([750fb65](https://github.com/morluto/rea/commit/750fb6565052e9eaad40b946b6a284d0730d14f8))
* **browser:** open scenario sessions without a factory wrapper ([d1983a4](https://github.com/morluto/rea/commit/d1983a45767bfcdc020652f48109a78a3f9fa590))
* **catalog:** import CLI metadata from its owner ([8c96baa](https://github.com/morluto/rea/commit/8c96baab80dc258d31ca1632d761fffb11dbaaae))
* consolidate boundary semantics and prune redundant tests ([392f1f3](https://github.com/morluto/rea/commit/392f1f310733f2c365da7bc57a1154cf10ec4ba0))
* **javascript:** normalize erased expression syntax once ([b628bba](https://github.com/morluto/rea/commit/b628bba1fa65fd3b51363bf4b745f0afc57e1dba))
* **javascript:** parse runtime evidence into one verified owner ([006b295](https://github.com/morluto/rea/commit/006b295f1de19fd5351832cf52d98a202a5cd5cd))
* **javascript:** remove obsolete scope truncation statistic ([449d570](https://github.com/morluto/rea/commit/449d57075eec71b2f064af8877c50cbbde30a283))
* **javascript:** share Babel child traversal ([0f10499](https://github.com/morluto/rea/commit/0f10499245ec2fab8823f116caf34450b3a7385b))
* **javascript:** share semantic evidence at fact construction ([e3bbb9a](https://github.com/morluto/rea/commit/e3bbb9ac453da8d15f3b32511180451613710616))
* **process:** remove duplicate observation and trace entry points ([070339a](https://github.com/morluto/rea/commit/070339af50a50a0f23e82db859e761c53277ee79))
* **providers:** use canonical artifact and managed identities ([87f0051](https://github.com/morluto/rea/commit/87f0051496aff1b05ab24d6b63f79884f4ca9b8f))
* **reference:** simplify malformed UTF-8 handling ([377df71](https://github.com/morluto/rea/commit/377df715ea5b2523cd6c1084fdc286eb8a056182))
* remove obsolete source exclusions and identity wrapper ([44c92f8](https://github.com/morluto/rea/commit/44c92f88c51841735741811a68cc89fde14efa80))
* remove single-use forwarding helpers ([4144e45](https://github.com/morluto/rea/commit/4144e454f385c372d29e301e6bb959092c606a6e))


### Documentation

* keep license sections text-only ([e10f1f0](https://github.com/morluto/rea/commit/e10f1f0901fa56fb4443837cf9528b31a12e140e))
* align translated README artwork and layout ([ccfbe87](https://github.com/morluto/rea/commit/ccfbe87e984e456e12c66d0d2fe6d5a559d09518))
* add README artwork and refine closing sections ([4b8e744](https://github.com/morluto/rea/commit/4b8e744d90579e353371649047215c4e4be7a5f6))
* add repository-local REA tool design skill ([7738c1f](https://github.com/morluto/rea/commit/7738c1f6a9ccf1ec9868ef832f154abe9ba5eebd))
* celebrate 40,000 GitHub stars 🎉 ([3edb217](https://github.com/morluto/rea/commit/3edb2172def0e0bd9076f23148f0c41cd2f341a3))
* celebrate 40,000 GitHub stars 🎉 ([5ecc98a](https://github.com/morluto/rea/commit/5ecc98a5eac4c10d33e9c418b9ffae61c68e3ef2))
* consolidate agent guidance around ownership and boundaries ([ba44222](https://github.com/morluto/rea/commit/ba4422296dc409d49836f25642555e00463bfe3b))
* **contracts:** explain canonical URL and skill metadata ownership ([e36afa1](https://github.com/morluto/rea/commit/e36afa112fd7b7ab5a925ca452de93b68f12a6ab))
* correct MCP error and capture import guidance ([077d6c4](https://github.com/morluto/rea/commit/077d6c407b3ea7443a7277ae0e5531b3927dd742))
* correct README setup and runtime guidance ([5b3715e](https://github.com/morluto/rea/commit/5b3715ef825a30150b02d3f1bb7d40dd89453018))
* explain CI scope and native runner reuse ([#1348](https://github.com/morluto/rea/issues/1348)) ([6c9161d](https://github.com/morluto/rea/commit/6c9161d61745e242643f224ce49e7468143a15f3))
* prune repeated contributor and tool design instructions ([5d79387](https://github.com/morluto/rea/commit/5d79387505ebae1ec8d800ee3ffd901920a9d8be))
* remove retired architecture and migration artifacts ([7a0c800](https://github.com/morluto/rea/commit/7a0c80085128e6329ca2e4f54f3539f3245c57d1))


### Tests

* share the client registration command to restore the jscpd gate ([#1317](https://github.com/morluto/rea/pull/1317)) ([5d16be2](https://github.com/morluto/rea/commit/5d16be2a7185db8b70a5fcbc5f5e1be63297f2c8))
* **mcp:** remove arbitrary schema inventory thresholds ([24673aa](https://github.com/morluto/rea/commit/24673aaae497ca4ef0902544c0cd69817f5424ed))
* **android:** allow provider readiness under load ([961c3c3](https://github.com/morluto/rea/commit/961c3c3de79ec44d608d011eb3fa3d6bd645cf6a))
* **artifacts:** verify extraction races with real filesystem changes ([1ac8389](https://github.com/morluto/rea/commit/1ac8389c5c1f75faf8d7f2f3faf2f24febad5fea))
* **browser:** avoid duplicating source-map listener setup ([9367dc1](https://github.com/morluto/rea/commit/9367dc13bd8d2732d36d5376b5de170c9f4af424))
* **browser:** report redirect status cases independently ([5a61562](https://github.com/morluto/rea/commit/5a61562dc200120c7b8020854085c17b8203e95d))
* **cli:** remove duplicate malformed JSON assertion ([5d32e42](https://github.com/morluto/rea/commit/5d32e4252941e93065cadd83b9f02aa6427544d8))
* exercise source test selection through Git and Vitest ([25711ad](https://github.com/morluto/rea/commit/25711ad2590af136dfb301839dddd6d30971ba76))
* **filesystem:** bound FIFO regressions at consumers ([0bfb6e0](https://github.com/morluto/rea/commit/0bfb6e00abae1e67a96e548d64954bb21861f621))
* **ghidra:** allow rollback tests to reach spawned process ([d761d73](https://github.com/morluto/rea/commit/d761d7358b45fe0724b182a206241fd605f338b0))
* **javascript:** share primitive expansion producer fixtures ([c867bcd](https://github.com/morluto/rea/commit/c867bcd0aadd63473865f9a328459e0db3c89565))
* **javascript:** share semantic graph test facts ([ac356c4](https://github.com/morluto/rea/commit/ac356c46ad6a17c8864bc5d350984786db62d2f5))
* **javascript:** verify distinct module origins through reconstruction ([96b2b24](https://github.com/morluto/rea/commit/96b2b245fdefc9c78f5dcf6ce054232b51f7c117))
* **json:** remove assertions covered by CLI output consumers ([a959a83](https://github.com/morluto/rea/commit/a959a8309db79fbee6477efd7ee541615e625627))
* **managed:** include shared dossier fixture in artifact inputs ([66a20a2](https://github.com/morluto/rea/commit/66a20a2597b5daebc0a292361aa62a78b7df6e7d))
* **native:** retain trace diagnostics when observed hits differ ([048b798](https://github.com/morluto/rea/commit/048b79878c70c594789909082499dc675472b63a))
* **package:** share validated native dossier fixtures ([ca90109](https://github.com/morluto/rea/commit/ca9010936a934a49fbc6cf69eb1d7fc2242b6da9))
* **process:** publish capture readiness atomically ([74be526](https://github.com/morluto/rea/commit/74be52611e66f680ef1919d521fc3c304bc2326e))
* **process:** report cleanup details on cancellation failures ([79d5b9a](https://github.com/morluto/rea/commit/79d5b9a826b9204c1ef59b0a5c5ec83e7a2f2bec))
* **process:** use owned CLI and workspace fixtures ([4940a86](https://github.com/morluto/rea/commit/4940a867e2e56cbb974bfa321008a8f35db47d52))
* share snapshot replay and managed graph fixtures ([d83cbd2](https://github.com/morluto/rea/commit/d83cbd2abf1bbf15beef990f5353457fdbaaeb8e))


### Continuous Integration

* enforce architecture guards with portable checkout paths ([ecc67ca](https://github.com/morluto/rea/commit/ecc67cab2d85cacda245890ffe84b80ac395d79e))

## [6.2.0](https://github.com/morluto/rea/compare/rea-agents-6.1.0...rea-agents-6.2.0) (2026-10-09)


### ⚠ BREAKING CHANGES

Read the [6.1 to 6.2 migration guide](docs/migration-6.2.md) before upgrading. REA's `always-bump-minor` policy includes breaking changes; 6.2 is not a backward-compatibility promise. Preserve original saved files and regenerate missing observations rather than fabricating identities or facts.

* **MCP / Evidence / snapshots / artifacts:** Success results are direct canonical Evidence; read `normalized_result` rather than the old `result`/`evidence` wrapper. Evidence requires nullable `analysis_profile`, session provider aliases are removed, snapshots require complete profile-bound query records, and artifact roles/permissions belong to occurrences. Recreate incompatible saved data; adding fields without recomputing their semantic identity is invalid. ([63bf914](https://github.com/morluto/rea/commit/63bf91405cf97b114a84f337fb1272d98a267999))
* **Process captures:** Legacy v3 conversion is removed. Explicit executable identity and `event_journal` are required; retain old captures and recapture when current comparisons are needed instead of inventing launch identity or event order. ([2a77469](https://github.com/morluto/rea/commit/2a7746998d47446c4db6d4f524e0f183d6803f3f))
* **Cleanup and evaluation:** A one-shot analysis reports cleanup failure while preserving the completed observation or primary diagnostic. Handle `cleanup_incomplete` and retained observations/resources. Configured agent-evaluation fixtures require Evidence-backed correctness, not routing or answer wording alone. ([#1211](https://github.com/morluto/rea/pull/1211), [27a9cea](https://github.com/morluto/rea/commit/27a9ceade7232c1c9a24dc7d454ae060948183a1))
* **JavaScript:** Return-field projections require explicit presence; export-shape changes carry both sides' presence and property inventory coverage. Semantic object operations retain complete `property_path` segments. Regenerate old analysis and distinguish unknown values from unknown presence. ([475a0f8](https://github.com/morluto/rea/commit/475a0f84dac63d710e032bc7f731c1a3bda624ec))
* **Function comparisons:** Remove the unreachable `truncated` dimension state and `summary.truncated` counter; update enum and display consumers while retaining explicit `unknown` facts. ([5510b27](https://github.com/morluto/rea/commit/5510b27d7f863a3df26212fba4a59f8df0da3712))
* **Historical sources:** Unreadable/unknown symlink targets require `target: null`; external targets retain the observed absolute target. Reimport graphs containing display placeholders such as `<outside-root>` and handle nullable targets. ([b7b4333](https://github.com/morluto/rea/commit/b7b433370310c3ffe33d5027d8393151d5e862da))

### Features

* **javascript:** report observed export property presence ([#1160](https://github.com/morluto/rea/issues/1160)) ([45e3edc](https://github.com/morluto/rea/commit/45e3edc17f48954c89d8db86f7313c479bd39344))
* **mcp:** select views of retained analysis results ([#1180](https://github.com/morluto/rea/issues/1180)) ([db675f1](https://github.com/morluto/rea/commit/db675f1d52acda62b6f57b5a8773532f49b259e7))
* **website:** add an Aegis APK code-generation showcase ([0270dd5](https://github.com/morluto/rea/commit/0270dd5739480acced62e045b5890ec0ebde2631))
* **website:** add an Android showcase and clearer project prompts ([6cc817e](https://github.com/morluto/rea/commit/6cc817e8bd377b064b3568ef1eacb27eaefcb4c1))
* **website:** add beginner examples and synchronized publishing ([0fec65d](https://github.com/morluto/rea/commit/0fec65d06b2f5431e704c472e53015d4b3cc967c))
* **website:** add beginner examples and synchronized publishing ([#1203](https://github.com/morluto/rea/issues/1203)) ([0fec65d](https://github.com/morluto/rea/commit/0fec65d06b2f5431e704c472e53015d4b3cc967c))
* **website:** add Discord link beside GitHub badge ([cc39fc5](https://github.com/morluto/rea/commit/cc39fc53b829a349ae199823472990a53014c507))
* **website:** add homepage navigation and faster reading paths ([863674b](https://github.com/morluto/rea/commit/863674b2e92dd7c699768db82d521ccc88b7ebe4))
* **website:** add homepage navigation and faster reading paths ([c94f06d](https://github.com/morluto/rea/commit/c94f06d98f895eb8b6c5ffa5e999ef1d4bb5eea2))
* **website:** add homepage navigation and faster reading paths ([#1213](https://github.com/morluto/rea/issues/1213)) ([863674b](https://github.com/morluto/rea/commit/863674b2e92dd7c699768db82d521ccc88b7ebe4))
* **website:** add search metadata and automatic sitemap ([99f257b](https://github.com/morluto/rea/commit/99f257bbf03c27327e5e0a232fefd3c792acd5bc))
* **website:** add search metadata and automatic sitemap ([b8851cb](https://github.com/morluto/rea/commit/b8851cb977cfdd608798d32bf5877f645b960831)), closes [#1283](https://github.com/morluto/rea/issues/1283)
* **website:** clarify reverse engineering and showcase goals ([e750c26](https://github.com/morluto/rea/commit/e750c262fbf37100369ab25bf8659daa1a2c4cc7))
* **website:** explain REA through a first investigation ([5160d9b](https://github.com/morluto/rea/commit/5160d9b717d0207a357c754bdf72e215e59d19d1))
* **website:** explain REA with Calculator and a playable dinosaur lab ([11b9f03](https://github.com/morluto/rea/commit/11b9f0346cf5413045b41ff552a024e11ba46ccc))
* **website:** lead with the playable dinosaur example ([19c52f5](https://github.com/morluto/rea/commit/19c52f5e3f42fb754fc154bbd16552c5111df0c5))
* **website:** show manual analysis beside a one-prompt workflow ([291bc6f](https://github.com/morluto/rea/commit/291bc6fb70f47d28d23440f03a8a7fa49eb9a391))


### Bug Fixes

* **dev:** accept formatter-ignored staged documentation without failing the commit hook; malformed JSON remains rejected. ([bd2db2f](https://github.com/morluto/rea/commit/bd2db2f0fa495fb08dea443cd16d7683d4b86e6a))

* **release:** publish reviewed release-PR merges from their exact reviewed source. ([c12bad7](https://github.com/morluto/rea/commit/c12bad7f139431fc0db7a8b7c9db1eab95f96dc2))

* **android:** support owned JADX stdio on Windows ([#1276](https://github.com/morluto/rea/issues/1276)) ([636b245](https://github.com/morluto/rea/commit/636b245f1badf2a7ecfa63c6e2378ac2f7673cc3)), closes [#1262](https://github.com/morluto/rea/issues/1262)
* **android:** validate engine archive prerequisites ([#1145](https://github.com/morluto/rea/issues/1145)) ([e9ebfb9](https://github.com/morluto/rea/commit/e9ebfb94eff0699b1ea84bba000c4467fa1cb998))
* **apple:** report unusable dylib-resolution roots as invalid input ([6a1e558](https://github.com/morluto/rea/commit/6a1e558db3ec2b69561e91ea817f1c2065dfc676))
* **apple:** report unusable dylib-resolution roots as invalid input ([24a30fd](https://github.com/morluto/rea/commit/24a30fd91c144b7f2533e5f5de8c91268773519c))
* **artifacts:** keep cancellation and the caller path in extraction refusals ([37025cc](https://github.com/morluto/rea/commit/37025cc09f12d49f46e61eedc3564c710089146b))
* **artifacts:** keep cancellation and the caller path in extraction refusals ([eacf846](https://github.com/morluto/rea/commit/eacf8461dad6bab11a3d5438e6db001a10f33a9b))
* **artifacts:** match lipo arm64e variant names to their FAT slices ([de5bfec](https://github.com/morluto/rea/commit/de5bfec79fe862816350b2deeb42a12c0734d855))
* **artifacts:** match lipo arm64e variant names to their FAT slices ([0b32577](https://github.com/morluto/rea/commit/0b32577a90aef97e36adf2a7af4f3eccd5d82357)), closes [#1168](https://github.com/morluto/rea/issues/1168)
* **artifacts:** name only host-available workflows for non-archive plists ([f4c99ab](https://github.com/morluto/rea/commit/f4c99ab8a53806dd57dc24b3d5a600905bcb4686))
* **artifacts:** name only host-available workflows for non-archive plists ([2295855](https://github.com/morluto/rea/commit/22958558eafdfccf71a7d5bbbcf360574a6b2e3c))
* **artifacts:** recheck failed DMG detaches before reporting cleanup failure ([#1155](https://github.com/morluto/rea/issues/1155)) ([58a91f0](https://github.com/morluto/rea/commit/58a91f03d72162849991caf537ab058ccc918594))
* **artifacts:** refuse unsupported extraction formats before scanning ([8e74c9c](https://github.com/morluto/rea/commit/8e74c9c62fb44556b90f20bb6c12771ac05a18f2))
* **artifacts:** report encrypted archive entries as unsupported extraction ([de43da7](https://github.com/morluto/rea/commit/de43da71ae982dd0f3d7b5ae49c914729db3a6ec))
* **artifacts:** report non-archive keyed-archive selections as unsupported targets ([fef38e4](https://github.com/morluto/rea/commit/fef38e4d22ee859ec43fb591d53e8b9973c69958))
* **artifacts:** report non-archive keyed-archive selections as unsupported targets ([8c5088c](https://github.com/morluto/rea/commit/8c5088c8cdf32a9f96f6c479c6e70a71fa360168))
* **artifacts:** report wrong target kinds as unsupported targets ([b34bdcd](https://github.com/morluto/rea/commit/b34bdcdb2877be394c59c9cbf70269dc1841ff78))
* **artifacts:** report wrong target kinds as unsupported targets ([637bcb5](https://github.com/morluto/rea/commit/637bcb5e4182b6c60e922b18688642d8e1008e90))
* **browser:** classify export-web-scripts capture selection failures by cause ([ddaa183](https://github.com/morluto/rea/commit/ddaa18301ab9c67e7a6f7ce66076075e8a4d5017))
* **browser:** classify export-web-scripts capture selection failures by cause ([8c5e34c](https://github.com/morluto/rea/commit/8c5e34cd379392ca40f651ca5eeb6a947b44aa33))
* **browser:** report Windows HAR heap exhaustion ([#1147](https://github.com/morluto/rea/issues/1147)) ([1393507](https://github.com/morluto/rea/commit/13935077ba039f6e342f9c11ab5eea935a335ae6))
* **browser:** retain scenario observations across failures ([614e0c2](https://github.com/morluto/rea/commit/614e0c2e74819bb5e3ef3d2e16ff31ee6cab76ae))
* **browser:** retain scenario resources until cleanup succeeds ([88640f6](https://github.com/morluto/rea/commit/88640f60fe566edbe2320688df62c7ef46c4c61c))
* **ci:** pass selected environment to Windows Ghidra fixture ([#1281](https://github.com/morluto/rea/issues/1281)) ([f085589](https://github.com/morluto/rea/commit/f085589957922eaf421db814399e88e415712050))
* **cli:** advertise defaulted inputs as optional in --schema and help ([#1175](https://github.com/morluto/rea/issues/1175)) ([b4927a0](https://github.com/morluto/rea/commit/b4927a0a4fa7e8935b101d214b396bfa78208281)), closes [#1169](https://github.com/morluto/rea/issues/1169)
* **cli:** cancel routed JavaScript analysis in rea analyze ([#1156](https://github.com/morluto/rea/issues/1156)) ([089bbf5](https://github.com/morluto/rea/commit/089bbf58f3561e3f465c544bbcf8c307287b1256))
* **cli:** complete cleanup after relayed interrupts ([#1202](https://github.com/morluto/rea/issues/1202)) ([911152a](https://github.com/morluto/rea/commit/911152a04d3aeb0d361141a8d54959009b269e49))
* **cli:** list the read failure cause for an unreadable JSON input file ([db0afce](https://github.com/morluto/rea/commit/db0afce5f344268271c59acee04e96f986c5619a))
* **cli:** list the read failure cause for an unreadable JSON input file ([6020df5](https://github.com/morluto/rea/commit/6020df53d9cd44845cf3b6b416db2d7802925578))
* **cli:** resolve xrefs symbol selectors after address validation ([#1209](https://github.com/morluto/rea/issues/1209)) ([7e9c911](https://github.com/morluto/rea/commit/7e9c91199ecd133d26a51cb33b6e63e1f942df7e))
* **config:** name the rejected setting and its constraint in configuration errors ([c3acc34](https://github.com/morluto/rea/commit/c3acc34475ca22387ea674839acfa1891b0b9f66))
* **config:** name the rejected setting and its constraint in configuration errors ([0a0244d](https://github.com/morluto/rea/commit/0a0244db4212bc1f59dec4b925fa90b3b473136a)), closes [#1184](https://github.com/morluto/rea/issues/1184)
* **doctor:** find the Homebrew Hopper cask without writing Homebrew caches ([98b07d0](https://github.com/morluto/rea/commit/98b07d07ddd20bea2c3bdf8d55ac2776a263bcf4))
* **doctor:** find the Homebrew Hopper cask without writing Homebrew caches ([a503376](https://github.com/morluto/rea/commit/a503376b2f9d9ba14d1602e58e0e93059e9d9181)), closes [#1165](https://github.com/morluto/rea/issues/1165)
* **domain:** report target read-permission denials as access_denied ([f36c10f](https://github.com/morluto/rea/commit/f36c10f9e8dc45a298d668e608f8e945bde487cf))
* **domain:** report target read-permission denials as access_denied ([d0ff57a](https://github.com/morluto/rea/commit/d0ff57a45c8da8938e7ae16d00bfd5ec63310af3)), closes [#1188](https://github.com/morluto/rea/issues/1188)
* **electron:** resolve effective preload after option overrides ([#1286](https://github.com/morluto/rea/issues/1286)) ([411498d](https://github.com/morluto/rea/commit/411498d45f860eba2fbc9d7051af20237b7a4cb1))
* emit v-mode-compatible patterns for tool schemas ([#1220](https://github.com/morluto/rea/issues/1220)) ([f0da05f](https://github.com/morluto/rea/commit/f0da05f67fff1411cf2f7a48a752ee7b348c71ff))
* **errors:** report caller-selected evidence path failures as invalid input ([d4a598e](https://github.com/morluto/rea/commit/d4a598e93649607dd293a9c81bbf79c211bc8dd4))
* **errors:** report caller-selected evidence path failures as invalid input ([db177c9](https://github.com/morluto/rea/commit/db177c91b83adb0c3edc4f9f6f06e31ac7523d53))
* **evidence:** cancel exports before atomic publication ([16624f1](https://github.com/morluto/rea/commit/16624f1324e156d14025b2c346596c9781c07488))
* **ghidra:** classify modern Swift manglings in swift type analysis ([#1208](https://github.com/morluto/rea/issues/1208)) ([6935dc7](https://github.com/morluto/rea/commit/6935dc7fe1258b340bb9cdfb8cecae66ef7bc0d4))
* **ghidra:** do not run Java from a relative JAVA_HOME in doctor and setup ([04a516b](https://github.com/morluto/rea/commit/04a516b1e369f7e57e08d0653cc08292ac497e07))
* **ghidra:** do not run Java from a relative JAVA_HOME in doctor and setup ([c3f1698](https://github.com/morluto/rea/commit/c3f169823f690371ecfdd2d1b3b07a5749438cf1))
* **ghidra:** keep and name a runtime directory that close could not remove ([5b769d3](https://github.com/morluto/rea/commit/5b769d3a781c645ed8885e4fabf01a00f0bbc89b))
* **ghidra:** keep and name a runtime directory that close could not remove ([b79d379](https://github.com/morluto/rea/commit/b79d379c25bcc8ed61571c41a94b912b5704a067)), closes [#1190](https://github.com/morluto/rea/issues/1190)
* **ghidra:** keep the NativeAOT target refusal's own recovery advice ([f198993](https://github.com/morluto/rea/commit/f198993f418e6aaa9755e7e6413abcb27c6cd684))
* **ghidra:** preserve decoded return flow evidence ([b189c3c](https://github.com/morluto/rea/commit/b189c3ceb175dd9fa089eada9e9ca54e76307cb3))
* **ghidra:** preserve decoded return flow evidence ([bcc8a77](https://github.com/morluto/rea/commit/bcc8a773e2a714e4899755b786a4fef1539bbace))
* **ghidra:** reject relative installation and Java paths in doctor and setup ([8998438](https://github.com/morluto/rea/commit/8998438c23aa19e68f4ffa7574c5d341aa419165))
* **ghidra:** reject relative installation and Java paths in doctor and setup ([5356856](https://github.com/morluto/rea/commit/53568568bf32b36274ba3a532f1e2cfb2daed271)), closes [#1183](https://github.com/morluto/rea/issues/1183)
* **ghidra:** report NativeAOT host and target refusals as unsupported, not failures ([cfb49eb](https://github.com/morluto/rea/commit/cfb49eb8a88fc51f460907024c51e05a2f272502))
* **ghidra:** report NativeAOT host and target refusals as unsupported, not failures ([42c276a](https://github.com/morluto/rea/commit/42c276af1ec02473a7b6700a31292aae9e53d53e)), closes [#1185](https://github.com/morluto/rea/issues/1185)
* **ghidra:** resolve secondary symbols at function entries ([#1195](https://github.com/morluto/rea/issues/1195)) ([6fbdbd6](https://github.com/morluto/rea/commit/6fbdbd682038d012b04f0fe92c470cf1789fb101))
* **ghidra:** stop dereferencing the removed error payload in address verification ([b80bd2d](https://github.com/morluto/rea/commit/b80bd2db966731fd3cfddfff7e92704053dbe955))
* **ghidra:** stop dereferencing the removed error payload in address verification ([59fbaa2](https://github.com/morluto/rea/commit/59fbaa2d33359216534407f99f49705ac04a3426))
* **ghidra:** use dot-free private session paths ([c3fc6c3](https://github.com/morluto/rea/commit/c3fc6c3aedc202e8ade015c4039a63e9f91cac6d))
* **hopper:** keep the OS error when the FAT64 source cannot be reopened ([9f5dc52](https://github.com/morluto/rea/commit/9f5dc52be8420fb5e874595d63312bf80d07a3a2))
* **hopper:** reserve Linux demo application before launch ([#1158](https://github.com/morluto/rea/issues/1158)) ([33d5ae0](https://github.com/morluto/rea/commit/33d5ae0b52b8684634ecf14d4e9469968c69d462))
* **javascript:** allow cancellation during semantic graph commitment ([#1218](https://github.com/morluto/rea/issues/1218)) ([9405bd6](https://github.com/morluto/rea/commit/9405bd660def9946afaa5fcc1d99921a816911bf))
* **javascript:** classify application input selection failures by cause ([fe5291e](https://github.com/morluto/rea/commit/fe5291e9166977a6ebbfa6ffcf7850af57192b34))
* **javascript:** classify application input selection failures by cause ([0a14bbb](https://github.com/morluto/rea/commit/0a14bbbf05e0e61c98e06326fe7136e52fa4fb3c))
* **javascript:** keep Wakaru version stderr out of the refusal message ([6489d58](https://github.com/morluto/rea/commit/6489d58851d055fd7ce621000d960bb42a0e4ce0))
* **javascript:** match source-map originals that name parent directories ([#1215](https://github.com/morluto/rea/issues/1215)) ([889fb37](https://github.com/morluto/rea/commit/889fb374df0f8986f49e9d61b0fefd536327f781))
* **javascript:** omit self-referential static references with disclosure ([#1157](https://github.com/morluto/rea/issues/1157)) ([b620e2a](https://github.com/morluto/rea/commit/b620e2a2bdcf3683b494d137bc409813735d5572))
* **javascript:** preserve alias and container uncertainty ([73e98b2](https://github.com/morluto/rea/commit/73e98b2516dd792ea7b510aeed6b71f384bea21d))
* **javascript:** preserve graphs with async chunk self-references ([#1152](https://github.com/morluto/rea/issues/1152)) ([7220166](https://github.com/morluto/rea/commit/72201668ed88c2cc822a07c08cf35a1e5ba88f35))
* **javascript:** preserve property paths and uncertain slot presence ([475a0f8](https://github.com/morluto/rea/commit/475a0f84dac63d710e032bc7f731c1a3bda624ec))
* **javascript:** reject encoded separators joined by HTML URL whitespace ([2ddd945](https://github.com/morluto/rea/commit/2ddd9456cd405f081784a4b3cb02cb77cd90fbd6))
* **javascript:** reject encoded separators joined by HTML URL whitespace ([fb57c86](https://github.com/morluto/rea/commit/fb57c8643fb8b4733cbac9090ef58fd13a3b5347))
* **javascript:** report located sources with differing digests as modified ([#1216](https://github.com/morluto/rea/issues/1216)) ([01174c4](https://github.com/morluto/rea/commit/01174c4a81fea109ae712ea1a746a83996f928ac))
* **javascript:** resolve HTML script URLs after URL whitespace and percent decoding ([d601b80](https://github.com/morluto/rea/commit/d601b8016eaeb2955cea4e4c0aca10d17e7d12a7))
* **javascript:** resolve HTML script URLs after URL whitespace and percent decoding ([502528c](https://github.com/morluto/rea/commit/502528c58df54c7b34eefdb5837f36e58f473405)), closes [#1236](https://github.com/morluto/rea/issues/1236)
* **javascript:** resolve package exports targets only to the exact file ([#1181](https://github.com/morluto/rea/issues/1181)) ([2a620c0](https://github.com/morluto/rea/commit/2a620c06cdcaa32844c4a80aeb3df1793f1ce09e)), closes [#1174](https://github.com/morluto/rea/issues/1174)
* keep the Ghidra session root free of dot-prefixed path elements ([a8b8288](https://github.com/morluto/rea/commit/a8b8288396cf2e053db768ef03f4db756aa8f71e))
* **managed:** preserve literal library names during native matching ([81b70bc](https://github.com/morluto/rea/commit/81b70bc358031686c9d7afd049f21719c67a9525))
* **managed:** separate metadata and signature completeness ([2f02eff](https://github.com/morluto/rea/commit/2f02eff9887fc715c33f5d8770a6e6191ba70ca9))
* **mcp:** advertise input patterns without look-around ([1f099a6](https://github.com/morluto/rea/commit/1f099a6fc00b08fb0283dcabc5a238025d4c4c8b))
* **mcp:** advertise input patterns without look-around ([a8701ea](https://github.com/morluto/rea/commit/a8701eaf489692449739d5b2490502b1a14951c5)), closes [#1282](https://github.com/morluto/rea/issues/1282)
* **mcp:** deliver tool errors within advertised schema contracts ([da606ff](https://github.com/morluto/rea/commit/da606ff77718d9a3b10426fcf68c098138e6dcfa)), closes [#1261](https://github.com/morluto/rea/issues/1261)
* **mcp:** deliver typed errors without invalid structured output ([#1277](https://github.com/morluto/rea/issues/1277)) ([7e96f25](https://github.com/morluto/rea/commit/7e96f25f8b1380a13a086a68f8d5a70380468151))
* **mcp:** emit portable Unicode NUL patterns ([#1230](https://github.com/morluto/rea/issues/1230)) ([aa5750c](https://github.com/morluto/rea/commit/aa5750c263632d98d626c5ca3b985bb1519d2395))
* **mcp:** measure tool errors against their text-only delivery ([fe34ec2](https://github.com/morluto/rea/commit/fe34ec2ef3e2968eeb06f64a1a0fdb8b825f56c4))
* **mcp:** measure tool errors against their text-only delivery ([7b51121](https://github.com/morluto/rea/commit/7b51121f7cee21a5938f10ac3b5762e0bb41a58d))
* **mcp:** only recommend exporting retained evidence ([5f749c2](https://github.com/morluto/rea/commit/5f749c2096af2617d4b6b387ff19c13001af8e54))
* name host and tool requirements in optional adapter refusals ([68cb02f](https://github.com/morluto/rea/commit/68cb02fe8b123b9a0778c0065c13a15bcf0e577d))
* name host and tool requirements in optional adapter refusals ([170d0bf](https://github.com/morluto/rea/commit/170d0bf9e2d45b2512ad556c02f31bdc81ea03ca))
* **native:** distinguish batch selectors from resolved entries ([13c3b68](https://github.com/morluto/rea/commit/13c3b68730df80330fd867d921dea38770d5f880))
* **native:** distinguish batch selectors from resolved entries ([bfaa5a6](https://github.com/morluto/rea/commit/bfaa5a6c2c0ddc9e6fcf16cd11ad06f24db174a2))
* **native:** name the CLI flag that selects another plist ([9b69503](https://github.com/morluto/rea/commit/9b6950373cfaa1a2c0d28287bfadd4a421afb9e9))
* **native:** name the plist selection that works when Info.plist is missing ([5612496](https://github.com/morluto/rea/commit/5612496f6d34a462dcd0fb69fa38337592e2f72d))
* **native:** name the plist selection that works when Info.plist is missing ([a6fdf42](https://github.com/morluto/rea/commit/a6fdf426bd98c8cf7b7a7f589208d3193784062f))
* **native:** refuse truncated executable headers at target admission ([d39a450](https://github.com/morluto/rea/commit/d39a450bdfac425962c3a6a6f47b45600057a230))
* **native:** refuse truncated executable headers at target admission ([0b04d38](https://github.com/morluto/rea/commit/0b04d384cca4f22f271d60bcfe67f79cab89c8de)), closes [#1189](https://github.com/morluto/rea/issues/1189)
* **process:** apply one timeout rule to both execFileOutput modes ([3d32819](https://github.com/morluto/rea/commit/3d328193d69a63a355644c51bfb70f524d99bca9))
* **process:** await cleanup on CLI and MCP cancellation ([f6fe575](https://github.com/morluto/rea/commit/f6fe575094658e99ced78d45f385633fbfaaae32))
* **process:** keep ports before a chunk-final period ([184ed97](https://github.com/morluto/rea/commit/184ed970b9021552a5454ced20d202d10cabcbb8))
* **process:** localize capture truncation diagnostics ([#1284](https://github.com/morluto/rea/issues/1284)) ([33bf585](https://github.com/morluto/rea/commit/33bf585185ffcaea63d658e2d3145c900a680485))
* **process:** normalize ports that end a sentence ([098d769](https://github.com/morluto/rea/commit/098d76900effdbc682b0f97bcde7f8711380ecea))
* **process:** normalize ports that end a sentence ([db98a51](https://github.com/morluto/rea/commit/db98a51dd1750b09b3905e18efac526f7ebf90f7))
* **process:** preserve numeric output and original PTY evidence ([c5c75c3](https://github.com/morluto/rea/commit/c5c75c38c3a4ff0153513b8f8ad600d8a5bacc09))
* **process:** preserve numeric output and original PTY evidence ([00d8e44](https://github.com/morluto/rea/commit/00d8e44cbf82caa51709c2e0857fbaa69ea329b7))
* **process:** preserve unknown filesystem absence in partial captures ([c8544b1](https://github.com/morluto/rea/commit/c8544b1574a32838da6d4ed40f2b72582edb60dd))
* **process:** refuse malformed timeouts for stoppable commands ([136d4aa](https://github.com/morluto/rea/commit/136d4aab18d822f0f908096b8acfac556ef1873b))
* **process:** refuse malformed timeouts for stoppable commands ([59c91c8](https://github.com/morluto/rea/commit/59c91c88fe88210b4b22b9f1365a16567513da4a))
* **process:** require current captures and preserve cleanup failures ([2a77469](https://github.com/morluto/rea/commit/2a7746998d47446c4db6d4f524e0f183d6803f3f))
* **process:** retain known events from incomplete captures ([5eb0049](https://github.com/morluto/rea/commit/5eb0049a9f502b404f30e48c3fe3430a942bb0b5))
* **process:** stop cancelled Swift helper builds before removing their files ([cf41561](https://github.com/morluto/rea/commit/cf415619cadcfcb18cda59a54b26c9d164f750a4))
* **process:** stop cancelled Swift helper builds before removing their files ([c717204](https://github.com/morluto/rea/commit/c7172047951e7dbb9df58b57ff1b43ac9bd47909)), closes [#1173](https://github.com/morluto/rea/issues/1173)
* **process:** stop timed-out commands with the caller's stop signal ([4b38d18](https://github.com/morluto/rea/commit/4b38d1899566089d19b9fd137202f7d86b62fc6f))
* **process:** stop timed-out commands with the caller's stop signal ([063de50](https://github.com/morluto/rea/commit/063de5014f19e85c38b6bec5984de4f38e71adaa))
* **process:** treat non-ASCII letters as port continuations ([ad813e4](https://github.com/morluto/rea/commit/ad813e473b094ab0d3ab30798b7d252e2f4beb94))
* **process:** validate terminal byte totals against retained frames ([69833fb](https://github.com/morluto/rea/commit/69833fb0d0fe9b320b5745a992822342f2c54a92))
* **process:** validate terminal byte totals against retained frames ([39eb058](https://github.com/morluto/rea/commit/39eb0587c95ad028bb961c539ad1f326a1e8d81c))
* **providers:** preserve observations and primary cleanup failures ([0696bde](https://github.com/morluto/rea/commit/0696bde2660bb5d6538d8c01da15aa023312aa9f))
* **reference:** represent unreadable symlink targets explicitly ([b7b4333](https://github.com/morluto/rea/commit/b7b433370310c3ffe33d5027d8393151d5e862da))
* restore caching, preserve failures, and verify fixture claims ([#1211](https://github.com/morluto/rea/issues/1211)) ([27a9cea](https://github.com/morluto/rea/commit/27a9ceade7232c1c9a24dc7d454ae060948183a1))
* **server:** report 2025-era client identity and features in binary_session ([e6abaef](https://github.com/morluto/rea/commit/e6abaefbbc2bd81a6be34cbe71b87be801158c16))
* **server:** report 2025-era client identity and features in binary_session ([b8312fa](https://github.com/morluto/rea/commit/b8312fa8d184ba9f422d1f5592fb41e49811544a)), closes [#1167](https://github.com/morluto/rea/issues/1167)
* **session:** require an open target for session-bound native and artifact tools ([d8e314c](https://github.com/morluto/rea/commit/d8e314cb24e7a4a494347e45474234e0aad74ad1))
* **session:** require an open target for session-bound native and artifact tools ([cf77d07](https://github.com/morluto/rea/commit/cf77d073fc06ab95ce4181c30d68b1346e990b64)), closes [#1166](https://github.com/morluto/rea/issues/1166)
* **session:** retain failed provider cleanup for lifecycle retries ([#1260](https://github.com/morluto/rea/issues/1260)) ([24a3aa0](https://github.com/morluto/rea/commit/24a3aa08d1f69e25b441f086300ba3082d860a35))
* **setup:** keep Codex TOML comments when adding or removing REA ([f5539cf](https://github.com/morluto/rea/commit/f5539cfc2f6c0daf6c275fc97f3351e2cf89b2c3))
* **setup:** keep Codex TOML comments when adding or removing REA ([e9c48a6](https://github.com/morluto/rea/commit/e9c48a61e4c2c05c5b77ef4a815c5b2a65a9337e)), closes [#1163](https://github.com/morluto/rea/issues/1163)
* **setup:** preserve initial backups and Codex comments ([#1204](https://github.com/morluto/rea/issues/1204)) ([6051cb2](https://github.com/morluto/rea/commit/6051cb2c0c723d88dc43ee5ef8a96971bf84d49e))
* **setup:** stop remaining uninstall removals after a client fails ([fd975c7](https://github.com/morluto/rea/commit/fd975c75fa353840e6e887232ca68496cf8705ea))
* **setup:** stop uninstall before removals when a client config is unsafe ([4fb2f3e](https://github.com/morluto/rea/commit/4fb2f3e6ed0233505eada3cddeeff0ea0bfc6fe5))
* **setup:** stop uninstall before removals when a client config is unsafe ([5cc841d](https://github.com/morluto/rea/commit/5cc841d5c154f692bdc257e106cc4b212dc19dc0)), closes [#1164](https://github.com/morluto/rea/issues/1164)
* **snapshot:** report query workflow and Evidence counts separately ([04aef6d](https://github.com/morluto/rea/commit/04aef6df331634238cfc61f320ba4a4e720750a4))
* **snapshot:** report query workflow and Evidence counts separately ([0e77953](https://github.com/morluto/rea/commit/0e779533a9108a550b4d10dcb3920f91c7d48989))
* **website:** clarify Android host and JDK requirements ([5691606](https://github.com/morluto/rea/commit/5691606aa948bddc641e3ecbccf5375a12b65924))
* **website:** identify publication verifier requests ([e6905c1](https://github.com/morluto/rea/commit/e6905c18e09c41e04525fb1a84575483df789204))
* **windows:** retain runtime authority after cleanup failure ([af7a439](https://github.com/morluto/rea/commit/af7a43963351c655eb86197bf52ae798a04e9c22))
* **windows:** retain unsettled jobs for cleanup retry ([76b214e](https://github.com/morluto/rea/commit/76b214e45fa05fe723e216894327185b9b4e6f53))


### Performance Improvements

* **mcp:** share repeated output schema definitions. ([441813c](https://github.com/morluto/rea/commit/441813c0708dbee82ef554c91e973ae02964bf2e))

* **hopper:** resolve string search records once per query ([#1229](https://github.com/morluto/rea/issues/1229)) ([9426c3f](https://github.com/morluto/rea/commit/9426c3f1bbb94711d8b33097e604b9b8ed853b5e))
* **mcp:** reuse input schemas without losing caller guidance ([#1162](https://github.com/morluto/rea/issues/1162)) ([e1afbc1](https://github.com/morluto/rea/commit/e1afbc1914cc7ff90265313e942f34ea4a58a4fc))
* **snapshot:** avoid redundant result copies and serialization ([552634d](https://github.com/morluto/rea/commit/552634d634655a722b2204cfbc4b29f6d442c294))
* **snapshot:** avoid redundant result copies and serialization ([569d2bc](https://github.com/morluto/rea/commit/569d2bc6b9f600114267a4c69f8400393ea1bc2f))


### Code Refactoring

* **domain:** remove obsolete comparison representations ([5510b27](https://github.com/morluto/rea/commit/5510b27d7f863a3df26212fba4a59f8df0da3712))
* enforce canonical evidence and provider boundaries ([63bf914](https://github.com/morluto/rea/commit/63bf91405cf97b114a84f337fb1272d98a267999))
* remove forwarding exports and redundant aliases ([ad59531](https://github.com/morluto/rea/commit/ad59531a960a0c51ef6857fa1391270dda0fa7a4))
* **schemas:** share portable identifier and base64 patterns ([#1227](https://github.com/morluto/rea/issues/1227)) ([954badb](https://github.com/morluto/rea/commit/954badbaaadd24a210190ce3015e40c23d327567))


### Documentation

* add French README translation ([84094af](https://github.com/morluto/rea/commit/84094af54a4e0a6247445e59abff27bc4eca361b))
* add French README translation ([9664b2b](https://github.com/morluto/rea/commit/9664b2b101fe4ac334b2911f9210b50d58d90a89))
* celebrate 30,000 GitHub stars 🎉 ([6987cb0](https://github.com/morluto/rea/commit/6987cb066a5aa5e51480bb06a93a758e6f67cd1e))
* celebrate 30,000 GitHub stars 🎉 ([beca997](https://github.com/morluto/rea/commit/beca9977eb2b18fc7b9844cff0ca70004b6ff21a))
* clarify REA has no affiliated cryptocurrency or token ([#1214](https://github.com/morluto/rea/issues/1214)) ([c2d8146](https://github.com/morluto/rea/commit/c2d8146f94c7533eb87681c2405e93bdfef21b59))
* explain 6.2 contract and saved-data migration ([#1304](https://github.com/morluto/rea/issues/1304)) ([c267e99](https://github.com/morluto/rea/commit/c267e9922751c03df312655ebd623de1b480215c))
* **ghidra:** explain supported heap and CPU controls ([#1278](https://github.com/morluto/rea/issues/1278)) ([0c6852b](https://github.com/morluto/rea/commit/0c6852b392b34319a6fd2c6dffcac10cee51ab94)), closes [#1255](https://github.com/morluto/rea/issues/1255)
* keep the 30k milestone in Star History ([#1217](https://github.com/morluto/rea/issues/1217)) ([c399670](https://github.com/morluto/rea/commit/c399670653884673158f314ed38260aef74da593))
* require focused brittleness cleanup and executable examples ([d6832c3](https://github.com/morluto/rea/commit/d6832c3632847cf3e62d4082b4b8b8d9af554633))
* thank feature request contributors ([9db1fd0](https://github.com/morluto/rea/commit/9db1fd0bd7b17ed1dd21b9c72dabfa4ec6c23a3f))
* **website:** continue the Calculator example with reconstruction ([4578647](https://github.com/morluto/rea/commit/4578647c59a7487bce597a65be6eab8be0412e84))
* **website:** continue the Calculator example with reconstruction ([18a1e8c](https://github.com/morluto/rea/commit/18a1e8cd0efe14c06fd14aabe0c318d2ae390f78))
* **website:** explain SEO maintenance and indexing follow-up ([bb8ff2c](https://github.com/morluto/rea/commit/bb8ff2cfba638ee3a77f951c01e98340c757f525))
* **website:** introduce the worked homepage examples ([f6f5c16](https://github.com/morluto/rea/commit/f6f5c160979624cdcb33928f1a77cf000de403d4))
* **website:** invite deeper projects and reader feedback ([3fb9ffa](https://github.com/morluto/rea/commit/3fb9ffaa4d67685412873cbd3101c64fabbeaff3))


### Tests

* **apple:** verify compiled Mach-O root occurrence facts ([#1300](https://github.com/morluto/rea/issues/1300)) ([4bb4c6f](https://github.com/morluto/rea/commit/4bb4c6fe6d34525c7665a9d38b584b026dd5cdd9))
* **artifacts:** assert asset-catalog target refusal only on macOS ([44d5b4b](https://github.com/morluto/rea/commit/44d5b4b25e0831769c1bd4e5426ef498d0bd3c74))
* **artifacts:** pin per-occurrence roles for direct Mach-O roots and shared bytes ([701d90a](https://github.com/morluto/rea/commit/701d90aba48aaf4f23e1a73e46ebf9968fb85293))
* **artifacts:** pin per-occurrence roles for direct Mach-O roots and shared bytes ([b9e29c5](https://github.com/morluto/rea/commit/b9e29c52d483704c64cd88f87eaa117066288602)), closes [#1234](https://github.com/morluto/rea/issues/1234) [#1235](https://github.com/morluto/rea/issues/1235)
* **artifacts:** read /bin/ls slice layout from its FAT table ([#1223](https://github.com/morluto/rea/issues/1223)) ([c89b3a0](https://github.com/morluto/rea/commit/c89b3a00dce8df36ddb696b59c80e1adc6aceac1))
* **artifacts:** verify compiled Mach-O roles and permissions ([4bb4c6f](https://github.com/morluto/rea/commit/4bb4c6fe6d34525c7665a9d38b584b026dd5cdd9))
* consolidate redundant assertions into boundary workflows ([b71a591](https://github.com/morluto/rea/commit/b71a591a60e3fa5333889e3cf97e05f4ae03c686))
* **ghidra:** preserve selected verification resource limits ([1c3766a](https://github.com/morluto/rea/commit/1c3766a8bcc8a2b6af679cdaa92a73fec42b3372))
* **ghidra:** size oversized annotations for canonical delivery ([1e34197](https://github.com/morluto/rea/commit/1e341973cfad1dbf06755f3a086ffc23d42a723c))
* **ghidra:** use host-native absolute session root fixtures ([1e83d27](https://github.com/morluto/rea/commit/1e83d270c2098b1bcb59591698a257a05d2296fc))
* **javascript:** expect the invalid input_path code in the streamed CLI failure test ([d186ca7](https://github.com/morluto/rea/commit/d186ca7e41928fc2748de2631f5cb43115776571))
* **mcp:** read bundle failures from public error content ([69c3b32](https://github.com/morluto/rea/commit/69c3b32a21c90ea96194fb695f7b58992e8b3714))
* **mcp:** read typed errors in canonical Evidence regressions ([fd46cff](https://github.com/morluto/rea/commit/fd46cff017f0110aaab1216764cf01a71b341766))
* **mcp:** validate public error diagnostics in acceptance workflows ([09058eb](https://github.com/morluto/rea/commit/09058ebc4a68c76d865a92dbddb65811ba8344f7))
* **native:** assert batch identity in production registration ([933fcb3](https://github.com/morluto/rea/commit/933fcb33c1fa1eae109228b89c1200abb7745eb8))
* **native:** build the .app fixture executable with a complete Mach-O header ([facaae8](https://github.com/morluto/rea/commit/facaae865af243656ab8f557aeb42f5909748f2b))
* **process:** check malformed capture choices concurrently ([6020a0b](https://github.com/morluto/rea/commit/6020a0b3683ce16e1441963473605f870c247e29))
* **process:** check malformed capture choices concurrently ([48de11c](https://github.com/morluto/rea/commit/48de11ce2e5af9810fc97d1c2f89df56bf3a3d4d))
* remove duplicate workflow examples and self assertions ([d6d1cd2](https://github.com/morluto/rea/commit/d6d1cd248506015b59a2abdbbb84e3dbd02388fc))


### Continuous Integration

* **website:** allow explicitly requested Pages-only publication ([796b65e](https://github.com/morluto/rea/commit/796b65e1cd15f3cf819396716320db007655ee3f))
* **website:** allow explicitly requested Pages-only publication ([864160d](https://github.com/morluto/rea/commit/864160d8858fad3c0afebff81c31b090a1ebf823))
* **website:** allow explicitly requested Pages-only publication ([#1205](https://github.com/morluto/rea/issues/1205)) ([796b65e](https://github.com/morluto/rea/commit/796b65e1cd15f3cf819396716320db007655ee3f))
* **website:** publish Cloudflare and Pages from one artifact ([761881c](https://github.com/morluto/rea/commit/761881cec33b18d7228bae5e2093e5d44b96ceb1))

## [6.1.0](https://github.com/morluto/rea/compare/rea-agents-6.0.0...rea-agents-6.1.0) (2026-10-09)


### ⚠ BREAKING CHANGES

* **hopper:** Hopper regex mode uses ECMAScript Unicode syntax instead of Python re. Matching runs in a cancellable worker with a five-second deadline; literal mode keeps Unicode casefold matching.
* **hopper:** remove set_current_document. Use open_binary to switch targets; document arguments are scoped to the active target.

### Features

* **clients:** register Grok Build and Grok Bot during setup ([#1134](https://github.com/morluto/rea/issues/1134)) ([08561e0](https://github.com/morluto/rea/commit/08561e0eb7a4a01a256f3693a97061fbea7fb8fa))
* **ghidra:** make the startup deadline configurable ([#974](https://github.com/morluto/rea/issues/974)) ([d84bc8f](https://github.com/morluto/rea/commit/d84bc8f11abd6cbf5612daf5c8f7e1805d23c16e))
* **website:** add GitHub link with live star count ([2f59287](https://github.com/morluto/rea/commit/2f59287f1a1794a68102a45c61cc657659fa5de6))


### Bug Fixes

* **analysis:** bind overview document identity to the active target ([#1094](https://github.com/morluto/rea/issues/1094)) ([81b5104](https://github.com/morluto/rea/commit/81b51042767ad75310bad1a7a9faf954339841c0))
* **analysis:** resolve procedure identities and preserve literal queries ([d830cb7](https://github.com/morluto/rea/commit/d830cb79b305e6d4d255f8080de69ca668cbe0af))
* **android:** report actual provider readiness ([c715af8](https://github.com/morluto/rea/commit/c715af80587f808de816d3add6a6f989437ab66a))
* **android:** report startup and selector failure causes ([6c13fc8](https://github.com/morluto/rea/commit/6c13fc8e0a318ebe7be6b038089b350d99f8e286))
* **apple:** account for repeated archive projections ([e1df5e8](https://github.com/morluto/rea/commit/e1df5e85551125b27ef0debb7573de5507b149e1))
* **apple:** budget Interface Builder decoding and projection ([dbcf8c3](https://github.com/morluto/rea/commit/dbcf8c33915d924fdbc881bf2cf9676587f3b96f))
* **apple:** classify empty dyld settings by consumer semantics ([#1110](https://github.com/morluto/rea/issues/1110)) ([fe297e5](https://github.com/morluto/rea/commit/fe297e56e804130dd49cc0a95fcf2d115c183ae3))
* **apple:** decode bundle plist bytes before executable lookup ([d575a73](https://github.com/morluto/rea/commit/d575a7340bb19b84733c79b14de9f4df7181c6b3))
* **apple:** decode Interface Builder XML byte encodings ([#1095](https://github.com/morluto/rea/issues/1095)) ([f8e143a](https://github.com/morluto/rea/commit/f8e143a3bcd20ddcc0d76d90e73e238d456fe5a3))
* **apple:** derive dispatch coverage from located decode facts ([488f448](https://github.com/morluto/rea/commit/488f448ae27fd62904967ec1e0ab072e834a9822))
* **apple:** keep skipped catalog entries from reading as absence ([a079af2](https://github.com/morluto/rea/commit/a079af297bb454417dfd3d89b0037397554ad83e))
* **apple:** report apps without asset catalogs as empty inventories ([e2f0378](https://github.com/morluto/rea/commit/e2f03786f496ed742572acd87f47270c958171ec))
* **apple:** report apps without asset catalogs as empty inventories ([79e5a39](https://github.com/morluto/rea/commit/79e5a3923db896323c0491e31004214856529b74))
* **apple:** report missing keyed archive hierarchy references ([#1104](https://github.com/morluto/rea/issues/1104)) ([3b2ec69](https://github.com/morluto/rea/commit/3b2ec69c54fc9cf65bf8441edbb96e9619c3a37e))
* **apple:** validate dylib candidates and preserve search uncertainty ([#1100](https://github.com/morluto/rea/issues/1100)) ([7914e36](https://github.com/morluto/rea/commit/7914e36ab9adbbf591a6e1f3fafcb2e17f55d667))
* **apple:** validate physical slices and dylib platform compatibility ([15f92f2](https://github.com/morluto/rea/commit/15f92f298891c8b16d7d13c78cb6ca66cb90cd85))
* **application:** budget bridge candidate projection by bytes ([3d450a2](https://github.com/morluto/rea/commit/3d450a29fc91cef3e06ffce9a925ac70dcb24272))
* **artifacts:** preserve keyed archive integer precision ([4034883](https://github.com/morluto/rea/commit/4034883e9860a97edee03260fab59f9229debfa6))
* **artifacts:** report keyed-archive selection mistakes as invalid input ([5a55d5b](https://github.com/morluto/rea/commit/5a55d5b1c6aefb4a4e5df63ec43b7e2fc0a7d385))
* **artifacts:** report keyed-archive selection mistakes as invalid input ([25fb6d3](https://github.com/morluto/rea/commit/25fb6d32a325d88bb0f4e05e16f5f82e4f91c5ca))
* **artifacts:** retain failed DMG cleanup state and diagnostics ([#1103](https://github.com/morluto/rea/issues/1103)) ([4bb056b](https://github.com/morluto/rea/commit/4bb056bbb5b735e214ed8d725aa3de1c06fb0dc9))
* **browser:** advertise zero-based units for runtime source coordinates ([#1085](https://github.com/morluto/rea/issues/1085)) ([6218d28](https://github.com/morluto/rea/commit/6218d289e241715d0868004caafe15b5c4758450))
* **browser:** bind correlated replies to their selected session ([96d3caf](https://github.com/morluto/rea/commit/96d3cafb0725881b6cdab0e2185104957dc69f71))
* **browser:** bound aggregate source-map decoding before expansion ([f983c71](https://github.com/morluto/rea/commit/f983c718c33789ee40aec43f84315f6b53e95bde))
* **browser:** bound script metadata and preserve omissions ([faf209e](https://github.com/morluto/rea/commit/faf209e50d9faab03a185c1f044de3582552d11e))
* **browser:** bound source-map fetches and retain predecessor requests ([eaf5734](https://github.com/morluto/rea/commit/eaf57340831a753faec58246290f9502d159b6b1))
* **browser:** compose nested source-map column offsets ([#1109](https://github.com/morluto/rea/issues/1109)) ([8b08ec0](https://github.com/morluto/rea/commit/8b08ec0af936405fd20db25f941e2ae6318c5145))
* **browser:** keep initiator callsites out of script coordinate guidance ([#1096](https://github.com/morluto/rea/issues/1096)) ([3c157b4](https://github.com/morluto/rea/commit/3c157b4ec6297e6737bd3c2ec3dc520c7403402f))
* **browser:** normalize selected script manifest roots on Windows ([#1078](https://github.com/morluto/rea/issues/1078)) ([b49beb4](https://github.com/morluto/rea/commit/b49beb42d7a97f73d052a27fb99673b1bd0d3d39))
* **browser:** preserve captures when response bodies are unavailable ([96af2fa](https://github.com/morluto/rea/commit/96af2fa7444a3777d51ff46202ef563146929dbd))
* **browser:** preserve command failures and reject malformed replies ([6b92002](https://github.com/morluto/rea/commit/6b92002597d34555c32ebf24b9db6e4c17c0a08d))
* **browser:** treat module-import initiator positions as script positions ([ae0630a](https://github.com/morluto/rea/commit/ae0630a619ee2c98a68e65ca44bf0b93424e2f8e))
* **browser:** treat module-import initiator positions as script positions ([99d31ee](https://github.com/morluto/rea/commit/99d31ee24ad060babace9eca3325858418e0f55a))
* **browser:** validate and bound source-map evidence ([0a0174b](https://github.com/morluto/rea/commit/0a0174b9ac8a73b61094e857a2950f4e5a06f544))
* **build:** exclude the test-only generated catalog from packages ([#1116](https://github.com/morluto/rea/issues/1116)) ([d1c904b](https://github.com/morluto/rea/commit/d1c904bac7977d44b06bf2f823587baedcc88b9e))
* **build:** make catalogs and packaged skills generated outputs ([#1086](https://github.com/morluto/rea/issues/1086)) ([e613405](https://github.com/morluto/rea/commit/e6134056cf519410160a196363f8a04f0729324e))
* **capture:** retain Electron observations and HAR resource failures ([44fd183](https://github.com/morluto/rea/commit/44fd18305fa5a8893ebb5b952099fdf45dbd6e55))
* **ci:** align diagnostic regressions and format merged changes ([67756da](https://github.com/morluto/rea/commit/67756dacc0d435a61d2d0c403412151769da028f))
* **ci:** restore generated shard inputs and cleanup assertions ([5f93b4b](https://github.com/morluto/rea/commit/5f93b4b125e78f088a2349a178e60f8c0af3e1a2))
* **cli:** accept exact native names through explicit selectors ([c313606](https://github.com/morluto/rea/commit/c3136064c7f8f72b2f6c6799ec41ea6424111bb7))
* **cli:** drive mcp doctor help from a single option schema ([b7d803d](https://github.com/morluto/rea/commit/b7d803dd10c7ef8bb73f81f5e893168af8ea86e6))
* **cli:** preserve blank JSON paths for input validation ([#1068](https://github.com/morluto/rea/issues/1068)) ([3dcb732](https://github.com/morluto/rea/commit/3dcb732da33f6ceef597506b14a4536f1c9aff96))
* **cli:** preserve web cancellation exit status ([1d9b96a](https://github.com/morluto/rea/commit/1d9b96a9c497694592137cf95bea2af0a190abe7))
* **cli:** support MCP doctor help ([a69b833](https://github.com/morluto/rea/commit/a69b8337ab38707aaad2ac2fedb652f05afeb71c))
* **contracts:** preserve local inputs and comparison uncertainty ([70e8a8f](https://github.com/morluto/rea/commit/70e8a8f86060496452ccbc1a49b39822efef4113))
* **docs:** validate translated links to canonical product facts ([34f7c4f](https://github.com/morluto/rea/commit/34f7c4fd661e07db66c560a4d54272b0163a52b6))
* **domain:** order canonical paths by code point, not UTF-16 unit ([#1034](https://github.com/morluto/rea/issues/1034)) ([b5c2954](https://github.com/morluto/rea/commit/b5c2954ad67f0280732df043d5d9702f3d202819))
* **domain:** preserve prototype-named JSON members through Evidence boundaries ([#1049](https://github.com/morluto/rea/issues/1049)) ([40e18b2](https://github.com/morluto/rea/commit/40e18b2e37f2be11f452606c2d875981b03ad03e))
* **domain:** reject excessive JSON depth with actionable diagnostics ([#1029](https://github.com/morluto/rea/issues/1029)) ([bfbfc73](https://github.com/morluto/rea/commit/bfbfc7330aa7175018de04f1d099b8d4aeec3bd1))
* **electron:** bound hook retention and report dropped coverage ([02d0702](https://github.com/morluto/rea/commit/02d07027617a5df014f92a351aa9418aade6f06f))
* **evidence:** name the failed constraint when a bundle is rejected ([82a1a52](https://github.com/morluto/rea/commit/82a1a525d7aa725d939926ba953434fbf5db0ab0))
* **evidence:** name the failed constraint when a bundle is rejected ([cf96ceb](https://github.com/morluto/rea/commit/cf96ceb2119f52f61a621d2a790b7c8804c65595))
* **evidence:** report missing evidence files instead of permission advice ([e8b92a4](https://github.com/morluto/rea/commit/e8b92a40c003a5e6ce3cefe4ad18392d39759653))
* **evidence:** report missing evidence files instead of permission advice ([89252f1](https://github.com/morluto/rea/commit/89252f1f35de91494bd49460b1645d8c09cc6d33))
* **evidence:** require a complete record before the single-record hint ([38bbb65](https://github.com/morluto/rea/commit/38bbb656da2659088e30a1ca3e4434b2f65bab32))
* **firmware:** reject malformed UTF-8 producer reports ([4a45c14](https://github.com/morluto/rea/commit/4a45c14742e6868f687cead2ddf736c3f7c49acd))
* **ghidra:** admit Linux arm64 with matching native tools ([3e598b2](https://github.com/morluto/rea/commit/3e598b2d38a728cd9fd4a359741500a021ba9d3a))
* **ghidra:** harden location resolution and provider lifecycle ([1f5be75](https://github.com/morluto/rea/commit/1f5be750bced759339183945488cea352b18f28b))
* **ghidra:** make qualified function renames idempotent ([4458128](https://github.com/morluto/rea/commit/4458128a845c1448140b44d6e62d6ccfe611d37c))
* **ghidra:** parse long procedure selectors without recursion ([480b16b](https://github.com/morluto/rea/commit/480b16b9c151e1d4bfbca8b49a0668d74ceaa400))
* **ghidra:** preserve function references and snapshot boundaries ([84a17d5](https://github.com/morluto/rea/commit/84a17d55199b1b46493aea6bf4e41029a3b200fc))
* **ghidra:** preserve POSIX runtime paths with spaces ([80c3d36](https://github.com/morluto/rea/commit/80c3d36dfa2597f34fdeb69e0ba75277ee50c85c))
* **ghidra:** preserve source failures and snapshot ownership ([704fa76](https://github.com/morluto/rea/commit/704fa7699ca183d5d5e0518a6fcdbb953ec35a10))
* **ghidra:** preserve Unicode boundaries without breaking sessions ([bef234d](https://github.com/morluto/rea/commit/bef234d6ce63cd296a654400443fcdbbcd44d7de))
* **ghidra:** recover regex stack exhaustion without losing annotations ([bc4aa46](https://github.com/morluto/rea/commit/bc4aa46d7c3960a1f325523e48aed2089b176e84))
* **ghidra:** reject address truncation before reads and edits ([dcae3c6](https://github.com/morluto/rea/commit/dcae3c6c148582d235f5650aace6f9744eeb153c))
* **ghidra:** resolve exact external function entries ([549effa](https://github.com/morluto/rea/commit/549effa056729e5f9239d9ed7864537a9c49e421))
* **hopper:** bind analysis to the active target and correct boundary contracts ([2f71375](https://github.com/morluto/rea/commit/2f71375efc517bb9e6f9800f8e8a6849766bc893))
* **hopper:** bind file mappings to verified source bytes ([82626c4](https://github.com/morluto/rea/commit/82626c4499a53c227187575d40a845fadd5318e2))
* **hopper:** diagnose MCP provider failures with stage, state, and request context ([#1044](https://github.com/morluto/rea/issues/1044)) ([5a67c7f](https://github.com/morluto/rea/commit/5a67c7fc540c494371de76dcdf353923656993d3))
* **hopper:** enforce caller-supplied request deadlines ([#1119](https://github.com/morluto/rea/issues/1119)) ([e8939ca](https://github.com/morluto/rea/commit/e8939ca2208bc41454b73b90a32418714e6a2969))
* **hopper:** isolate regex matching from the native API thread ([f201b04](https://github.com/morluto/rea/commit/f201b04fbbb29591b0d2bb3f3b24636526e4ec4e))
* **hopper:** load verified FAT64 slices with native Mach-O semantics ([0a49d5b](https://github.com/morluto/rea/commit/0a49d5bfb931124d3d398dfbd64e9f6ae8a01405))
* **hopper:** normalize native block endpoints and retain terminal evidence ([2847311](https://github.com/morluto/rea/commit/2847311a579ce2da4c8ded4d89fcdd01545e6da5))
* **hopper:** preserve launcher evidence on readiness timeout ([458771c](https://github.com/morluto/rea/commit/458771cb583e38b848b3d8c58595d163143ff50a))
* **hopper:** preserve native navigation and annotation semantics ([f2e22e1](https://github.com/morluto/rea/commit/f2e22e13a6956985bd65a2d75e4db7e3128cce81))
* **hopper:** preserve owned basic-block endpoint instructions ([#1118](https://github.com/morluto/rea/issues/1118)) ([329cf20](https://github.com/morluto/rea/commit/329cf206d1111c051733c7115cabff4b46722deb))
* **hopper:** preserve partial native call and string evidence ([2461702](https://github.com/morluto/rea/commit/246170238ebb8669a20b57b559b03cfc26ee1b8c))
* **hopper:** preserve typed string values and verify real searches ([7d7b3f9](https://github.com/morluto/rea/commit/7d7b3f961af2dc9b7572e91aaec29e6c4eccf9d5))
* **hopper:** report launcher failures before bridge timeout ([#1105](https://github.com/morluto/rea/issues/1105)) ([cd756b0](https://github.com/morluto/rea/commit/cd756b07d5b9c06e085d778e9f1c4fc9bd403219))
* **hopper:** resolve FAT loaders and original file coordinates ([35f1ddd](https://github.com/morluto/rea/commit/35f1ddd6bc77588b9971961cd70968a815aae266))
* **hopper:** validate annotation destinations and symbol extents ([b2d5bc1](https://github.com/morluto/rea/commit/b2d5bc110914f2ad42d17bc739d5f37c1b0f0a4d))
* **hopper:** verify lease cleanup and repair the macOS test lane ([#1111](https://github.com/morluto/rea/issues/1111)) ([b743bd2](https://github.com/morluto/rea/commit/b743bd20a0cbc39728e2e822fa75c013d87e1730))
* **inspector:** bound retained metadata and preserve cancellation ([e714fb0](https://github.com/morluto/rea/commit/e714fb027afdf11bfbb0838722523d3fa9ebf244))
* **install:** guard empty prefix_args expansion on macOS Bash 3.2 under set -u ([#1061](https://github.com/morluto/rea/issues/1061)) ([68b9fa4](https://github.com/morluto/rea/commit/68b9fa489b0c07f580633785ec61c17fa20b5083))
* **javascript:** bound primitive string growth and repeated evaluation ([4a1837d](https://github.com/morluto/rea/commit/4a1837d9d52b1a6454469e2dc63eeb8d716fb296))
* **javascript:** bound semantic expansion and resolve lexical receivers ([16f4609](https://github.com/morluto/rea/commit/16f4609d689445c05a0befc744fce7e72f7047ec))
* **javascript:** classify direct defaults and argv elements ([6495171](https://github.com/morluto/rea/commit/649517181268a0b729970b7cbbda15e04b199e32))
* **javascript:** honor cancellation before evidence publication ([#1098](https://github.com/morluto/rea/issues/1098)) ([cc0ee2e](https://github.com/morluto/rea/commit/cc0ee2edc60dda42d7b7cfb2c08e39b0b736b5e9))
* **javascript:** omit self-referential import edges with disclosure ([#1130](https://github.com/morluto/rea/issues/1130)) ([1d7115b](https://github.com/morluto/rea/commit/1d7115b7b470719a32e477ca3cbb681f0ad408b8))
* **javascript:** parse plain TypeScript artifact dialects ([#1102](https://github.com/morluto/rea/issues/1102)) ([3db4681](https://github.com/morluto/rea/commit/3db46813f80f84504c5b87c73a4bece82a8fdc5e))
* **javascript:** preserve HTML carriage return source ranges ([#1092](https://github.com/morluto/rea/issues/1092)) ([23862af](https://github.com/morluto/rea/commit/23862af1b57413e09abf394f6e4f8369f6355d5a))
* **javascript:** preserve lexical open and exact template semantics ([d6cc9ca](https://github.com/morluto/rea/commit/d6cc9ca3a6e92604c837f61c193baf5abedaabc8))
* **javascript:** preserve original BOM source coordinates ([#1093](https://github.com/morluto/rea/issues/1093)) ([83defc0](https://github.com/morluto/rea/commit/83defc054b69e94da888d70bb3b05d835e1bf74d))
* **javascript:** retain NodeNext artifact source facts ([#1087](https://github.com/morluto/rea/issues/1087)) ([c1b370c](https://github.com/morluto/rea/commit/c1b370ce0dfcbd5725cf6aebe23b022dfc75ac84))
* **javascript:** use Node legacy package entry fields ([1706005](https://github.com/morluto/rea/commit/170600541bf44f2a63731e8b3d42aae3cbb8d6b3))
* **managed:** bind inspection evidence to artifact identity ([73b09f4](https://github.com/morluto/rea/commit/73b09f4c5c511ce80baa0c89717181bbe0ecba8f))
* **managed:** match exact method bytes without decoded signatures ([17809ca](https://github.com/morluto/rea/commit/17809caacd0f44fcc7c1af42932ea655489d64ae))
* **mcp:** flatten root union input schemas ([#1062](https://github.com/morluto/rea/issues/1062)) ([6a7650e](https://github.com/morluto/rea/commit/6a7650e93cba9169baad95d2c52b11351ae39d0e))
* **mcp:** preserve retained evidence on oversized delivery ([0639a54](https://github.com/morluto/rea/commit/0639a541a3b712940119f59e8189bc962b267726))
* **mcp:** retain complete application results across response limits ([a1ed423](https://github.com/morluto/rea/commit/a1ed4232de635d4acc0dd9eb293e309a29d03e80))
* **mcp:** retain oversized errors before transport delivery ([b3f1b4e](https://github.com/morluto/rea/commit/b3f1b4e822aec5626d1952a88f50c7520dc265d3))
* **metadata:** stop schema changes churning generated skill evidence ([#1075](https://github.com/morluto/rea/issues/1075)) ([d52f66d](https://github.com/morluto/rea/commit/d52f66d62a93ec09cccdf53e64e3ccd24d16e520))
* **native:** bind signature observations to registered target versions ([#1099](https://github.com/morluto/rea/issues/1099)) ([c789af0](https://github.com/morluto/rea/commit/c789af04b76c0e76a522a5dece34f461288f5ecd))
* **native:** bound retained observations and preserve failure evidence ([7c32387](https://github.com/morluto/rea/commit/7c323870c2dcab78654ee7a80128b06affdf2bbe))
* **native:** preserve bridge failure types during cleanup ([1d0baa3](https://github.com/morluto/rea/commit/1d0baa352fc76d1760abbe29a3cc80fa17296916))
* **native:** resample tool identity for each invocation ([14b19a0](https://github.com/morluto/rea/commit/14b19a0b8a5af401212c552173e761eac53bfe46))
* **native:** share command supervision and retain failure output ([f2e9c49](https://github.com/morluto/rea/commit/f2e9c491ea00bf79d5665102d95a3339b63cfe4f))
* **native:** supervise LLDB and preserve bounded capture uncertainty ([915855e](https://github.com/morluto/rea/commit/915855e75ca3fe3b1b54978ace6bbe10d1973f64))
* **process:** avoid cold ownership helper deadline exhaustion ([#1139](https://github.com/morluto/rea/issues/1139)) ([65a809a](https://github.com/morluto/rea/commit/65a809a0da0555aa8eeafbc2ec2559517471be02))
* **process:** derive executable names from the capture host ([#1108](https://github.com/morluto/rea/issues/1108)) ([34cc925](https://github.com/morluto/rea/commit/34cc9259c1076a0d9575a87679befca692ec86c2))
* **process:** identify unknown live processes in cleanup diagnostics ([eb89a16](https://github.com/morluto/rea/commit/eb89a16d9bc51b65dcc75e05f8492de894320753))
* **process:** name the reason two captures cannot be compared ([#1080](https://github.com/morluto/rea/issues/1080)) ([eb69763](https://github.com/morluto/rea/commit/eb69763d27e29fe3247c008925016e4c73cb6abe))
* **process:** preserve observations after successful cleanup ([2af12a1](https://github.com/morluto/rea/commit/2af12a18a36bb80fb7d91ef4c8009212750daa0a))
* **process:** retain ownership after incomplete cleanup ([e2fc249](https://github.com/morluto/rea/commit/e2fc2493b6a59f0663495d277c0cfec1aeb25a7a))
* **process:** stabilize native capture and ownership prerequisites ([2b27515](https://github.com/morluto/rea/commit/2b2751547662f8cb142f96d91eff50388a1ecb31))
* **process:** stop failing captures on tokens macOS cannot expose ([#1057](https://github.com/morluto/rea/issues/1057)) ([5547c1e](https://github.com/morluto/rea/commit/5547c1e697af8c2e1c771abe5344d10b7c1cd340))
* **providers:** validate ELF versions and preserve probe cancellation ([8b01e0c](https://github.com/morluto/rea/commit/8b01e0cc8904b512b517b4471ef2150f40c98f0d))
* **release:** always bump minor for releases ([be783ef](https://github.com/morluto/rea/commit/be783efaba62dc76c5d8d42229869a32afdb302a))
* **release:** publish prereleases under the next npm tag ([bfb7776](https://github.com/morluto/rea/commit/bfb7776006303c6164dba2f22b8e81fdb7c20beb))
* **release:** publish reviewed release PR merges ([cdddfdd](https://github.com/morluto/rea/commit/cdddfddf495ffd172f62a6a801f7697fe502847e))
* **release:** recognize conventional titles in GitHub merge commits ([f5009ed](https://github.com/morluto/rea/commit/f5009ed55f081939409808870458162991f836ca))
* **release:** restore automatic release proposals on main ([acb3e0f](https://github.com/morluto/rea/commit/acb3e0f2e5b38a9c97df7ed78c8e6e5f38bfa08f))
* **release:** validate frozen checkpoint versions and breaking notes ([8a31508](https://github.com/morluto/rea/commit/8a31508c8958800364e255540ded1586298d7008))
* **release:** validate frozen checkpoint versions and breaking notes ([60825fb](https://github.com/morluto/rea/commit/60825fb44751c9482bdf4cafdac3599da7c82d45)), closes [#1063](https://github.com/morluto/rea/issues/1063)
* select Node legacy package entry fields for import and require ([#1035](https://github.com/morluto/rea/issues/1035)) ([1706005](https://github.com/morluto/rea/commit/170600541bf44f2a63731e8b3d42aae3cbb8d6b3))
* **session:** serialize snapshot lifecycle with admitted requests ([e44cb45](https://github.com/morluto/rea/commit/e44cb45908af8d3902e0db044e0cf7b86cdd7ed0))
* **setup:** launch Windows npx registrations through cmd.exe ([#1072](https://github.com/morluto/rea/issues/1072)) ([ef30343](https://github.com/morluto/rea/commit/ef30343154d64d78b620d41c37457eee5d99fc71))
* **setup:** treat empty client config files as new documents ([#1117](https://github.com/morluto/rea/issues/1117)) ([9fd65ce](https://github.com/morluto/rea/commit/9fd65ce0711ce9257aee15e62a5ecf9832960035))
* **snapshot:** retain MCP workflow replay bindings ([5e1afe4](https://github.com/morluto/rea/commit/5e1afe454f2f283eeeea4532d07a9bdbea8bd51e))
* **target:** preserve app bundle filesystem failure reasons ([d4c2c3c](https://github.com/morluto/rea/commit/d4c2c3c18f691d04526fe38867347faa2530861d))
* **update:** accept npm 12 release metadata ([#1138](https://github.com/morluto/rea/issues/1138)) ([567a82f](https://github.com/morluto/rea/commit/567a82f8d4feb629a7c10d2cc9180377eb1f6f66))
* **verify:** close both sides of the browser proxy ([f7366a5](https://github.com/morluto/rea/commit/f7366a517ff0545f01df6202b1ed3231d9dd3b4a))
* **verify:** isolate package archives and published canary caches ([3eb7dbd](https://github.com/morluto/rea/commit/3eb7dbdc1689737b44cc4ff044bcb1a311511969))
* **verify:** remove stale mocked bridge package probe ([826583d](https://github.com/morluto/rea/commit/826583dd43fc918c70a87dfe148c2fdbc8612f3b))
* **verify:** report final success only after resource cleanup ([ee043e2](https://github.com/morluto/rea/commit/ee043e2cbf30152c60b403fff050a0fc848a3286))
* **workflows:** keep caller-input details in workflow input errors ([#1089](https://github.com/morluto/rea/issues/1089)) ([289aef6](https://github.com/morluto/rea/commit/289aef6838e424c14f331a9905020079e6b7539b))
* **workflows:** retain residual unknowns through CLI and MCP ([0136ee8](https://github.com/morluto/rea/commit/0136ee8c22300ed351af5eab6329ab4d271b5bb6))


### Performance Improvements

* **mcp:** advertise each tool JSON Schema once per target ([#1059](https://github.com/morluto/rea/issues/1059)) ([5ccb924](https://github.com/morluto/rea/commit/5ccb9241be15bb6a19b99fbbfb27ff3356ba157b))
* **build:** avoid duplicate documentation generation ([c701376](https://github.com/morluto/rea/commit/c701376777212ec9acfd10c97f45b1eaf0c885c6))
* **javascript:** index configuration and module lookups ([67252b2](https://github.com/morluto/rea/commit/67252b23b9e35e9526fed7842dab47a2c7c9fe5f))
* **javascript:** reuse validated immutable graphs ([#1112](https://github.com/morluto/rea/issues/1112)) ([ec6db0f](https://github.com/morluto/rea/commit/ec6db0f0630c4b0b35f0db84c0030784c1aa58a6))


### Code Refactoring

* **artifacts:** centralize stable inventory identities ([135d102](https://github.com/morluto/rea/commit/135d102f9df844d70d352870afce80f67c0ae96f))
* **browser:** charge source-map records before retention ([e762e32](https://github.com/morluto/rea/commit/e762e32afbba3fd32532fd42a3f4fdcd05252ad3))
* **config:** prune unused format wrappers and launcher export ([81ae838](https://github.com/morluto/rea/commit/81ae8385679ef10b95d34d0f0b5ba11732ac86b5))
* **input:** share schema issue error construction ([65a6288](https://github.com/morluto/rea/commit/65a6288257e4c3cab9adb53b0f9123ef567b61bd))
* **setup:** validate formats through canonical configuration ([4b10665](https://github.com/morluto/rea/commit/4b1066501b379107b2375e270f386fc9855a85c1))


### Documentation

* add Persian README translation with full language navigation ([7a7460f](https://github.com/morluto/rea/commit/7a7460f04f3cfd7e365d70ff891bdd0c474901b6))
* add ten README translations and expand language navigation ([a61491a](https://github.com/morluto/rea/commit/a61491ad00b21e912e16f68bff829927aed6e16f))
* align translated READMEs and website links with English ([d83f098](https://github.com/morluto/rea/commit/d83f0983d5aa18d29d95d24c4ccb3928be6f29f5))
* celebrate 20,000 GitHub stars 🎉 ([#1079](https://github.com/morluto/rea/issues/1079)) ([9455e7c](https://github.com/morluto/rea/commit/9455e7c8bc9d5c4a9a1fc9077aa15007ad80997e))
* check surrounding cases when changing boundaries ([46d195e](https://github.com/morluto/rea/commit/46d195e8a48b710fc355e84cb6b79461b9c39005))
* clarify contribution scope and cosmetic suggestions ([1f79002](https://github.com/morluto/rea/commit/1f7900249783956070af49c10f86002a0dfdc42b))
* clarify evidence ownership and verification guidance ([a9e00b8](https://github.com/morluto/rea/commit/a9e00b83f37651a8dd241375615b248062e04227))
* move Portuguese toward the end of language navigation ([2a4979b](https://github.com/morluto/rea/commit/2a4979b7cdc1a517865573d6c36654c022347d0a))
* move star milestone into history sections across readmes ([6e6ff7b](https://github.com/morluto/rea/commit/6e6ff7bd2eabb668602258ad5e31eb758b31f823))
* require partial native facts at provider boundaries ([2b86ea9](https://github.com/morluto/rea/commit/2b86ea9c7cd3cfc2141a021f8b531dbc84395c81))
* require surrounding boundary checks for review fixes ([9833c94](https://github.com/morluto/rea/commit/9833c94656e1d54e7711dc483bf8091ced14234f))
* **testing:** prioritize real workflows and distinct regressions ([9588482](https://github.com/morluto/rea/commit/9588482bfeeea869d7274d27fb96bac70278dd42))
* **website:** add a CTF showcase and FAQ ([#1077](https://github.com/morluto/rea/issues/1077)) ([a4d77f0](https://github.com/morluto/rea/commit/a4d77f0ff0242b7ab891030d2ffa09a4b4bc1c3c))


### Tests

* **acceptance:** add application workflow MCP parity harness and scenarios ([5ac3dc9](https://github.com/morluto/rea/commit/5ac3dc96f064e691b357aeddc11fa76b7b4d66d1))
* **artifacts:** retire simulated mounts after detach failures ([f591e37](https://github.com/morluto/rea/commit/f591e37a1e45d9b7179ed788c4e7ee77a708c6b0))
* **artifacts:** verify native directory identity on supported Windows runtimes ([#1069](https://github.com/morluto/rea/issues/1069)) ([e94be95](https://github.com/morluto/rea/commit/e94be95c66515fa6fba2a46e4b29850d34141fef))
* **browser:** pin DOM and source-map URL policy classifications ([#1120](https://github.com/morluto/rea/issues/1120)) ([c1d0002](https://github.com/morluto/rea/commit/c1d0002470dc2b6bde73e4ffe438e734dbb24d8d))
* **browser:** reject unmodeled CDP commands in protocol fixtures ([017297c](https://github.com/morluto/rea/commit/017297c40c0c38b9d9c17f5194f0f4c51748f0c3))
* classify application scenarios by their actual boundaries ([0e0b386](https://github.com/morluto/rea/commit/0e0b386dc35bdee1174df9a2d718e0f3e5793666))
* **cli:** verify self-import parity and cleanup ([55c9ce2](https://github.com/morluto/rea/commit/55c9ce26d1b52f359a21512103088048f9aa7492))
* consolidate failure guards and trim unused fixture APIs ([ffd9611](https://github.com/morluto/rea/commit/ffd9611308c91b894a7b0d27f331238f5117dacf))
* **hopper:** cover real boundary failures and CLI parity ([64717ad](https://github.com/morluto/rea/commit/64717ad7daa3152eeb718b4eb5fdcc77f1d76542))
* **hopper:** verify real boundaries and prune redundant happy paths ([7005166](https://github.com/morluto/rea/commit/7005166f5878737fb7b3c7ec4e3d2ee5f4dcce30))
* **mcp:** serialize real process capture and report unavailable authority ([8f9da25](https://github.com/morluto/rea/commit/8f9da251647beb530f6851c9dad5040b19a50a35))
* **process:** cover argv rewrites in native ownership inspection ([09d7b9b](https://github.com/morluto/rea/commit/09d7b9bab53ae968502fd6e19df694cca8cab817))
* **process:** distinguish native startup from producer verification ([9a70fb4](https://github.com/morluto/rea/commit/9a70fb482c974658088167c9d279bd70159e5dc8))
* **process:** expose unavailable capture and unexpected teardown failures ([90b06db](https://github.com/morluto/rea/commit/90b06db6c0b2c5863f292f63a226a5c5678a86ac))
* **process:** report the cause of terminal capture failures ([8a4c4b6](https://github.com/morluto/rea/commit/8a4c4b657fe3b0c249dd2e2147f6960361684c59))
* **process:** retain cancellation checks under unverified host cleanup ([9a5b077](https://github.com/morluto/rea/commit/9a5b0778993102460e333de6cad3ba85383c10be))
* **process:** retire native caches at worker teardown ([a0784c0](https://github.com/morluto/rea/commit/a0784c0d2cb70c48ecfeb0be23c6d68de5ee5be1))
* **process:** serialize real CLI capture boundaries ([82560eb](https://github.com/morluto/rea/commit/82560ebf593a7dfc704698ee312e4d8f1629be8f))
* prune redundant cases and promote configuration lifecycle coverage ([5945915](https://github.com/morluto/rea/commit/5945915f91adf85de91e16b69534bc3ed1d1b69a))
* prune resource-recovery wording assertions ([ae06dcf](https://github.com/morluto/rea/commit/ae06dcf83f65b06abb390d2e0b0ea33543278d6e))
* remove duplicate result assertions before throwing guards ([a1b7d40](https://github.com/morluto/rea/commit/a1b7d40bb0212cdfdddd770a1bccbed097601e0a))
* **session:** preserve live binding after cancelled switches ([1136ea8](https://github.com/morluto/rea/commit/1136ea881029eab59ffb0834149e86a6aff69e3b))
* **setup:** scope removal regression to its fixture client ([fe48e77](https://github.com/morluto/rea/commit/fe48e779c264745d28b5a819e51c06e6b5bd2776))
* **workflows:** verify residual questions in CLI snapshots ([770d2f6](https://github.com/morluto/rea/commit/770d2f60aa948cfdb61c71304be2f3e35f673840))


### Continuous Integration

* run signature target binding regressions on native macOS ([#1107](https://github.com/morluto/rea/issues/1107)) ([1e63144](https://github.com/morluto/rea/commit/1e63144390070f569998271fafd1459788ef3265))

## [6.0.0](https://github.com/morluto/rea/compare/rea-agents-5.0.0...rea-agents-6.0.0) (2026-10-08)


### ⚠ BREAKING CHANGES

* **contracts:** MCP filesystem inputs now require absolute host paths, including target/snapshot paths, evidence bundle paths, managed and firmware inputs, browser/Electron launch paths and expected server paths. Calls such as `open_binary({"path":"./app"})` must send an absolute path such as `/home/analyst/app` or `C:\analysis\app`. Optional paths remain optional. CLI operator-relative paths continue to work. See [#948](https://github.com/morluto/rea/pull/948) and [#1004](https://github.com/morluto/rea/pull/1004).

### Features

* **artifacts:** trace Mach-O dylib resolution in bundles ([78d594c](https://github.com/morluto/rea/commit/78d594cacd376725f833a99402069c103aae9aac))
* **browser:** inspect historical web network captures ([#992](https://github.com/morluto/rea/issues/992)) ([2bf3663](https://github.com/morluto/rea/commit/2bf3663f654386c9fd8c1437c49659df97bd4697))
* **evm:** inspect offline bytecode interfaces through EVMole ([#1051](https://github.com/morluto/rea/issues/1051)) ([7af7bc8](https://github.com/morluto/rea/commit/7af7bc88ce0e8f084eaa0db1e8f834d495440fd9))
* **ghidra:** support native x86 PE applications on Windows ([#1030](https://github.com/morluto/rea/issues/1030)) ([c6dad93](https://github.com/morluto/rea/commit/c6dad932084032bcb32acc61e8066a7784497710))
* **native:** inspect offline ELF layout through pwntools ([#1037](https://github.com/morluto/rea/issues/1037)) ([4fc6565](https://github.com/morluto/rea/commit/4fc6565b0ffb36d7105b3524e08d0c5d603ae07d))
* **native:** inspect recorded crashes through pwntools and pwndbg ([#1054](https://github.com/morluto/rea/issues/1054)) ([163ee09](https://github.com/morluto/rea/commit/163ee09a7425479385e0ed0b5d74043e2587eab2))
* **native:** observe function and Objective-C method calls under LLDB ([1d13cef](https://github.com/morluto/rea/commit/1d13cef5f46f5e07f594bde7b1a4725f189b9a5e))


### Bug Fixes

* **dotnet:** validate managed metadata and CIL boundaries ([#938](https://github.com/morluto/rea/pull/938)) ([bda4ada](https://github.com/morluto/rea/commit/bda4ada7fb6bd7dd70a444bb3c57e34f7f5cc00b))

* **build:** clarify generated-file check hint and drop redundant catalog step ([#998](https://github.com/morluto/rea/pull/998)) ([6f0ef16](https://github.com/morluto/rea/commit/6f0ef160501ea3b24dfa2939dfcd3eea0dc13ee7))

* **release:** extend npm propagation window and improve diagnostics ([#943](https://github.com/morluto/rea/pull/943)) ([06b047a](https://github.com/morluto/rea/commit/06b047a0929369d5b8635b3651da115c8fcd53a7))

* **contracts:** require absolute local paths for session filesystem inputs ([#948](https://github.com/morluto/rea/pull/948)) ([5b172b1](https://github.com/morluto/rea/commit/5b172b1042fc09a4e12d956018f15d86cf397ffe))

* **ci:** generate source catalog before shard tests ([#1002](https://github.com/morluto/rea/pull/1002)) ([eb8f649](https://github.com/morluto/rea/commit/eb8f6491a88bfa79d13f7923e4ef94d791f6ba4d))

* **contracts:** require absolute local paths for remaining caller-supplied file inputs ([#1004](https://github.com/morluto/rea/pull/1004)) ([cbc0dd1](https://github.com/morluto/rea/commit/cbc0dd1e7ca36fa3504a9ea8eae303a0876b176b))

* **cli:** classify ENOTDIR JSON input failures ([#1000](https://github.com/morluto/rea/pull/1000)) ([a6132be](https://github.com/morluto/rea/commit/a6132be0546d6a9e3fa83426c8b59b1280b3e5bd))

* **browser:** preserve authorized redirect hops ([#986](https://github.com/morluto/rea/pull/986)) ([ae0f725](https://github.com/morluto/rea/commit/ae0f725fad368730c6198d49716ccc410bca0536))

* **mcp:** reject unknown MCP tool inputs ([#975](https://github.com/morluto/rea/pull/975)) ([fe64fd6](https://github.com/morluto/rea/commit/fe64fd65d93eff202ad90145544dc9ff84651974))

* **release:** publish from explicit source checkpoints ([#1003](https://github.com/morluto/rea/pull/1003)) ([64c7188](https://github.com/morluto/rea/commit/64c71880ae4f7bc658ffce46eb729c4141dbdf19))

* **release:** publish from explicit source checkpoints ([#1006](https://github.com/morluto/rea/pull/1006)) ([b4fc0ec](https://github.com/morluto/rea/commit/b4fc0ecaa1f6b912dc27880e6b6127ace47abc2e))

* **javascript:** bound semantic node projection for resource safety ([#966](https://github.com/morluto/rea/pull/966)) ([96a46ad](https://github.com/morluto/rea/commit/96a46ada0a36f0349f2b0fc20b4c932401b4ad84))

* **ci:** avoid slow Azure archive for the native cross compiler ([#1016](https://github.com/morluto/rea/issues/1016)) ([51956c1](https://github.com/morluto/rea/commit/51956c1a49a7dc9ed70a6fba480a670a7e7b2b9b))
* **ci:** decouple stdio smoke tests from Linux display probes ([#1014](https://github.com/morluto/rea/issues/1014)) ([93731e1](https://github.com/morluto/rea/commit/93731e17ddea76db86dfa84bb54536dcf8ebfa0b))
* **cli:** stream large JavaScript JSON results ([#1024](https://github.com/morluto/rea/issues/1024)) ([0e25bef](https://github.com/morluto/rea/commit/0e25befe78f220691abe5d0291cc04a75c9cc877))
* **javascript:** complete large-ASAR analysis with file-local projection ([#1055](https://github.com/morluto/rea/issues/1055)) ([b9fb438](https://github.com/morluto/rea/commit/b9fb43883570bef7cb29fd16f27c25d5a7e5bb54))
* **javascript:** recognize digits in artifact URI schemes ([#1045](https://github.com/morluto/rea/issues/1045)) ([03424ae](https://github.com/morluto/rea/commit/03424ae91ef22efd57db1bdde9379a3ac450b8f7))
* **javascript:** reconstruct HTML script loads accurately ([#1042](https://github.com/morluto/rea/issues/1042)) ([1154f2f](https://github.com/morluto/rea/commit/1154f2f03c0b0bb6cb6c5da09b8d8e1c837febc4))
* **javascript:** report application analysis progress on the CLI ([#1008](https://github.com/morluto/rea/issues/1008)) ([7b18c58](https://github.com/morluto/rea/commit/7b18c581409848077de7a9cb6d7d1a0b91a02e12))
* **javascript:** resolve module URLs and reject invalid exports targets ([#1031](https://github.com/morluto/rea/issues/1031)) ([8d5c88f](https://github.com/morluto/rea/commit/8d5c88f17cde4ab4fa54c5142f0a45e612619a53))
* **javascript:** resolve root package exports arrays ([#1046](https://github.com/morluto/rea/issues/1046)) ([53409ab](https://github.com/morluto/rea/commit/53409ab1968d60c77f98feedefe237a08859a95c))
* **mcp:** advertise JSON values without recursive schemas ([#995](https://github.com/morluto/rea/issues/995)) ([7425f70](https://github.com/morluto/rea/commit/7425f70fd0247a7ea7192deb959fd6f48ba83a21)), closes [#919](https://github.com/morluto/rea/issues/919)
* **mcp:** bound capture comparison input schema depth ([#1005](https://github.com/morluto/rea/issues/1005)) ([6b55de0](https://github.com/morluto/rea/commit/6b55de017badc9066642e1ff2561eb1da0ff93f8))
* **process:** preserve partial evidence and verify detached cleanup ([#1011](https://github.com/morluto/rea/issues/1011)) ([63cf28f](https://github.com/morluto/rea/commit/63cf28fd8f8acaf656e993300a2a24280b2fd692))
* **release:** support built-in credentials and refresh release boundary ([6a278a6](https://github.com/morluto/rea/commit/6a278a68dd4fa69b9153697ecb7bba7de4c55c32))
* **release:** support default credentials and record 5.0.0 boundary ([#1012](https://github.com/morluto/rea/issues/1012)) ([6a278a6](https://github.com/morluto/rea/commit/6a278a68dd4fa69b9153697ecb7bba7de4c55c32))
* **release:** sync 5.0.0 checkpoint back to main ([966cca8](https://github.com/morluto/rea/commit/966cca8efe5ed08b3285cd06409688d871eb5e6b))
* **snapshot:** replay validated workflow evidence ([#984](https://github.com/morluto/rea/issues/984)) ([1d62e54](https://github.com/morluto/rea/commit/1d62e54e1f976e64130e4e9b651c3180aa4fa727))
* **windows:** allow Java to read retained target snapshots ([#1027](https://github.com/morluto/rea/issues/1027)) ([28d5c39](https://github.com/morluto/rea/commit/28d5c397c83f901e4086083868041711371ad32a))


### Performance Improvements

* **artifacts:** replace quadratic ZIP overlap checks ([#1013](https://github.com/morluto/rea/issues/1013)) ([76e7e51](https://github.com/morluto/rea/commit/76e7e510bb2d7d37728ca50749d524beb5890cf8))
* **javascript:** cache canonical export comparison sort keys ([#1028](https://github.com/morluto/rea/issues/1028)) ([63ba742](https://github.com/morluto/rea/commit/63ba7424c0ab69b94397e8913f8e231de111583f))


### Code Refactoring

* **build:** generate MCP tool catalog at build time instead of committing it ([#997](https://github.com/morluto/rea/pull/997)) ([35a4e18](https://github.com/morluto/rea/commit/35a4e18d3028014e24d2e209ec99a590fde63152))

* **process:** separate capture implementation from analyst workflows ([#988](https://github.com/morluto/rea/pull/988)) ([6aa9afb](https://github.com/morluto/rea/commit/6aa9afb5493a97801eb1126a0dcf11f9705165db))

* **artifacts:** move inventory and extraction into provider owners ([#1032](https://github.com/morluto/rea/issues/1032)) ([6e4535c](https://github.com/morluto/rea/commit/6e4535c1011f1982e9ab07b7ebcd600c19cd494d))
* remove abandoned test-only analysis scaffolding ([c93422a](https://github.com/morluto/rea/commit/c93422a898fdbedb7d28709144b4337a2669440b))


### Documentation

* improve Korean wording and particles ([#1047](https://github.com/morluto/rea/issues/1047)) ([c5d165b](https://github.com/morluto/rea/commit/c5d165bd03fed95a0b0105661d3ba7e0efbfa449))
* simplify the English README and organize guides ([#1043](https://github.com/morluto/rea/issues/1043)) ([28f10cf](https://github.com/morluto/rea/commit/28f10cf2bc7b7c590700b50d47072015f3e3c66e))


### Tests

* **process:** wait for observable snapshot ctime changes ([#999](https://github.com/morluto/rea/pull/999)) ([161ed91](https://github.com/morluto/rea/commit/161ed9157134d5c3b0fbae19ceb756ac58a26c04))

* **browser:** consolidate CDP workflows and colocate parser coverage ([2682904](https://github.com/morluto/rea/commit/26829045d0f0e744bb60d6babc2dc3312f4bfa53))
* **ci:** stabilize browser source identity fixture delivery ([#1023](https://github.com/morluto/rea/issues/1023)) ([ed725da](https://github.com/morluto/rea/commit/ed725dace4a689e4e5c804dc6bf06c7fc663c7c9))
* **cli:** reduce repeated startup and filesystem setup ([d88d6c1](https://github.com/morluto/rea/commit/d88d6c1897740ccbd6c57f4ba01861fc751fb3a8))
* consolidate service and process fixtures ([f8a53a8](https://github.com/morluto/rea/commit/f8a53a8c065f1ccbdaa051a4e1ef267a2047d759))
* **javascript:** consolidate source analysis and export regressions ([f517a5a](https://github.com/morluto/rea/commit/f517a5a1d7c0766ed50f8dfd5ee69e65525ac744))
* **javascript:** cover plain long-line loader identities ([#1025](https://github.com/morluto/rea/issues/1025)) ([984fc27](https://github.com/morluto/rea/commit/984fc27ce19d57f708bdae688a258cf8663cdea6))
* **mcp:** consolidate SDK schema checks and scenario ports ([9c3479e](https://github.com/morluto/rea/commit/9c3479ed95100d8ee5ed4d9158a4550e4ac2a752))
* **providers:** verify framing through client socket boundaries ([1fd1989](https://github.com/morluto/rea/commit/1fd1989d342375a01b6d14b282ad58001b7d1800))
* prune redundant conformance checks and document test priorities ([aafdf8a](https://github.com/morluto/rea/commit/aafdf8a01b42fb6fd927c0f2a66e758e1a510abc))

## [5.0.0](https://github.com/morluto/rea/compare/rea-agents-4.1.0...rea-agents-5.0.0) (2026-10-07)


### ⚠ BREAKING CHANGES

* **native:** preserve incomplete native UI captures ([#991](https://github.com/morluto/rea/issues/991))
* **android:** Android analysis now requires a full JDK 17 or newer with its compiler module for the packaged Java source bridge.

### Features

* **apple:** project macOS bundle anatomy in application graphs ([88c940b](https://github.com/morluto/rea/commit/88c940b165d788a491e212ea93e00462c4dde6a2))
* **apple:** project macOS bundle anatomy in application graphs ([dd3e7ae](https://github.com/morluto/rea/commit/dd3e7aef0d52c478f6cdf475501c42ebe7f5c97e))
* **application:** wire Android and Apple inventory graph tools ([#852](https://github.com/morluto/rea/issues/852)) ([e0fd820](https://github.com/morluto/rea/commit/e0fd8207a1fb738bcc34f204b55c4fa154f5f02d))
* **browser:** attribute native execution and listener sources ([#917](https://github.com/morluto/rea/issues/917)) ([b5afa5f](https://github.com/morluto/rea/commit/b5afa5f91eed9ae31d670aeab9bbf5112d790ec2))
* **browser:** capture correlated network content and lifecycle evidence ([#797](https://github.com/morluto/rea/issues/797)) ([f9eaf05](https://github.com/morluto/rea/commit/f9eaf056ef58215094513176a70fabae0740081f))
* **browser:** trace captured website module imports ([#879](https://github.com/morluto/rea/issues/879)) ([01be082](https://github.com/morluto/rea/commit/01be082e9e11c78b91828c06a9c543c754783c07))
* **browser:** trace captured website source-map locations ([#897](https://github.com/morluto/rea/issues/897)) ([f430c41](https://github.com/morluto/rea/commit/f430c416c72d444fbe521e0263f8935da4cdb040))
* **javascript:** recover readable modules with Wakaru ([#848](https://github.com/morluto/rea/issues/848)) ([166dcd2](https://github.com/morluto/rea/commit/166dcd21d06f687a9c480a6a6d36beb3b4954dd0))
* **native:** decode chained fixups, binds, ObjC categories and properties ([a657557](https://github.com/morluto/rea/commit/a65755728f7a10d984514c75fa863b84ddcdaee9))
* **native:** decode chained fixups, binds, ObjC categories and properties ([3e24a72](https://github.com/morluto/rea/commit/3e24a72465fe6c628db1f836e93d74d7f4a92b80))
* **native:** open iOS-style and iOS-on-Mac wrapper app bundles ([2ed89e6](https://github.com/morluto/rea/commit/2ed89e6529924248d2e21084f8730bedbb16bc3f))
* **native:** open iOS-style and iOS-on-Mac wrapper app bundles ([aeebba3](https://github.com/morluto/rea/commit/aeebba391ee5c288b75cd828e7d18d32b40aa698))
* **web:** export captured scripts for JavaScript application analysis ([#801](https://github.com/morluto/rea/issues/801)) ([472b72a](https://github.com/morluto/rea/commit/472b72a53068a8e2ec78fe239d687023482daaa7))
* **website:** add a shared back-to-top link ([5047373](https://github.com/morluto/rea/commit/504737300632d8644fbd6c658d2c97e38bb54c3b))
* **website:** introduce REA and the DX-Ball reconstruction ([#906](https://github.com/morluto/rea/issues/906)) ([4e3953c](https://github.com/morluto/rea/commit/4e3953cc45ce9c21786a7a6fc495d2350aa85d24))


### Bug Fixes

* address review nits from batch integration follow-ups ([#818](https://github.com/morluto/rea/issues/818)) ([5a0e0ba](https://github.com/morluto/rea/commit/5a0e0ba3b81ea0ec336addb07da98ec7bc0a35d3))
* **android:** align runtime suffix inference ([#977](https://github.com/morluto/rea/issues/977)) ([fb3749a](https://github.com/morluto/rea/commit/fb3749aff692a7a8225dff00a4516b48a76866b6))
* **android:** bound fragmented JADX MCP frame memory ([#937](https://github.com/morluto/rea/issues/937)) ([9e39795](https://github.com/morluto/rea/commit/9e397958951edb543134e3ad57e7ab253d6df21a))
* **android:** preserve JVM settings and reuse metadata sessions ([#908](https://github.com/morluto/rea/issues/908)) ([eab34a9](https://github.com/morluto/rea/commit/eab34a9d8c5eebad6b04b85750be0276d679c3f9))
* **apple:** attribute only application-root components in macOS inventories ([5524970](https://github.com/morluto/rea/commit/55249704c5c83cbf8d20ac7869863cc196da00a6))
* **apple:** count only real framework version directories ([2e81e86](https://github.com/morluto/rea/commit/2e81e867b24da8314f666f62d154de5803040cdf))
* **apple:** pair bridge hypotheses within one application root ([7acf4e7](https://github.com/morluto/rea/commit/7acf4e741a6a314ea7aabb18fc757e196158ff76))
* **apple:** pair bridge hypotheses within one application root ([9226ade](https://github.com/morluto/rea/commit/9226ade5114f287eb8e1b00b08dd91da1cc66003))
* **apple:** traverse keyed archive hierarchy collections ([#976](https://github.com/morluto/rea/issues/976)) ([71ac83f](https://github.com/morluto/rea/commit/71ac83f3dd376135098f460c86e7897183456ec5))
* **artifacts:** accept APFS image disks ejected with their container ([d93ebec](https://github.com/morluto/rea/commit/d93ebec9df951d40e66ced667f07fadd2dd5d25a))
* **artifacts:** accept APFS image disks ejected with their container ([b72c079](https://github.com/morluto/rea/commit/b72c079a9a90c374bd6dd30ff8c4387306b8f59b))
* **artifacts:** accept the bundle subject when extracting an app bundle ([#891](https://github.com/morluto/rea/issues/891)) ([37d2eba](https://github.com/morluto/rea/commit/37d2ebac4c2a524eec6e32c4c57cbbb632491ad8))
* **artifacts:** decode flat keyed-archive NIBs with data and shared references ([b3f013f](https://github.com/morluto/rea/commit/b3f013fa183e8351319a053575aeee5df337c276))
* **artifacts:** decode flat keyed-archive NIBs with data and shared references ([2a4667b](https://github.com/morluto/rea/commit/2a4667bb79117b202abb009c0bb9ebfdfde57158))
* **artifacts:** harden reader lifecycle boundaries ([#951](https://github.com/morluto/rea/issues/951)) ([2366bda](https://github.com/morluto/rea/commit/2366bda37b1084016d42a0d06920dc57e7c7723f))
* **artifacts:** keep the post-snapshot detach check out of provenance ([62634e4](https://github.com/morluto/rea/commit/62634e4c0177bde8a08decc356da98fbe25d2000))
* **artifacts:** preserve reader failure diagnostics ([#987](https://github.com/morluto/rea/issues/987)) ([fc4a9a0](https://github.com/morluto/rea/commit/fc4a9a05922ce8474fd0717bc800343b0a95bd41))
* **artifacts:** project compiled AppKit actions from the control to its target ([b08228d](https://github.com/morluto/rea/commit/b08228d19f8a0f6dbc940e8d322ef2bb42d2ce1a))
* **artifacts:** project compiled AppKit actions from the control to its target ([#905](https://github.com/morluto/rea/issues/905)) ([900d7c8](https://github.com/morluto/rea/commit/900d7c8606cbc1ccbca818827a55bf2eab28bca4))
* **artifacts:** project UIKit runtime outlet and event connections ([aa8082e](https://github.com/morluto/rea/commit/aa8082ea6c0898feb4d842135aea6b9539f769f8))
* **artifacts:** project UIKit runtime outlet and event connections ([8b24387](https://github.com/morluto/rea/commit/8b243877c22a5550d005e7b8abf93791ce8566b9))
* **artifacts:** read AppKit connectors from flat keyed-archive NIBs ([#900](https://github.com/morluto/rea/issues/900)) ([27c272b](https://github.com/morluto/rea/commit/27c272bd9a42e7235c7991881196c60dbc126714))
* **artifacts:** read keyed archive dictionaries keyed UID as dictionaries ([cfd2b0c](https://github.com/morluto/rea/commit/cfd2b0c75dfb9d51b936788a46d0338145803ece))
* **artifacts:** read keyed archive dictionaries keyed UID as dictionaries ([35c82b9](https://github.com/morluto/rea/commit/35c82b93eb2579687bb446c3a8a2a9f1a7563d28))
* **artifacts:** report which path constraint failed ([#847](https://github.com/morluto/rea/issues/847)) ([3f1a77f](https://github.com/morluto/rea/commit/3f1a77f68ec4355d8b792ccb2970bc03485889c9))
* **browser:** distinguish computed call keys from identifiers ([#808](https://github.com/morluto/rea/issues/808)) ([02beb74](https://github.com/morluto/rea/commit/02beb745358f02bdaabed4bb523c5e3527a9841e))
* **browser:** distinguish WebMCP registration frame owners ([#813](https://github.com/morluto/rea/issues/813)) ([b3b44d8](https://github.com/morluto/rea/commit/b3b44d8a2d8b2aa70a8ed8b9cddf365865fcc53f))
* **browser:** fingerprint cookies at the selected page URL ([#763](https://github.com/morluto/rea/issues/763)) ([78014e3](https://github.com/morluto/rea/commit/78014e3d149f762c848581a0aac7e44f75d51225))
* **browser:** identify NodeNext TypeScript original source artifacts ([#811](https://github.com/morluto/rea/issues/811)) ([e84ad86](https://github.com/morluto/rea/commit/e84ad86a7578fb46568663aca6fe6a6f3986cc8d))
* **browser:** preserve evidence through deep AST analysis ([#924](https://github.com/morluto/rea/issues/924)) ([f826aa8](https://github.com/morluto/rea/commit/f826aa893fa7d55e87d907f0c94c39421a166dd8))
* **browser:** preserve form destinations and satisfies mutation uncertainty ([#825](https://github.com/morluto/rea/issues/825)) ([6dd719e](https://github.com/morluto/rea/commit/6dd719eaf605b37cd5dad6d01d33527ca9d59f06)), closes [#820](https://github.com/morluto/rea/issues/820)
* **browser:** preserve Link header value delimiters ([#805](https://github.com/morluto/rea/issues/805)) ([dd36405](https://github.com/morluto/rea/commit/dd3640548fe3d1e8b92784a63fac55d757dcc1f0))
* **build:** validate installed dependencies before cache hits ([#982](https://github.com/morluto/rea/issues/982)) ([a45fe86](https://github.com/morluto/rea/commit/a45fe86a39b9e7a7c21e3665b6de4763cb72d782))
* capture IndexedDB object-store record fingerprints ([#809](https://github.com/morluto/rea/issues/809)) ([21a8bd0](https://github.com/morluto/rea/commit/21a8bd0ccde2326c8bc022714a88a438d8b89dde))
* **cli:** align structured output guard with native flags ([#777](https://github.com/morluto/rea/issues/777)) ([e9fac56](https://github.com/morluto/rea/commit/e9fac56232e74c8287863ca5c4cc7d8e39fb4a40))
* **cli:** emit empty structured filter projections ([#914](https://github.com/morluto/rea/issues/914)) ([2db668f](https://github.com/morluto/rea/commit/2db668f6ca91d2514a354fd459239b84031812e7))
* **cli:** honor the selected native plist path ([#773](https://github.com/morluto/rea/issues/773)) ([0374865](https://github.com/morluto/rea/commit/0374865836aa4960657fb92f588c71e35dd3bed8))
* **cli:** preserve output and comparison input validation ([#981](https://github.com/morluto/rea/issues/981)) ([d5c43d6](https://github.com/morluto/rea/commit/d5c43d65f0f6a1de8fb2eb5f2c1940a6ea2af20c))
* **cli:** preserve unsupported historical-source imports ([#795](https://github.com/morluto/rea/issues/795)) ([911d580](https://github.com/morluto/rea/commit/911d58063477912042da5e9e573a9e8008956622))
* **contracts:** align CLI/MCP boundary contracts ([#946](https://github.com/morluto/rea/issues/946)) ([4a60738](https://github.com/morluto/rea/commit/4a6073810a955d058c10f209157cbd68832a92c5))
* **deps:** remediate smol-toml advisories ([93091ab](https://github.com/morluto/rea/commit/93091abb4dbd3cceee217d179db816895df24d70))
* **deps:** remediate smol-toml advisories ([c55ae3b](https://github.com/morluto/rea/commit/c55ae3b9eccc17e6e8f4369e13044995d0650704))
* **dotnet:** compare members with undecoded signatures by exact identity ([28fd49f](https://github.com/morluto/rea/commit/28fd49f0f6cf54e373411f5999e6b5722dd826f5))
* **dotnet:** compare members with undecoded signatures by exact identity ([d52af3b](https://github.com/morluto/rea/commit/d52af3b321a321964598fb302edeb26552c9dffd))
* **dotnet:** inspect native boundaries of non-managed and malformed PEs ([d5f28fb](https://github.com/morluto/rea/commit/d5f28fb29c5c3e8acef940fcae042e660e3a4d72))
* **dotnet:** inspect native boundaries of non-managed and malformed PEs ([d98dcfa](https://github.com/morluto/rea/commit/d98dcfa8c2e46a7cc918aeb01058c26c4a84060c))
* **dotnet:** keep a decoded member unknown beside an undecoded counterpart ([76b7020](https://github.com/morluto/rea/commit/76b70203d941ab85c1772f330407fd832d438c9c))
* **dotnet:** keep admitted CLI header facts when metadata is unreadable ([e5ba693](https://github.com/morluto/rea/commit/e5ba6934e4ff819c09077ca70bd2417d37f85bc0))
* **dotnet:** name the shared key in exact-signature ambiguities ([7714e76](https://github.com/morluto/rea/commit/7714e763d9ac2e87994068b3dee37ca6c5ffc6f4))
* **dotnet:** treat ambiguous undecoded members as possible counterparts ([73370e1](https://github.com/morluto/rea/commit/73370e1c064899753988581c9a821e0e7f579561))
* **errors:** report union input issues at the union's path ([bddeb63](https://github.com/morluto/rea/commit/bddeb634b583cf4f7d5fa6cf3a1ee821e05d2923))
* **evaluation:** canonicalize Unicode argument keys ([#980](https://github.com/morluto/rea/issues/980)) ([0a4caf4](https://github.com/morluto/rea/commit/0a4caf4a0a1355b6a121fc88886b22e55843ac76))
* **firmware:** accept the verified Binwalk and Unblob release lines ([#844](https://github.com/morluto/rea/issues/844)) ([bef4321](https://github.com/morluto/rea/commit/bef4321afb3d0d480e8a04ad7e256663542caa3d))
* **firmware:** retain multi-file extraction failures ([#978](https://github.com/morluto/rea/issues/978)) ([8aaf9a1](https://github.com/morluto/rea/commit/8aaf9a19788beb6612332505850ad3407cb00027))
* **ghidra:** admit the 12.1 line and the install's JDK range ([#840](https://github.com/morluto/rea/issues/840)) ([5cbf06c](https://github.com/morluto/rea/commit/5cbf06c7ad0ace599721bffd7da566b8a790b622))
* **ghidra:** select exact packaged bridge scripts ([#800](https://github.com/morluto/rea/issues/800)) ([894c30e](https://github.com/morluto/rea/commit/894c30ef02d946f0c8de3ae6c9168d9525d95033))
* **ida:** share concurrent session cleanup ([#950](https://github.com/morluto/rea/issues/950)) ([f14b6a8](https://github.com/morluto/rea/commit/f14b6a84306116716e78c5ffc84353ac07939593))
* **installer:** validate exact semantic versions ([#954](https://github.com/morluto/rea/issues/954)) ([248972f](https://github.com/morluto/rea/commit/248972f327776687037dc07099117584c0674e77))
* integrate 24 reviewed browser/native/semantics corrections ([#815](https://github.com/morluto/rea/issues/815)) ([3af3811](https://github.com/morluto/rea/commit/3af3811ab0a212b6aab6185628d47ecad37958fc))
* **javascript:** advertise the exact empty seed rule and match empty API keys ([35e5508](https://github.com/morluto/rea/commit/35e5508fd095a062d7477bd6bb7d2d8e28201cd8))
* **javascript:** analyze source maps with empty source names ([58ef8ac](https://github.com/morluto/rea/commit/58ef8ac3aa803d7b64dd12a5b2a2e8ec24261060))
* **javascript:** analyze sources containing empty string literals ([e7cbfe0](https://github.com/morluto/rea/commit/e7cbfe04fdfd7affe50dba9e2c7a9a0a72291041))
* **javascript:** analyze sources containing empty string literals ([11fc3b9](https://github.com/morluto/rea/commit/11fc3b981509e8107b10b2e75363f5bb489879db))
* **javascript:** filter keyed-collection receivers only for get/delete ([00f707b](https://github.com/morluto/rea/commit/00f707b250451246d69a1205c39c6843fab6bb5b))
* **javascript:** handle deep AST traversal and addition without stack overflow ([#915](https://github.com/morluto/rea/issues/915)) ([62b3711](https://github.com/morluto/rea/commit/62b37111e7f09887eb712c6e8e721e0334cf10b9))
* **javascript:** handle deep static member paths ([#939](https://github.com/morluto/rea/issues/939)) ([348c65c](https://github.com/morluto/rea/commit/348c65c7ece1aee280f9431d995996b444e7549d))
* **javascript:** keep bare relative URLs for computed-method XHR ([e32028d](https://github.com/morluto/rea/commit/e32028d1b566872ba8cd08fc6800c198d6aef30b))
* **javascript:** keep computed-method XHR request URLs ([602d002](https://github.com/morluto/rea/commit/602d0021d45a6cdab9f806554f3ee12ea670ec97))
* **javascript:** keep exact empty env keys and method names ([522c2d0](https://github.com/morluto/rea/commit/522c2d0ecb1eb7be262eaef2926cceac9a68badc))
* **javascript:** keep exact empty env keys and method names ([f7954a8](https://github.com/morluto/rea/commit/f7954a8fd692f262ef3ce1507b957681150ce9c4)), closes [#783](https://github.com/morluto/rea/issues/783)
* **javascript:** keep exact empty require paths and request fields ([ad1f6b5](https://github.com/morluto/rea/commit/ad1f6b508fbdd44d8bf1884ed96ae69082808e7d)), closes [#783](https://github.com/morluto/rea/issues/783)
* **javascript:** keep exact empty values in graph identities ([f608127](https://github.com/morluto/rea/commit/f608127635ed8e0d105ad95252e5ea0dff899f5b))
* **javascript:** keep exact empty values in graph identities ([63012ee](https://github.com/morluto/rea/commit/63012eeb601fc74ca82f3a027d852a5da1b099d2))
* **javascript:** keep keyed-collection reads out of endpoints ([9075ce7](https://github.com/morluto/rea/commit/9075ce71ada4334407aa2d194dc82e3031e30260))
* **javascript:** keep keyed-collection reads out of endpoints ([eb68761](https://github.com/morluto/rea/commit/eb68761eb0a35b876e33dd6115d0d07f97e99dd5))
* **javascript:** keep literal HTTP methods on storage-named receivers ([9f48a76](https://github.com/morluto/rea/commit/9f48a76e1186cc43c6928eff1c82e93280caee1a))
* **javascript:** keep literal-method and URL-literal requests on aliased receivers ([e3e7664](https://github.com/morluto/rea/commit/e3e76646657e950e24241ba715eb97ea385933e9))
* **javascript:** keep mutated object initializer values unknown ([#752](https://github.com/morluto/rea/issues/752)) ([6caa38a](https://github.com/morluto/rea/commit/6caa38a0cad369ddff52b08f8d7d44c1b92ecac0))
* **javascript:** keep storage open versions out of XHR endpoints ([4f51103](https://github.com/morluto/rea/commit/4f5110306d9edab94bf63bf81cf259324d96af57))
* **javascript:** keep storage open versions out of XHR endpoints ([898b0f6](https://github.com/morluto/rea/commit/898b0f62d76ea1cf793140cb255cad16ab85b44d))
* **javascript:** keep XHR and client endpoints that receiver spellings hid ([05f43ed](https://github.com/morluto/rea/commit/05f43ed388ae4e9316d320b592b6eba5b119ce89))
* **javascript:** leave empty application values unlabeled ([527b76e](https://github.com/morluto/rea/commit/527b76ef78e84d29bb41bd45f1f83fae05ca66ca))
* **javascript:** match exact empty literal channels and seeds ([e20da1f](https://github.com/morluto/rea/commit/e20da1f205b105b1b6a5decd3c2d0fe36fd12410))
* **javascript:** never read window or document open as XHR ([ae849a7](https://github.com/morluto/rea/commit/ae849a72811857ba9755962ec48a1d76c9d1181a))
* **javascript:** preserve computed Electron member uncertainty ([3a4a63f](https://github.com/morluto/rea/commit/3a4a63f70a2e42fb1fa48881e08b08d612289f2e))
* **javascript:** preserve computed Electron member uncertainty ([1260cac](https://github.com/morluto/rea/commit/1260cacc67b8e0c93fb9434452053feca956e7e7))
* **javascript:** project decoded file URL paths ([#810](https://github.com/morluto/rea/issues/810)) ([2572e1e](https://github.com/morluto/rea/commit/2572e1eb2f853a4cebfc8303d9e293e1d106d608))
* **javascript:** read open() endpoints only from XHR method/URL pairs ([63e0822](https://github.com/morluto/rea/commit/63e0822cc794bd6ec1688340b3230ffb6b5c4a8c))
* **javascript:** read open() endpoints only from XHR method/URL pairs ([1be3705](https://github.com/morluto/rea/commit/1be370543f7ea39016f86ebdec80a8ceaf7f8a28))
* **javascript:** read substitution-free templates as exact strings ([c371d6e](https://github.com/morluto/rea/commit/c371d6e1e9cceb28e6cfc874e14c4e740bb87751))
* **javascript:** read substitution-free templates as exact strings ([77cf757](https://github.com/morluto/rea/commit/77cf75710369acc6c304ec352ab25aa7274e04b1))
* **javascript:** resolve bare source-map and worker URLs next to the script ([#890](https://github.com/morluto/rea/issues/890)) ([45fcd28](https://github.com/morluto/rea/commit/45fcd28b4018723bdb508a9229b74ab9eb749f75))
* **javascript:** retain recovered call argument positions ([#929](https://github.com/morluto/rea/issues/929)) ([e6ba9c3](https://github.com/morluto/rea/commit/e6ba9c3af3053485f154825eea6a156127328be9))
* **linux:** improve Hopper reliability and CachyOS support ([#963](https://github.com/morluto/rea/issues/963)) ([98b2b02](https://github.com/morluto/rea/commit/98b2b027afd8c80b68e9daaf97bdaa4d942105cc))
* **mcp:** advertise reserved process environment key ([#949](https://github.com/morluto/rea/issues/949)) ([e0d76ae](https://github.com/morluto/rea/commit/e0d76ae80ddc70ae4d5afcbd1427afb81eee3669))
* **mcp:** isolate optional observation adapter failures ([#838](https://github.com/morluto/rea/issues/838)) ([be3cfbf](https://github.com/morluto/rea/commit/be3cfbffdfbbb65da75dcec0518e2ebf387e66bc))
* **mcp:** preserve exact guided prompt context ([#761](https://github.com/morluto/rea/issues/761)) ([66c26f2](https://github.com/morluto/rea/commit/66c26f280b1d494806ee182b52564166760f0ae2))
* **native-ui:** handle incomplete accessibility child collections ([#944](https://github.com/morluto/rea/issues/944)) ([ac3bae3](https://github.com/morluto/rea/commit/ac3bae3cb97c4fb622eb1b6ac1f3b84e6a70ba03))
* **native:** inspect plists containing data, dates, and non-finite reals ([bc2cd8b](https://github.com/morluto/rea/commit/bc2cd8b874e115eee446860043758a80bd583ad0))
* **native:** inspect plists containing data, dates, and non-finite reals ([5ead2cf](https://github.com/morluto/rea/commit/5ead2cfbc47896b43502363d3568330f5d94762e))
* **native:** keep echoed codesign paths out of signature fields ([#865](https://github.com/morluto/rea/issues/865)) ([4aa2b60](https://github.com/morluto/rea/commit/4aa2b60c1d84607a138395ae93260b2e50c2a721))
* **native:** keep echoed Mach-O paths out of load commands and symbols ([ab985c6](https://github.com/morluto/rea/commit/ab985c6a10e9da856ed151100cee8459793c3573))
* **native:** keep echoed Mach-O paths out of load commands and symbols ([37fe105](https://github.com/morluto/rea/commit/37fe105ba168488d05226f2912bed802e2d48d75))
* **native:** keep integral plist reals beyond the JSON range as reals ([#860](https://github.com/morluto/rea/issues/860)) ([3b92a2b](https://github.com/morluto/rea/commit/3b92a2bceddaa1659654da08160813a3affbc6b7))
* **native:** keep plist XML element types for large numbers ([f85056d](https://github.com/morluto/rea/commit/f85056d83e42a461c8c947792774580294d0ceb9))
* **native:** keep the resolved bundle plist and permission failures ([418a556](https://github.com/morluto/rea/commit/418a5562f6f640503c751924a4787586c2c5c98a))
* **native:** pass Swift symbols to swift-demangle as operands ([dd90965](https://github.com/morluto/rea/commit/dd90965058a9e6f7dd7f30eb7e462572e777db7f))
* **native:** pass Swift symbols to swift-demangle as operands ([6c88094](https://github.com/morluto/rea/commit/6c88094da45258b346fe594764e561f999622a58))
* **native:** preserve incomplete native UI captures ([#991](https://github.com/morluto/rea/issues/991)) ([9f496ef](https://github.com/morluto/rea/commit/9f496ef2d4a3aa68816287bf5d2ba1620d72c97a))
* **native:** report exact plist integers beyond the JSON number range ([c9f49db](https://github.com/morluto/rea/commit/c9f49db907db0513ad8b22c9b2bbdcee400aff11))
* **native:** report exact plist integers beyond the JSON number range ([430c297](https://github.com/morluto/rea/commit/430c297ca4ddb3491c2b835b889486e6a2ffdc17))
* **native:** report plist permission denials as access failures ([5738a0c](https://github.com/morluto/rea/commit/5738a0cf8c111833847fecb2f7d0c2ee35eabbd6))
* **native:** report why a selected plist cannot be inspected ([14f9b3d](https://github.com/morluto/rea/commit/14f9b3d93119a60a3cf5f3d9c138ca829a5462e8))
* **native:** report why a selected plist cannot be inspected ([0674fac](https://github.com/morluto/rea/commit/0674facd468c3321584ece908031feee7220b9c6))
* **plist:** keep character references beyond Unicode literal ([5afd8a8](https://github.com/morluto/rea/commit/5afd8a850b2ebd62e3400a5e2ece1a1cfa98bab6))
* **plist:** read XML plists containing a __proto__ key ([faaee69](https://github.com/morluto/rea/commit/faaee693d5bb4bb957387ebd0f4338513c4c914a))
* **plist:** read XML plists containing a __proto__ key ([a08be51](https://github.com/morluto/rea/commit/a08be51e9f0d23bd46b66bbdb88dbda44bc54c88))
* **plist:** report omitted __proto__ entries in signatures and Interface Builder ([15ab5db](https://github.com/morluto/rea/commit/15ab5dbcaf3fac09756e98926373965247dad622))
* **plist:** report omitted __proto__ entries in signatures and Interface Builder ([6729ee7](https://github.com/morluto/rea/commit/6729ee7636889a0a2ebc9fca8e35860476f8ca34))
* preserve native UI failure reasons and dedupe version literals ([#854](https://github.com/morluto/rea/issues/854)) ([2d4a910](https://github.com/morluto/rea/commit/2d4a910fcd30e8d5b96fcb957b931e9aa3e4ab0c))
* **process:** clarify Windows capture support and recovery ([#798](https://github.com/morluto/rea/issues/798)) ([50787b2](https://github.com/morluto/rea/commit/50787b2faf1a4bea799d041960ca2b91199ef403))
* **process:** harden filesystem snapshot identity and cancellation ([#956](https://github.com/morluto/rea/issues/956)) ([93aa9eb](https://github.com/morluto/rea/commit/93aa9eb5c2551984182a4025d836e4223e8ecc8a))
* **process:** retain provider output until streams close ([#928](https://github.com/morluto/rea/issues/928)) ([b929251](https://github.com/morluto/rea/commit/b9292516f4eedc2dedba713abf57f665ef1fb596))
* **reference:** retain partial imports for unreadable directories ([#766](https://github.com/morluto/rea/issues/766)) ([cffc548](https://github.com/morluto/rea/commit/cffc548cd3127c5db811f20db4816039846b3170))
* **release:** drive checkpoint releases from frozen branches ([fc58fa1](https://github.com/morluto/rea/commit/fc58fa1eb01fe5a8200a78e9551799c9c1a3d256))
* **release:** publish from explicit source checkpoints ([49887f0](https://github.com/morluto/rea/commit/49887f0239da4483153a5e1610058619855525db))
* **semantics:** isolate named function expression bindings ([#776](https://github.com/morluto/rea/issues/776)) ([ae81f64](https://github.com/morluto/rea/commit/ae81f64d2ad10e5cdbf8356819351c02480aee7a))
* **semantics:** preserve direct promise ownership boundaries ([#758](https://github.com/morluto/rea/issues/758)) ([e1ca412](https://github.com/morluto/rea/commit/e1ca412757bb01be855a66bf72006e3becd497b6))
* **semantics:** preserve empty string property keys ([#764](https://github.com/morluto/rea/issues/764)) ([630bdaf](https://github.com/morluto/rea/commit/630bdafcacc621105f6a43ed68a6e51651aca629))
* **semantics:** recognize Node builtin default namespaces ([#769](https://github.com/morluto/rea/issues/769)) ([24a0bf9](https://github.com/morluto/rea/commit/24a0bf9a618604e2fa30817d673ce911c7842819))
* **semantics:** retain trailing rest argument flows ([#756](https://github.com/morluto/rea/issues/756)) ([4bfd803](https://github.com/morluto/rea/commit/4bfd8038be0a60c43a452bec15e23799a0b040c0))
* **setup:** accept the pinned Hopper RPM launcher ([#933](https://github.com/morluto/rea/issues/933)) ([dda8e6a](https://github.com/morluto/rea/commit/dda8e6a72890f87bdf8bbd3250b68b6648aae553))
* **setup:** read an OpenCode V2 server named type as a table entry ([#866](https://github.com/morluto/rea/issues/866)) ([4e17be5](https://github.com/morluto/rea/commit/4e17be57053fb0ce2561d92e05b6e38ef789b2d4))
* **setup:** register OpenCode V2 configurations in mcp.servers ([957069d](https://github.com/morluto/rea/commit/957069d14d832ddeac3f90dd141d379b81e2832a))
* **setup:** register OpenCode V2 configurations in mcp.servers ([69d8afe](https://github.com/morluto/rea/commit/69d8afefc19e014a4bba7a182983a9e77e100a75))
* **target:** decode app Info.plist executables with an XML parser ([c57f1b7](https://github.com/morluto/rea/commit/c57f1b74e0af5cf5fbb459cb247e1448cbf8df1b))
* **target:** decode app Info.plist executables with an XML parser ([c182f72](https://github.com/morluto/rea/commit/c182f72ad3d9eea10b084a43527acb7c8ca2d6bf))
* **test:** disconnect Hopper fixture IPC on SIGTERM ([b912b11](https://github.com/morluto/rea/commit/b912b117f019d5d3e4b4e3ef683e9b25f3a709bc))
* **windows:** accept ordinary drive path separators ([#791](https://github.com/morluto/rea/issues/791)) ([b62931f](https://github.com/morluto/rea/commit/b62931f8335f58bfe344883a4f149e9eef73d835))
* **windows:** remove cancelled snapshot outputs ([#957](https://github.com/morluto/rea/issues/957)) ([d76f7d1](https://github.com/morluto/rea/commit/d76f7d150895289aa1fb85a057b81ca7ff102df4))


### Performance Improvements

* **artifacts:** stream ASAR members without full buffering ([#962](https://github.com/morluto/rea/issues/962)) ([abd7a5e](https://github.com/morluto/rea/commit/abd7a5ed091061e4b1e83e5933e9009fb5b8d577))
* **call-path:** prune dead ends and enumerate without recursion ([#909](https://github.com/morluto/rea/issues/909)) ([e52fe97](https://github.com/morluto/rea/commit/e52fe9719fec03f2aa79b1a1b9e11b38c229903c))
* **cli:** defer catalog digests and use canonical cache scope ([9a15525](https://github.com/morluto/rea/commit/9a1552529889e9f5b52a88739eb767b92e57e24e))
* **cli:** defer unused catalog work during command startup ([#920](https://github.com/morluto/rea/issues/920)) ([9a15525](https://github.com/morluto/rea/commit/9a1552529889e9f5b52a88739eb767b92e57e24e))
* **comparison:** reuse canonical sort keys ([#990](https://github.com/morluto/rea/issues/990)) ([ebb065e](https://github.com/morluto/rea/commit/ebb065e2dc15f5763276f401521896f66bae6339))
* **dotnet:** index declaring-type ranges once per metadata table ([#918](https://github.com/morluto/rea/issues/918)) ([7a9f587](https://github.com/morluto/rea/commit/7a9f587c3a9998d828b83388438976527ca7074f))
* **dotnet:** index ordered declaring-type ranges once per table ([7a9f587](https://github.com/morluto/rea/commit/7a9f587c3a9998d828b83388438976527ca7074f))
* **evidence:** scale imports and dependency graphs ([#941](https://github.com/morluto/rea/issues/941)) ([7dc40d3](https://github.com/morluto/rea/commit/7dc40d3d9e00caf013109942a5d9a1d7fdf9ec62))
* **inspector:** bound runtime script location authorization ([#945](https://github.com/morluto/rea/issues/945)) ([58381ee](https://github.com/morluto/rea/commit/58381eefa24f73580e31eaa09dc14b9c04d78d6c))
* **javascript:** analyze member chains without recursive copying ([#932](https://github.com/morluto/rea/issues/932)) ([dcde958](https://github.com/morluto/rea/commit/dcde9584508830a5d99ac5e2032f539563c69002))
* **javascript:** index Promise return-site ownership ([#971](https://github.com/morluto/rea/issues/971)) ([2cedde9](https://github.com/morluto/rea/commit/2cedde9f1cf72b04bef37f9f004bb68d5ff6502a))
* **javascript:** index semantic fingerprint relations ([#942](https://github.com/morluto/rea/issues/942)) ([c92a344](https://github.com/morluto/rea/commit/c92a344d4770125d85a11f3fc7a23d800bd30003))
* **javascript:** reduce analysis and source-map work ([#955](https://github.com/morluto/rea/issues/955)) ([c7530f9](https://github.com/morluto/rea/commit/c7530f9a816d84354516d3ea137f4a0d91d3b8b3))
* **providers:** assemble fragmented responses once per line ([#911](https://github.com/morluto/rea/issues/911)) ([df7151b](https://github.com/morluto/rea/commit/df7151ba305eab3a33a9261a023705b29862b308))
* **reconstruction:** index coverage evaluation ([#983](https://github.com/morluto/rea/issues/983)) ([f26c8b5](https://github.com/morluto/rea/commit/f26c8b5b8cff10b93173359b5453874d659f2440))
* **setup:** reuse initial diagnostics during planning ([#940](https://github.com/morluto/rea/issues/940)) ([118d43e](https://github.com/morluto/rea/commit/118d43e787e38857714852cc846b1b604a61950d))


### Code Refactoring

* add incremental capability migration safeguards ([#819](https://github.com/morluto/rea/issues/819)) ([75f50d8](https://github.com/morluto/rea/commit/75f50d86f6d504f4dd97a707871d39ec022b3047))
* **android:** group layered source and verification ([#873](https://github.com/morluto/rea/issues/873)) ([8e8921d](https://github.com/morluto/rea/commit/8e8921d40c63b40ab7e1598f672063dd304d93f0))
* **apple:** group artifact producers and verification ([#952](https://github.com/morluto/rea/issues/952)) ([ef1a0cc](https://github.com/morluto/rea/commit/ef1a0cc65af7918ef7204a39f42a4299b486c453))
* **artifacts:** isolate JavaScript file acquisition ([#916](https://github.com/morluto/rea/issues/916)) ([f0a68dc](https://github.com/morluto/rea/commit/f0a68dce60e81b4d2f420bf774b61957a37326ac))
* **binary:** group session selection and snapshot ownership ([#886](https://github.com/morluto/rea/issues/886)) ([dd114d3](https://github.com/morluto/rea/commit/dd114d39801973e958a582c8fcba7ccce0e50299))
* **binary:** move production composition outside application workflows ([#965](https://github.com/morluto/rea/issues/965)) ([33d4761](https://github.com/morluto/rea/commit/33d4761cc7a96630b7c2fed890df83d433c45914))
* **browser:** align inspector exclusions with canonical vocabulary ([#834](https://github.com/morluto/rea/issues/834)) ([de9593a](https://github.com/morluto/rea/commit/de9593ad48c0b97507f18949b7ad86ad9c743ebc))
* **cli:** split core analysis command registrar ([#858](https://github.com/morluto/rea/issues/858)) ([8b9940a](https://github.com/morluto/rea/commit/8b9940a7b5d3fcd5a8eda6d397f0ab7c3aaf2ac9))
* colocate investigation record implementation ([#867](https://github.com/morluto/rea/issues/867)) ([bb19c94](https://github.com/morluto/rea/commit/bb19c9477ef3eefd9c5b2e6cabe78cc94e6779ae))
* compose investigation record ownership ([#845](https://github.com/morluto/rea/issues/845)) ([ce73c3f](https://github.com/morluto/rea/commit/ce73c3fed2e5fd20ae0113579345a69763eb7655))
* declare auxiliary capabilities from source ([#853](https://github.com/morluto/rea/issues/853)) ([4a6c17c](https://github.com/morluto/rea/commit/4a6c17ce83dfd20412f0e168525314a20c61169e))
* **domain:** consolidate property-key extraction behind semanticStaticPropertyKey ([#823](https://github.com/morluto/rea/issues/823)) ([764ff05](https://github.com/morluto/rea/commit/764ff05231f1a666dfa655492da42b4b6ba742c3))
* **domain:** converge comparison mechanics on shared vocabulary ([#824](https://github.com/morluto/rea/issues/824)) ([c13c9d4](https://github.com/morluto/rea/commit/c13c9d41f8441a711266adee21429fb7433a6aa1))
* **domain:** extract artifact path syntax helpers ([#830](https://github.com/morluto/rea/issues/830)) ([ef535b8](https://github.com/morluto/rea/commit/ef535b81fefc358b0bdb655e5aa057fc3949ce5f))
* **domain:** extract source-map envelope walk and disambiguate stringValue ([#828](https://github.com/morluto/rea/issues/828)) ([64ebdf4](https://github.com/morluto/rea/commit/64ebdf45016bda679674cbd2287576eadf66a1fc))
* **domain:** map validation taxonomies and add inventory Result seam ([#833](https://github.com/morluto/rea/issues/833)) ([78f4848](https://github.com/morluto/rea/commit/78f4848d70ce462426e9f221d6e7b3e34219bf46))
* **domain:** split Interface Builder keyed-archive parse from graph builder ([#859](https://github.com/morluto/rea/issues/859)) ([da09706](https://github.com/morluto/rea/commit/da0970672da725dbb095ffcaefad07303ae85aab))
* **firmware:** group layered source and verification ([#878](https://github.com/morluto/rea/issues/878)) ([507e8b3](https://github.com/morluto/rea/commit/507e8b3c7be75f8de69be214618394aca3585404))
* **ghidra:** extract createClient and load-image attestation ([#856](https://github.com/morluto/rea/issues/856)) ([b7df5b7](https://github.com/morluto/rea/commit/b7df5b78052539e57967db8e6562befd70c6ebdc))
* give Inspector its own capability directory ([#869](https://github.com/morluto/rea/issues/869)) ([021ba69](https://github.com/morluto/rea/commit/021ba690b07eab4b990be47f90946db9f70e0fc0))
* **javascript:** group application workflows and verification ([#896](https://github.com/morluto/rea/issues/896)) ([0804722](https://github.com/morluto/rea/commit/0804722cdf721a8d767d02f9342ebdf8d186f7e1))
* **javascript:** group domain semantics and contracts ([#907](https://github.com/morluto/rea/issues/907)) ([f6a58f1](https://github.com/morluto/rea/commit/f6a58f10629614fb7a6970421218b73d41bce6a5))
* **managed:** group capability workflows and verification ([#926](https://github.com/morluto/rea/issues/926)) ([28713f9](https://github.com/morluto/rea/commit/28713f9b4dcb882f0e811653890fde70cb5fdadb))
* **native:** group analyst semantics workflows and contracts ([#973](https://github.com/morluto/rea/issues/973)) ([ea4db4c](https://github.com/morluto/rea/commit/ea4db4c9f7cbc10dc701c4d5770109c08952a5b8))
* **native:** split Apple dispatch metadata decode facets ([#855](https://github.com/morluto/rea/issues/855)) ([676959e](https://github.com/morluto/rea/commit/676959ecb55b606a567af3d2eb3d3edc96f0aa2f))
* **provider:** declare deep capabilities from source ([#892](https://github.com/morluto/rea/issues/892)) ([b808e2d](https://github.com/morluto/rea/commit/b808e2d6bbbae38c1ff2e293e1cf77464d889bdd))
* share Android and firmware provider factories ([#826](https://github.com/morluto/rea/issues/826)) ([3ed59b2](https://github.com/morluto/rea/commit/3ed59b281247f2180b3c79e658078507e4cc1be2))


### Documentation

* add concise lawful-use disclaimer ([#888](https://github.com/morluto/rea/issues/888)) ([4037c65](https://github.com/morluto/rea/commit/4037c6545dc8cc47f4602d8f06e5329ed641cdbb))
* add DX-Ball reconstruction showcase ([#876](https://github.com/morluto/rea/issues/876)) ([895079d](https://github.com/morluto/rea/commit/895079dd093f02487789d9aa967f0cccbfe379d8))
* add prominent website and showcase links to READMEs ([2ccc86c](https://github.com/morluto/rea/commit/2ccc86cd13d71f08b553d3b9962175144b882539))
* add README star history chart ([#850](https://github.com/morluto/rea/issues/850)) ([11f27de](https://github.com/morluto/rea/commit/11f27deddf88703368942d3ddfc239a7ebe72e3e))
* add website and showcase links to READMEs ([#930](https://github.com/morluto/rea/issues/930)) ([2ccc86c](https://github.com/morluto/rea/commit/2ccc86cd13d71f08b553d3b9962175144b882539))
* **apple:** describe directory-based framework plist ambiguity ([6d74992](https://github.com/morluto/rea/commit/6d74992efed3271e8370c505afdde347609f8353))
* audit and improve localized readmes translations and wording ([00a6ac3](https://github.com/morluto/rea/commit/00a6ac3de99f432bd6dbb88148a2aab5f8d3d338))
* clarify NativeAOT scope and regenerate conformance ledger ([c945931](https://github.com/morluto/rea/commit/c945931961cbd488163c6d92ef91336ed506942e))
* fix stale IDA roadmap item, mermaid paths, toolchain wording ([d2aed17](https://github.com/morluto/rea/commit/d2aed172ab79d98ff4e62c14d8f34cc49c1d17b4))
* move quick start up and mark skill install optional ([554e9b1](https://github.com/morluto/rea/commit/554e9b1612f7799c2bc7177eb1a9b04a0f27d2e9))
* note Cloud Agent Node.js toolchain ([#837](https://github.com/morluto/rea/issues/837)) ([6aa6350](https://github.com/morluto/rea/commit/6aa6350c800796d0953937e894ff176ae248e930))
* publish VitePress documentation on GitHub Pages ([c78fe69](https://github.com/morluto/rea/commit/c78fe6990bcface6853ac5c11c90df6bc0df562d))
* separate ambiguous and unavailable provider recovery ([c3f2b8e](https://github.com/morluto/rea/commit/c3f2b8e7742915dc27ab7c801a8a1a9127169896))
* show task-scoped readiness and provider preference in the quick start ([880cca1](https://github.com/morluto/rea/commit/880cca1bca497bb53c97a821b470df0f2235e043))
* show task-scoped readiness and provider preference in the quick start ([5fd0db3](https://github.com/morluto/rea/commit/5fd0db37d94f1c1a0495920c79e121d799da0d30)), closes [#726](https://github.com/morluto/rea/issues/726)
* update release boundary to npm 4.1.0 with Windows native bundle ([69be514](https://github.com/morluto/rea/commit/69be514c67c8b2eb8b450355a9782d9237748fda))
* **website:** add Notion case study and improve onboarding ([a6ba772](https://github.com/morluto/rea/commit/a6ba772c08e2648e6602787a0ea537d75d72802d))
* **website:** add TH04 bullet-ring case study ([f8d84da](https://github.com/morluto/rea/commit/f8d84da127fad871050c098b004a503b36795ad0))
* **website:** add worked guides and keep Pages publishing manual ([#925](https://github.com/morluto/rea/issues/925)) ([4f25ee3](https://github.com/morluto/rea/commit/4f25ee33dcd4195f8d877f8835f81c4e08c95235))
* **website:** clarify guides and case studies ([5065fcd](https://github.com/morluto/rea/commit/5065fcd5205ec7c0d259131431c2cf54d9f69cf6))


### Tests

* **artifacts:** report compiled connector records when a storyboard route is missing ([d421d3f](https://github.com/morluto/rea/commit/d421d3f286ce515b5126859a0f9cac60667a168e))
* **artifacts:** report observed action routes when a compiled route is missing ([c60b737](https://github.com/morluto/rea/commit/c60b737f7db8e2c9a1982cdb4357fcda1f47ff08))
* **artifacts:** write the storyboard fixture's action in Cocoa syntax ([53bfa7e](https://github.com/morluto/rea/commit/53bfa7e3f792cdb9f2e95fc954f3616426414bcc))
* eliminate fixture races and prune redundant scaffolding ([#849](https://github.com/morluto/rea/issues/849)) ([f72931d](https://github.com/morluto/rea/commit/f72931d9dd54609bfca422750fc2667f80af691c))


### Continuous Integration

* consolidate macOS native baseline checks ([#935](https://github.com/morluto/rea/issues/935)) ([810fe53](https://github.com/morluto/rea/commit/810fe53e799b89dc215c52c9245d36fb2a44d9c4))
* verify native arm64 and Intel macOS workflows ([#898](https://github.com/morluto/rea/issues/898)) ([4801a24](https://github.com/morluto/rea/commit/4801a24089964860db7f4855be21d2d4313c7eab))

## [4.1.0](https://github.com/morluto/rea/compare/rea-agents-4.0.1...rea-agents-4.1.0) (2026-10-06)


### Features

* **android:** integrate static APK analysis with headless JADX ([#738](https://github.com/morluto/rea/issues/738)) ([904d03e](https://github.com/morluto/rea/commit/904d03e987a6c498561b314a266202dee84b13ab))
* **evidence:** accept exact retained application references ([#734](https://github.com/morluto/rea/issues/734)) ([d0f3480](https://github.com/morluto/rea/commit/d0f3480a3cb9887499c2b188c783dd1c4db09787))
* **firmware:** integrate Binwalk and Unblob analysis ([5a7c769](https://github.com/morluto/rea/commit/5a7c769692c21efc4cc0e5ebf06a9f2534dc75ed))
* **ghidra:** add atomic function annotation edits ([#709](https://github.com/morluto/rea/issues/709)) ([9bab553](https://github.com/morluto/rea/commit/9bab55337ab10616be6929afddb08fb19fbb8ab7))
* **ghidra:** admit explicit DOS COM analysis ([#702](https://github.com/morluto/rea/issues/702)) ([5bcb664](https://github.com/morluto/rea/commit/5bcb6645b561e666b7e07dd8f38d2296fa7cbba8))
* **ghidra:** enable Windows x64 read-only analysis ([#699](https://github.com/morluto/rea/issues/699)) ([26881da](https://github.com/morluto/rea/commit/26881da76aa320c8529fcc741df0fc9898d97bdc))
* **ghidra:** integrate optional NativeAOT metadata recovery ([#748](https://github.com/morluto/rea/issues/748)) ([fb679b6](https://github.com/morluto/rea/commit/fb679b63c27e6c5f137532953cfa24a2ffb1aaf2))
* **ghidra:** verify DOS load images and expose memory evidence ([#697](https://github.com/morluto/rea/issues/697)) ([a6a8f67](https://github.com/morluto/rea/commit/a6a8f67649cab558b0de11601e65425f280c7170))
* **ida:** add read-only GUI and headless MCP providers ([#754](https://github.com/morluto/rea/issues/754)) ([8238232](https://github.com/morluto/rea/commit/82382324855a3a4ed51d2cdc3b2b455c9e8419e2))
* **setup:** support Command Code MCP registration ([#645](https://github.com/morluto/rea/issues/645)) ([7f1ae42](https://github.com/morluto/rea/commit/7f1ae42f71ce85547d317eed5e62fa330d9876bb))


### Bug Fixes

* **android:** validate explicit Java runtime ([#742](https://github.com/morluto/rea/issues/742)) ([7390390](https://github.com/morluto/rea/commit/739039092f98c67e8e6ccfb1f8445e8f13ac8f15))
* **artifacts:** make extraction output tree work on Windows ([#753](https://github.com/morluto/rea/issues/753)) ([c8e66c7](https://github.com/morluto/rea/commit/c8e66c704a70f5133922aa1bd1a3ba42959093ba))
* **browser:** classify CSP host sources by their own origin ([#707](https://github.com/morluto/rea/issues/707)) ([1d15bcb](https://github.com/morluto/rea/commit/1d15bcb9ecd7efa487a8fd3f0d9755bd60051722))
* **browser:** keep bare module locations unresolved ([#676](https://github.com/morluto/rea/issues/676)) ([8189081](https://github.com/morluto/rea/commit/8189081511441f0e3909b21b80c21c658ec9a453))
* **ci:** upload Vitest blob reports from current path ([77799e6](https://github.com/morluto/rea/commit/77799e6c90ce36cd52e45b62c9cba2d46641c4cf))
* **cli:** disable unmanaged skill synchronization ([433ebda](https://github.com/morluto/rea/commit/433ebda8b492f388faf6e6cac63ccc6f9c2d8d7e))
* **cli:** disable unmanaged skill synchronization ([2c1bf92](https://github.com/morluto/rea/commit/2c1bf9201040ed3d60f475af9129b7bf85a508fa))
* **cli:** fail when JSON input files cannot be parsed ([18c1829](https://github.com/morluto/rea/commit/18c18290d048b78a435f6864dfc778a9fea0af2e))
* **cli:** fail when JSON input files cannot be parsed ([3201f05](https://github.com/morluto/rea/commit/3201f0538dc88e54bce00decf689bf9b5603bfd3))
* **cli:** include build step in missing-runtime recovery ([6a37346](https://github.com/morluto/rea/commit/6a37346acb9829acaab0e2042624e6ea0d03e2a9))
* **cli:** include build step in missing-runtime recovery ([ae72abd](https://github.com/morluto/rea/commit/ae72abd019b25347bfc7593b5dcadc5a2cbc3786))
* **cli:** report reference-source import failures ([00eb03d](https://github.com/morluto/rea/commit/00eb03d0f2247da95dfa7bda0f41a0f366a25dd9))
* **cli:** report reference-source import failures ([431e8eb](https://github.com/morluto/rea/commit/431e8ebfcfba2925904c0deb4888bbd3755b17bf))
* **comparison:** break function collection collation ties ([c3d013b](https://github.com/morluto/rea/commit/c3d013b2fd5c3a32dfa73ef40dafdaeaf935f37e))
* **comparison:** break function collection collation ties ([3aaf7e2](https://github.com/morluto/rea/commit/3aaf7e2c54029a456145d6e3287fd9122f3abbe3))
* **comparison:** break JSON shape collation ties ([217e8cf](https://github.com/morluto/rea/commit/217e8cf59f49e2f68b394fbcbc87f914dbee97ee))
* **comparison:** break JSON shape collation ties ([805c338](https://github.com/morluto/rea/commit/805c338f360184d73ae335a723fca656830d6328))
* **comparison:** retain container-only export shape paths ([a55b5bb](https://github.com/morluto/rea/commit/a55b5bb8ee400ef5565954d57916e8aae7dac760))
* **comparison:** retain container-only export shape paths ([7864d66](https://github.com/morluto/rea/commit/7864d665e15edec29ade0f3fb7ac374b8579c2c0))
* **dotnet:** preserve leading Unicode content in metadata strings ([#667](https://github.com/morluto/rea/issues/667)) ([ddea063](https://github.com/morluto/rea/commit/ddea06360a09508a0ff695ab6e141eff19534619))
* **electron:** respect computed option keys and overrides ([af48fe8](https://github.com/morluto/rea/commit/af48fe879161ee749692751b3e29ba06b63b7409))
* **electron:** respect computed option keys and overrides ([98de338](https://github.com/morluto/rea/commit/98de3380e3062cb25778263bfea07b215a09b39c))
* **evidence:** admit current process provider identity ([ab5a1c6](https://github.com/morluto/rea/commit/ab5a1c61b12475c554a5e4d60b48b642b2464bbb))
* **evidence:** admit current process provider identity ([d311940](https://github.com/morluto/rea/commit/d311940f2414fe5cceb750de4464b681bb44ae1e))
* **firmware:** validate configured executables ([#751](https://github.com/morluto/rea/issues/751)) ([9a4e6da](https://github.com/morluto/rea/commit/9a4e6da5a96ed2708a0f628b436dcd7415999327))
* **ghidra:** preserve request and shutdown failure diagnostics ([#647](https://github.com/morluto/rea/issues/647)) ([19f8cdd](https://github.com/morluto/rea/commit/19f8cddfd6f283188567b8ff1e49b810d79952ee))
* **ghidra:** refuse ambiguous universal Mach-O imports ([b1b687f](https://github.com/morluto/rea/commit/b1b687fb75325c0275a0cf161843fc5969ba1d47))
* **ghidra:** refuse ambiguous universal Mach-O imports ([6582b24](https://github.com/morluto/rea/commit/6582b2433a955167e33246ad07de1a40bcb20144))
* **hopper:** retain shutdown request diagnostics ([8d7071d](https://github.com/morluto/rea/commit/8d7071da4c61c5cfb4894be6536405affd90f276))
* **hopper:** retain shutdown request diagnostics ([7254871](https://github.com/morluto/rea/commit/72548712fea972b920834663a5e2ceea4738ce1e))
* integrate 14 approved fix PRs (668,671,673,675,678-681,685-690) ([#705](https://github.com/morluto/rea/issues/705)) ([cf06115](https://github.com/morluto/rea/commit/cf061159ab69a746675e48896fa953d6990c05f9))
* **javascript:** count all source line terminators ([e60aa11](https://github.com/morluto/rea/commit/e60aa1110800e1309b482e7a44ecd1762bade992))
* **javascript:** count all source line terminators ([03bc6d3](https://github.com/morluto/rea/commit/03bc6d36db94e70c709557cb7302d40af9e99e6b))
* **javascript:** expose result schema failures ([6d1f39b](https://github.com/morluto/rea/commit/6d1f39b250f8a1c6f924b1a6b9d26d56dff4beee))
* **javascript:** expose result schema failures ([99263a7](https://github.com/morluto/rea/commit/99263a720d7106aff059ad7fa43849151a94c963))
* **javascript:** hash graph and evidence JSON incrementally ([#646](https://github.com/morluto/rea/issues/646)) ([9f42495](https://github.com/morluto/rea/commit/9f42495d11100adc8646de5c8b62762ab9715ae6))
* **javascript:** preserve path.resolve reset semantics ([863ed47](https://github.com/morluto/rea/commit/863ed47de2e35ef9b734e45e3bb44ea9e9dc8ff6))
* **javascript:** preserve path.resolve reset semantics ([4177377](https://github.com/morluto/rea/commit/417737748aa96ba38ced7b0b22dbb972187f2ee0))
* **javascript:** preserve primitive addition coercion ([#666](https://github.com/morluto/rea/issues/666)) ([94cc847](https://github.com/morluto/rea/commit/94cc8475e0e9e24cd2e8345bd36a743a979e3620))
* **javascript:** preserve unknown branches in primitive unions ([75a75cb](https://github.com/morluto/rea/commit/75a75cbb20aa9b2148f9fd0547f613eadda68edd))
* **javascript:** preserve unknown branches in primitive unions ([9a2f395](https://github.com/morluto/rea/commit/9a2f3950286a01922be0b07b29c4aefee466ec1e))
* **javascript:** read source-map directives only from comments ([#672](https://github.com/morluto/rea/issues/672)) ([7f1fa64](https://github.com/morluto/rea/commit/7f1fa64019e01a654ad0eb80b47d268a58f04e57))
* **javascript:** scope candidate ambiguity to query traversal ([6ad62ce](https://github.com/morluto/rea/commit/6ad62cec6abf182a52cf9844145e147fb6399c8e))
* **javascript:** scope candidate ambiguity to query traversal ([f94fc79](https://github.com/morluto/rea/commit/f94fc7967b2e5604c144d3638515caad6273a0c6))
* **mcp:** retain shutdown failure diagnostics ([09c249d](https://github.com/morluto/rea/commit/09c249deb86068503611fc474e76018d5c2a4d0b))
* **mcp:** retain shutdown failure diagnostics ([fd008cd](https://github.com/morluto/rea/commit/fd008cd8e0b8277e691efd8e69dc96ac8e188d9e))
* **native:** inspect mixed-signature Mach-O slices ([1dccd0d](https://github.com/morluto/rea/commit/1dccd0dee04abfdc80e8b48e3f05fa39cccf0feb))
* **native:** inspect mixed-signature Mach-O slices ([66f3cfa](https://github.com/morluto/rea/commit/66f3cfa594a86cbf1f21fc6d2eca1a82e236c896))
* **native:** retain spaced symbols in dyld inventory ([#669](https://github.com/morluto/rea/issues/669)) ([fa02df9](https://github.com/morluto/rea/commit/fa02df9ad3bc3139ef10422dedffac88c4d51d36))
* **native:** select concrete arm64e Mach-O slices ([f04445c](https://github.com/morluto/rea/commit/f04445c57c597a8312211139b75da706cb0c2a96))
* **native:** select concrete arm64e Mach-O slices ([fd3282a](https://github.com/morluto/rea/commit/fd3282a87e40417cf3d7d6211743809f9bad2dc8))
* **process:** honor disabled PID normalization in samples ([44b3627](https://github.com/morluto/rea/commit/44b3627ab0b32c42e545dd2fd095006d249a77f6))
* **process:** honor disabled PID normalization in samples ([a4e5736](https://github.com/morluto/rea/commit/a4e57366dd75077bde07f25c7966204cedad929e))
* **process:** scope comparison unknowns to their evidence ([#732](https://github.com/morluto/rea/issues/732)) ([9dd6cef](https://github.com/morluto/rea/commit/9dd6cef90abf89f9191bce942e31900870231968))
* **reconstruction:** accept function comparison source parameters ([c3bc38b](https://github.com/morluto/rea/commit/c3bc38bf6c74d2175a4680530dcadd6cab0e7791))
* **reconstruction:** accept function comparison source parameters ([7a96391](https://github.com/morluto/rea/commit/7a96391001780012f704f4ef5cb6597baa590b7d))
* **reference:** bound Dockerfile language detection ([132a3a4](https://github.com/morluto/rea/commit/132a3a46be648b036ed36372a50d6e32a9e7f2e5))
* **reference:** bound Dockerfile language detection ([53fa559](https://github.com/morluto/rea/commit/53fa55937f241fc9ef3091eb22314cc370c749b9))
* **reference:** classify test suffixes before extensions ([e828acc](https://github.com/morluto/rea/commit/e828acce0e0bf3808773590cf2dbb0bc8227df7b))
* **reference:** classify test suffixes before extensions ([8b228ae](https://github.com/morluto/rea/commit/8b228ae7010144b69a243c9682aeb0a1dc4249a3))
* **reference:** distinguish computed require member names ([ba35b55](https://github.com/morluto/rea/commit/ba35b5509db60c18dd43e350e0dd4a0b5f229c69))
* **reference:** distinguish computed require member names ([df6e476](https://github.com/morluto/rea/commit/df6e476d67b2719c4b998daa3e9ad8a4b157ace2))
* **reference:** preserve unresolved absolute module specifiers ([#670](https://github.com/morluto/rea/issues/670)) ([c8aed47](https://github.com/morluto/rea/commit/c8aed4740d52b1eecaa93b3a527e8b3814dc88a4))
* **reference:** read linked worktree commit provenance ([#677](https://github.com/morluto/rea/issues/677)) ([d565ecd](https://github.com/morluto/rea/commit/d565ecdc257514f5d0c5a412081e322fc66d4215))
* **reference:** recognize CMake build manifests ([#665](https://github.com/morluto/rea/issues/665)) ([1a24be5](https://github.com/morluto/rea/commit/1a24be574d1860931ff8d4c8ec07f3968fff9fd5))
* **reference:** retain dynamic import relationships ([a5d2986](https://github.com/morluto/rea/commit/a5d2986b1e517b71a1ed51be433c95e975eafe32))
* **reference:** retain dynamic import relationships ([b89de8f](https://github.com/morluto/rea/commit/b89de8feab389477a468f0b89b8dfa35d7ddc102))
* **reference:** retain recovered parser diagnostics ([11d0ef2](https://github.com/morluto/rea/commit/11d0ef2e09308ac06889865b3fcf356b8ffa647f))
* **reference:** retain recovered parser diagnostics ([ed3a7f0](https://github.com/morluto/rea/commit/ed3a7f070cf0793e22b9a0bbfd1f2ebe9dabcfd0))
* **setup:** accept leading BOM in JSON client configs ([a5b970c](https://github.com/morluto/rea/commit/a5b970c6bf6848145a82de51c001410aa4d50f6f))
* **setup:** accept leading BOM in JSON client configs ([fe843ec](https://github.com/morluto/rea/commit/fe843ec0b101544e22d7599d93b36377d3e3bc34))
* **setup:** align Node runtime checks with package engines ([5802ef8](https://github.com/morluto/rea/commit/5802ef8746412649bb641332f2fa7e69bb1a86a3))
* **setup:** align Node runtime checks with package engines ([ea0b733](https://github.com/morluto/rea/commit/ea0b733687582d6cc28b42beaf2fc7a48be07b6a))
* **target:** explain the JavaScript directory analysis route ([#733](https://github.com/morluto/rea/issues/733)) ([8d44b3e](https://github.com/morluto/rea/commit/8d44b3edd36b528c308e32328552ca386dc43e91))
* **trace:** match typed seeds against member arrays ([65c8797](https://github.com/morluto/rea/commit/65c879757ea09fabc5fc036d6e3395fd2939995c))
* **trace:** match typed seeds against member arrays ([38ebd54](https://github.com/morluto/rea/commit/38ebd54776d661ced2e6cc2c5e4b260653a086d9))


### Code Refactoring

* **app:** split Setup and ProcessOwnership modules ([#628](https://github.com/morluto/rea/issues/628)) ([3c84080](https://github.com/morluto/rea/commit/3c84080aab5e5aa6c9fc14bafa07c635b537b64d))
* **cli:** collapse duplicate CLI layer into src/cli ([#630](https://github.com/morluto/rea/issues/630)) ([494d4db](https://github.com/morluto/rea/commit/494d4db6d9d519f9258a25504cf29b07d61fbb9f))
* **contracts:** split tool contracts by family ([#634](https://github.com/morluto/rea/issues/634)) ([5295d56](https://github.com/morluto/rea/commit/5295d56b105074b290e0d881df43cd13e34a2f8b))
* **domain:** consolidate canonical ordering and digest helpers ([#624](https://github.com/morluto/rea/issues/624)) ([ba3869c](https://github.com/morluto/rea/commit/ba3869c597133b63fdcc0077c558923ae2e17a3f))
* **domain:** split error taxonomy into thematic modules ([#636](https://github.com/morluto/rea/issues/636)) ([735c100](https://github.com/morluto/rea/commit/735c10059ca161967d71ccf8fa3f62011d2a22ca))
* **native:** extract FAT header format switch in Mach-O slice selection ([#632](https://github.com/morluto/rea/issues/632)) ([38b2933](https://github.com/morluto/rea/commit/38b293329ca06c424a58bb59a28728f19015ce22))
* **runtime:** centralize safe JSON parsing and preserve error causes ([#629](https://github.com/morluto/rea/issues/629)) ([e7f54b3](https://github.com/morluto/rea/commit/e7f54b3310b7f45af11c1754e468d4d3804191db))
* **runtime:** name all silent catch causes without changing diagnostics ([#637](https://github.com/morluto/rea/issues/637)) ([5f27e02](https://github.com/morluto/rea/commit/5f27e02fae670774667de3618c88ba2ab0e7b661))


### Documentation

* add the official Trendshift badge to README headers ([b6c21b1](https://github.com/morluto/rea/commit/b6c21b1db5d4ff4be0968aa26693916537622a06))
* add the official Trendshift badge to README headers ([7d4ed59](https://github.com/morluto/rea/commit/7d4ed59816388409885310f40c12dfdcdd2d9246))
* align MCP discovery and skill guidance with the stable catalog ([#664](https://github.com/morluto/rea/issues/664)) ([39db9fe](https://github.com/morluto/rea/commit/39db9fe4245cc8142f57f4feeadaff64cb894e31))
* **browser:** add an interaction example that captures the visible result ([#750](https://github.com/morluto/rea/issues/750)) ([91daaa6](https://github.com/morluto/rea/commit/91daaa68aea3bbee02b837ac64d3ad13127d601e))
* clarify onboarding and align provider guidance ([#745](https://github.com/morluto/rea/issues/745)) ([5af1699](https://github.com/morluto/rea/commit/5af169910391f6b95492865247fabf3c4735a9d6))
* correct CLI examples and documentation checks ([#655](https://github.com/morluto/rea/issues/655)) ([fc80ea8](https://github.com/morluto/rea/commit/fc80ea88dfb7bde43e89db0f341c99d7b53c1a7c))
* fix architecture diagram and pretty-print tool catalog ([#626](https://github.com/morluto/rea/issues/626)) ([5e7f35c](https://github.com/morluto/rea/commit/5e7f35c7c3ea8d504421a2623eafd1d73fea08a0))
* **ghidra:** explain first-query deadlines and recovery ([#736](https://github.com/morluto/rea/issues/736)) ([e2c23f3](https://github.com/morluto/rea/commit/e2c23f3640f83c13587603c763dbd7b5ef1bbbb0))
* **hopper:** document HopperTargetLease realpath fallback ([#711](https://github.com/morluto/rea/issues/711)) ([d3f498c](https://github.com/morluto/rea/commit/d3f498ceec65e4f61f39036ab943ace7ef1b9de5))
* **installation:** pin manual MCP registration to the release version ([#658](https://github.com/morluto/rea/issues/658)) ([8dd1d84](https://github.com/morluto/rea/commit/8dd1d8447146b9962ec7ab2f245b0fe47d3ddf44))
* update Trendshift repository badge ([3f6d6dc](https://github.com/morluto/rea/commit/3f6d6dc756d99ca6e7cdc1737522842fcbaee839))


### Tests

* extract shared fixtures, drop knip carve-outs ([#627](https://github.com/morluto/rea/issues/627)) ([55e5eb0](https://github.com/morluto/rea/commit/55e5eb090bb3d6cf347d7cc2f8f028b35b7461ba))
* **hopper:** synchronize startup cancellation with launcher readiness ([#662](https://github.com/morluto/rea/issues/662)) ([88a3c3f](https://github.com/morluto/rea/commit/88a3c3f8a4bf5cb31f60bca4696431c4e4512b30))

## [4.0.1](https://github.com/morluto/rea/compare/rea-agents-4.0.0...rea-agents-4.0.1) (2026-10-05)


### Bug Fixes

* **release:** allow npm propagation time ([2ef02ce](https://github.com/morluto/rea/commit/2ef02ced1603809f0fc6984612de31dce1801dd8))

## [4.0.0](https://github.com/morluto/rea/compare/rea-agents-3.2.1...rea-agents-4.0.0) (2026-10-05)


### ⚠ BREAKING CHANGES

* Managed comparison metadata adds exact-signature matching and its count, and name_matching now reports exact-signature-fallback.
* **setup:** unscoped setup refreshes only existing REA-owned registrations. Use --all-detected to configure every detected client. Setup JSON contains a compact doctor summary; use rea doctor for full diagnostics. Cancellation and successful dry runs now exit successfully.
* Remove controlled replay, Node characterization, finite replay-machine, managed runtime planning, and redundant string-tracing tools. Retire process replay, shims, reactive scenarios, custom checkpoints, and active browser replay and origin-scope inputs.
* **tools:** Removed permission configuration and policy commands, approval fields, filesystem scope inputs, and fixed confirmation options. Process capture inherits the host environment and accepts command names; callers must refresh tool schemas and migrate removed fields.

### Features

* **ghidra:** add DOS MZ analysis and complete function extents ([#556](https://github.com/morluto/rea/issues/556)) ([4f099a1](https://github.com/morluto/rea/commit/4f099a10f819125d52bd8baed9a9018496212eab))
* **native:** add inspection primitives, dispatch traces and approved UI observation ([#500](https://github.com/morluto/rea/issues/500)) ([4fbc501](https://github.com/morluto/rea/commit/4fbc501121e96b33665a76cad2e5c3e8ac2e2c6d))
* **setup:** expand agent integrations and verify updates ([#577](https://github.com/morluto/rea/issues/577)) ([6256b68](https://github.com/morluto/rea/commit/6256b6866616fa0c3137a77ebd31cf34155a642f))


### Bug Fixes

* **artifacts:** break directory child collation ties ([#587](https://github.com/morluto/rea/issues/587)) ([b37e47c](https://github.com/morluto/rea/commit/b37e47c9f729a66008b1dc8b0a1bb266e79c2776))
* **artifacts:** exclude removed paths from unchanged counts ([#569](https://github.com/morluto/rea/issues/569)) ([52bf709](https://github.com/morluto/rea/commit/52bf709bcefb17ab07e1f9c47c5fadf5eca9bd4e))
* **artifacts:** expand nested ASARs on Windows ([#582](https://github.com/morluto/rea/issues/582)) ([ebb4c45](https://github.com/morluto/rea/commit/ebb4c45b6892ab60f2c81e05fbb4cb528ffbffc4))
* **artifacts:** interrupt ZIP extraction under backpressure ([#594](https://github.com/morluto/rea/issues/594)) ([50f7e81](https://github.com/morluto/rea/commit/50f7e81432001239ca8b5de3a9cfe8f5980d2711))
* **artifacts:** preserve archive entry types and host paths ([#581](https://github.com/morluto/rea/issues/581)) ([28e0f4e](https://github.com/morluto/rea/commit/28e0f4e9ec09ae35b26920e4c6925f48770bf5ed))
* **artifacts:** refresh cached ASAR headers for each inventory ([#574](https://github.com/morluto/rea/issues/574)) ([f5013c5](https://github.com/morluto/rea/commit/f5013c50ca81795f91fd945fae2fb76f9dbe0f97))
* **artifacts:** resolve parents after archive enumeration ([#578](https://github.com/morluto/rea/issues/578)) ([8eac290](https://github.com/morluto/rea/commit/8eac290e8d716817526ab7f628e83c75fb33d06b))
* **artifacts:** respect XML plist byte-order marks ([#514](https://github.com/morluto/rea/issues/514)) ([23c4eba](https://github.com/morluto/rea/commit/23c4eba5b38b8de4f9547d879f2c3e54f741b1e1))
* **artifacts:** retain expanded ASAR container parents ([#583](https://github.com/morluto/rea/issues/583)) ([00fa974](https://github.com/morluto/rea/commit/00fa97422f585db878ffe5d1613c56608916f972))
* **artifacts:** retain relative paths in directory identities ([#580](https://github.com/morluto/rea/issues/580)) ([348323d](https://github.com/morluto/rea/commit/348323dd23360bbac3841a9632ffcd08290566d2))
* **browser:** capture popup network and report early event gaps ([#614](https://github.com/morluto/rea/issues/614)) ([f557207](https://github.com/morluto/rea/commit/f557207887ca9336f3d3c5fc02c76c354c1b2945))
* **browser:** capture selected events in popup pages ([#600](https://github.com/morluto/rea/issues/600)) ([a3bf4a0](https://github.com/morluto/rea/commit/a3bf4a0944ce5a52e100470273b91fdd48ebce49))
* **browser:** derive source-map imports from syntax nodes ([#588](https://github.com/morluto/rea/issues/588)) ([bae87b4](https://github.com/morluto/rea/commit/bae87b4ded343b34c4226b5e5d491145db7f85ff))
* **browser:** distinguish duplicate screenshot frame events ([#612](https://github.com/morluto/rea/issues/612)) ([1bd641d](https://github.com/morluto/rea/commit/1bd641d39f58461566e4a3f07fa00f84f34e87ad))
* **browser:** ignore duplicate frame navigations and read block-form source map directives ([#546](https://github.com/morluto/rea/issues/546)) ([828395d](https://github.com/morluto/rea/commit/828395d510bd4f29525e5a0807a550a2daad885c))
* **browser:** keep subresource redirects out of page navigation scope ([#524](https://github.com/morluto/rea/issues/524)) ([9c28f3c](https://github.com/morluto/rea/commit/9c28f3c4c0840fd7424dc669db1fb9baa1dde5d7))
* **browser:** preserve RGB PNG transparent samples ([#595](https://github.com/morluto/rea/issues/595)) ([9997152](https://github.com/morluto/rea/commit/9997152c2d3127162161a2b945f506f0e834be38))
* **browser:** release cancelled CDP cleanup without waiting for responses ([#517](https://github.com/morluto/rea/issues/517)) ([488fd5f](https://github.com/morluto/rea/commit/488fd5f60be3b2900c27a915c73322b9cb5eabb5))
* **browser:** release discarded source-map response bodies ([#611](https://github.com/morluto/rea/issues/611)) ([8642055](https://github.com/morluto/rea/commit/864205570a0a9452f96c11feacd00338d026f17b))
* **browser:** resolve redirected source map paths from final URL ([#518](https://github.com/morluto/rea/issues/518)) ([056c123](https://github.com/morluto/rea/commit/056c1237591de3710cb96a51ddd71fa94317b906))
* **cli:** fail commands returning projected analysis errors ([#506](https://github.com/morluto/rea/issues/506)) ([2fd1196](https://github.com/morluto/rea/commit/2fd11961cfba0c2d211a1aa643cbf05fa4e8c20d))
* **cli:** reject invalid UTF-8 JSON file bytes ([#613](https://github.com/morluto/rea/issues/613)) ([22acb0d](https://github.com/morluto/rea/commit/22acb0d5d730379fbe49e9e491f446e11425190e))
* **comparison:** account for unpaired records after explicit bundle pairing ([#603](https://github.com/morluto/rea/issues/603)) ([12a2e37](https://github.com/morluto/rea/commit/12a2e3793af63542448124311e17eacbd5235fc0))
* **comparison:** match generated names without swallowing symbol prefixes ([#596](https://github.com/morluto/rea/issues/596)) ([5f3ba3e](https://github.com/morluto/rea/commit/5f3ba3e6886b6b3186711e025da14875dc3c9684))
* **comparison:** normalize CFG identity by numeric addresses ([#593](https://github.com/morluto/rea/issues/593)) ([d1e5c0e](https://github.com/morluto/rea/commit/d1e5c0e1fd04d2d5a0d663cbe43787a010e3d783))
* **comparison:** require decoded signatures for structural method matches ([#604](https://github.com/morluto/rea/issues/604)) ([4a98c3e](https://github.com/morluto/rea/commit/4a98c3ea035480561d138d79288974a860c2aa22))
* **conformance:** preserve own JSON keys during comparison ([#573](https://github.com/morluto/rea/issues/573)) ([3460eda](https://github.com/morluto/rea/commit/3460eda9ca01ccf41e3b9895f3cbe975c0eaed51))
* correct native inventories and bridge error classification ([#503](https://github.com/morluto/rea/issues/503)) ([405732a](https://github.com/morluto/rea/commit/405732a7f55e3033c29533b18f7d8313dbd28570))
* **docs:** allow README installation wording to vary ([92617f9](https://github.com/morluto/rea/commit/92617f965720aaa74ec20ad67291adc5e83677a1))
* **ghidra:** avoid nested quotes in Windows Java options ([a574b74](https://github.com/morluto/rea/commit/a574b744b8fe95e906524684f6a3b28cdc656499))
* **ghidra:** recover evidenced switch cases and default targets ([#579](https://github.com/morluto/rea/issues/579)) ([b225b0f](https://github.com/morluto/rea/commit/b225b0f64bfa86586c17f193d30e278d8124b14e))
* **inspector:** preserve lossy Node discovery locations ([#542](https://github.com/morluto/rea/issues/542)) ([84e4361](https://github.com/morluto/rea/commit/84e4361c0936a4bb30951699fb68970d4d7a2327)), closes [#530](https://github.com/morluto/rea/issues/530)
* **javascript:** avoid invented computed destructuring properties ([#507](https://github.com/morluto/rea/issues/507)) ([80777d9](https://github.com/morluto/rea/commit/80777d96daf64d0266e5cf3f9aad9338b97be4ff))
* **javascript:** bind named class expressions in their class scope ([#510](https://github.com/morluto/rea/issues/510)) ([55f0267](https://github.com/morluto/rea/commit/55f0267c409cbf096bcdbd07d7604c44bcde3fbe))
* **javascript:** classify assignment targets and retain compound-assignment reads ([#537](https://github.com/morluto/rea/issues/537)) ([333d118](https://github.com/morluto/rea/commit/333d118c0fa65c8c418baaa337270c0ad25cd7cc))
* **javascript:** correct lexical and dynamic scope analysis ([#538](https://github.com/morluto/rea/issues/538)) ([6fa6f1f](https://github.com/morluto/rea/commit/6fa6f1f9b17318220abb2683c327146785dcc5d3))
* **javascript:** honor computed keys when naming callables, exports, requests and options ([#536](https://github.com/morluto/rea/issues/536)) ([4c8dc39](https://github.com/morluto/rea/commit/4c8dc39f439b5283b077c6aa47f262714d7c4bbd))
* **javascript:** honor package exports condition order ([#591](https://github.com/morluto/rea/issues/591)) ([8289595](https://github.com/morluto/rea/commit/82895959d1494f16bc59909a2575facf3ab19d79))
* **javascript:** isolate lexical loop bindings ([#511](https://github.com/morluto/rea/issues/511)) ([c30878f](https://github.com/morluto/rea/commit/c30878f616c4496c6cd1993d677aa019b2412b7e))
* **javascript:** prefer package entrypoints over directory indexes ([#575](https://github.com/morluto/rea/issues/575)) ([bb91abd](https://github.com/morluto/rea/commit/bb91abd3df52802ec8f9d3d1fb215dce5eb6ea49))
* **javascript:** preserve literal CommonJS path punctuation ([#576](https://github.com/morluto/rea/issues/576)) ([063cd25](https://github.com/morluto/rea/commit/063cd25a93ee9f16b45635fea196dde0d9309ab9))
* **javascript:** preserve Node exports fallback stop reasons ([#606](https://github.com/morluto/rea/issues/606)) ([adc07f5](https://github.com/morluto/rea/commit/adc07f5eaab005f013c88617aa09b6f2b4af4111))
* **javascript:** respect HTML base URL components ([#589](https://github.com/morluto/rea/issues/589)) ([ffbde92](https://github.com/morluto/rea/commit/ffbde92f9ab65a868b660abf17ce9d3c4577d125))
* **javascript:** respect lexical shadowing of require ([#509](https://github.com/morluto/rea/issues/509)) ([6a431d8](https://github.com/morluto/rea/commit/6a431d806a1574a660b96ba49412b24df9e93b50))
* **javascript:** retain property reads during updates ([#508](https://github.com/morluto/rea/issues/508)) ([6b7923c](https://github.com/morluto/rea/commit/6b7923cdd2a099d1481783f34970a3d1a71a8206))
* **managed:** classify truncated signatures as malformed ([#598](https://github.com/morluto/rea/issues/598)) ([1b6f054](https://github.com/morluto/rea/commit/1b6f05470d6fb1903346ef7a25fb5f9d23079cb7))
* **managed:** distinguish metadata handles from member accesses ([#607](https://github.com/morluto/rea/issues/607)) ([c73742f](https://github.com/morluto/rea/commit/c73742f3003ec6c1469f77ecc9ccb093df636b4a))
* **managed:** recognize PE Thumb and ARMNT machines ([#605](https://github.com/morluto/rea/issues/605)) ([0ce529a](https://github.com/morluto/rea/commit/0ce529af4e0280fcbd4e647d0fcb0a9ca9f3496e))
* **mcp:** emit valid schemas for empty arrays ([#535](https://github.com/morluto/rea/issues/535)) ([4007b20](https://github.com/morluto/rea/commit/4007b20fc277b4d20b52cae328dea58ae033be63)), closes [#528](https://github.com/morluto/rea/issues/528)
* **mcp:** return complete inline Evidence records ([#585](https://github.com/morluto/rea/issues/585)) ([ea9c3da](https://github.com/morluto/rea/commit/ea9c3dab6b2ff4fa943c8ca4fec7ae8b304dbd93)), closes [#551](https://github.com/morluto/rea/issues/551)
* **native:** capture Mach-O header metadata alongside load commands ([#525](https://github.com/morluto/rea/issues/525)) ([a8195ba](https://github.com/morluto/rea/commit/a8195ba2cc34a37f68d7bb8a8087d73ace40984b))
* **native:** decode little-endian fat headers ([bede3e3](https://github.com/morluto/rea/commit/bede3e3c60e53d445209096b360a81eaa0c446cc)), closes [#592](https://github.com/morluto/rea/issues/592)
* **native:** decode Mach protection bits in their proper positions ([#586](https://github.com/morluto/rea/issues/586)) ([6aba6ae](https://github.com/morluto/rea/commit/6aba6ae2316fe6299c855a3db52b221fff63c00c))
* **native:** inspect Apple dispatch metadata in FAT64 binaries ([#590](https://github.com/morluto/rea/issues/590)) ([f3e6582](https://github.com/morluto/rea/commit/f3e6582e9ed327c5accb8f9068ea0eb9bac49b1f))
* **native:** inspect the selected universal Mach-O architecture ([#601](https://github.com/morluto/rea/issues/601)) ([2b7bb3b](https://github.com/morluto/rea/commit/2b7bb3bb6a87704c18469768bc82d87e97b5c99c))
* **native:** match compound otool keys exactly and badge unknown thread entrypoints ([#534](https://github.com/morluto/rea/issues/534)) ([d40502a](https://github.com/morluto/rea/commit/d40502aa3b9a8c87fde49e5887547066128f19ba))
* **native:** normalize otool line endings and strip plist JSON BOM ([#533](https://github.com/morluto/rea/issues/533)) ([3e4d4d9](https://github.com/morluto/rea/commit/3e4d4d93fdc3eb5fdffda3a8dc8bec43201cdd98))
* **native:** preserve text-valued load command metadata ([#520](https://github.com/morluto/rea/issues/520)) ([bcfb407](https://github.com/morluto/rea/commit/bcfb4072f2ff665e93477206e14ce4b0581f97b9))
* **native:** reject signal-terminated command captures ([#608](https://github.com/morluto/rea/issues/608)) ([b81d18e](https://github.com/morluto/rea/commit/b81d18eeee9d93dafcb15e3d723de951509c2612))
* **native:** reject trailing text in lipo integers and keep multi-word otool keys ([#531](https://github.com/morluto/rea/issues/531)) ([9e30d93](https://github.com/morluto/rea/commit/9e30d93af3d2c0cc1a7536a10e3141f9f2fb499c))
* **native:** retain lazy dylibs, normalize version-min builds, limit thread entrypoints ([#532](https://github.com/morluto/rea/issues/532)) ([0f77ada](https://github.com/morluto/rea/commit/0f77ada55e6d1d01cb925993d871bf4a94f94bb2))
* **native:** retain re-exported Mach-O library dependencies ([#516](https://github.com/morluto/rea/issues/516)) ([4a5673e](https://github.com/morluto/rea/commit/4a5673e1dc6f2213cf94121384cff405e390677a))
* **package:** separate agent and Hopper setup support ([#584](https://github.com/morluto/rea/issues/584)) ([205a977](https://github.com/morluto/rea/commit/205a9777776476b4f361e38f25d1c75baaccd420))
* **platform:** accept absolute paths for any host and stop blaming the ceiling for a missing grant ([#552](https://github.com/morluto/rea/issues/552)) ([e793e12](https://github.com/morluto/rea/commit/e793e124a27b8087057f58f39028144ea6f6e173))
* **process:** align provider detach with configured platform ([3fff74f](https://github.com/morluto/rea/commit/3fff74fb5bb9725be2456e8c39bc0b98181d0687))
* repair boundary contracts across CLI and MCP ([#597](https://github.com/morluto/rea/issues/597)) ([9c25dc4](https://github.com/morluto/rea/commit/9c25dc4ed2915a81fc83a1d4dc22e7ba814b8dff))
* **replay:** keep __proto__ own properties and reject symbol-keyed results ([#540](https://github.com/morluto/rea/issues/540)) ([05bb630](https://github.com/morluto/rea/commit/05bb630a00aa521229cde53ded9a5345b8bd1a2b))
* **replay:** link the complete ESM graph before evaluating ([#515](https://github.com/morluto/rea/issues/515)) ([4200a42](https://github.com/morluto/rea/commit/4200a425d50eab80847edf3baa9ea4c5244e8be8))
* **replay:** preserve CommonJS object as ESM default export ([#519](https://github.com/morluto/rea/issues/519)) ([2df6b51](https://github.com/morluto/rea/commit/2df6b51ebb87e8d406d6201d8f3158aefefa7cc5))
* **replay:** preserve Date call and explicit constructor semantics ([#512](https://github.com/morluto/rea/issues/512)) ([9975bd2](https://github.com/morluto/rea/commit/9975bd23cdba7e196ca97c3fcec41a6eee925e57))
* **replay:** preserve sparse array positions in result projection ([#522](https://github.com/morluto/rea/issues/522)) ([9d1c363](https://github.com/morluto/rea/commit/9d1c3631b8deccb5fb91906130f38e3f24aa254e))
* **replay:** share one seeded generator and present builtins with real identity ([#539](https://github.com/morluto/rea/issues/539)) ([5b51fa0](https://github.com/morluto/rea/commit/5b51fa01e2391cd4b6d5e9ba7b6aa7615de891b1))
* **repo:** keep dependency links out of version control ([#617](https://github.com/morluto/rea/issues/617)) ([b3223e3](https://github.com/morluto/rea/commit/b3223e3f61a23b79152939ef755aca95e7640f09))
* **skill:** remove obsolete grants and audit tool effects ([2919def](https://github.com/morluto/rea/commit/2919def828b3c8fc7947989f1de3f4f4ac4cdd36))
* **test:** improve capture reliability and runner cleanup ([#609](https://github.com/morluto/rea/issues/609)) ([d19686a](https://github.com/morluto/rea/commit/d19686a2a5122c691f7885997906ecb31dd9827d))
* **tools:** simplify direct invocation and harden boundary contracts ([#555](https://github.com/morluto/rea/issues/555)) ([b5e9891](https://github.com/morluto/rea/commit/b5e98915c60968213141f33839e0c5c4b34df4db))
* **web:** retain uncertainty for incomplete capture inventories ([#513](https://github.com/morluto/rea/issues/513)) ([d8c18f6](https://github.com/morluto/rea/commit/d8c18f604f292c95b6b0b185d23517cb6881c5fb))
* **win32:** probe .cmd/.bat runtime shims via cmd.exe to avoid spawn EINVAL ([#505](https://github.com/morluto/rea/issues/505)) ([31ed005](https://github.com/morluto/rea/commit/31ed005183c315f1bc72f6e10730a47be73d7f1c))
* **workflows:** preserve punctuation in filesystem source paths ([#521](https://github.com/morluto/rea/issues/521)) ([5b28a8b](https://github.com/morluto/rea/commit/5b28a8b331259e026678e681210e9c3c4f48f2fa))
* **workflows:** retain container presence in export shape comparisons ([#523](https://github.com/morluto/rea/issues/523)) ([3854458](https://github.com/morluto/rea/commit/385445804ab45605a47edcb996ebbc026e2f0a43))


### Code Refactoring

* **config:** take the environment as an input at every configuration read ([#554](https://github.com/morluto/rea/issues/554)) ([53fe7d6](https://github.com/morluto/rea/commit/53fe7d6d3b3630472124563ccafdad3f4964b4bc))
* **domain:** consolidate duplicated semantic member and literal helpers ([#550](https://github.com/morluto/rea/issues/550)) ([09830da](https://github.com/morluto/rea/commit/09830dad053f2b1440e0b1cde63747606684be4b))
* **domain:** own digest and prefixed identifier shapes in one module ([#547](https://github.com/morluto/rea/issues/547)) ([ea58834](https://github.com/morluto/rea/commit/ea5883494036ddb30d138fdb381d54b2d9808b49))
* **host:** inject platform and environment instead of reading them ambiently ([#549](https://github.com/morluto/rea/issues/549)) ([5b59b87](https://github.com/morluto/rea/commit/5b59b87726b459cf9887dd4edc176981ef4e6afc))
* simplify runtime tools and remove replay engines ([#572](https://github.com/morluto/rea/issues/572)) ([e07b816](https://github.com/morluto/rea/commit/e07b81649e96668e5ce166cfc6db3b59a7777697))


### Documentation

* add boundary contract guidance ([42e6a8a](https://github.com/morluto/rea/commit/42e6a8a6f6da4c3aebb10235a27d471dc2590954))
* add Discord community links to README ([79bf26f](https://github.com/morluto/rea/commit/79bf26f33f980c20367986080a16d4a9f7952048))
* align roadmap with direct tool use ([eba709e](https://github.com/morluto/rea/commit/eba709e5c096796b0afe3ce9203659df9eaf0a7d))
* align translated READMEs and clarify support guides ([5b383b2](https://github.com/morluto/rea/commit/5b383b2ddd4195cb15e412b81853955b38419721))
* clarify README wording and analysis tool support ([97822f2](https://github.com/morluto/rea/commit/97822f233be49a8b582b4c2aa982af3854ca0bb2))
* move README image above Discord community ([ad86d39](https://github.com/morluto/rea/commit/ad86d39d2cb4f2d1ce0da08a17d5f7948c0797ec))
* place community invitation below README navigation ([69a45e0](https://github.com/morluto/rea/commit/69a45e0bbc03d87624de866a821b976e4aaca069))
* place Discord community below setup command ([778e464](https://github.com/morluto/rea/commit/778e464c206ba75a2f94edaad3c05e8bf63bed10))
* place setup command above README image ([c6d3bdf](https://github.com/morluto/rea/commit/c6d3bdf597d9cd75a6f7396236e1a47f5ee4288d))


### Tests

* **setup:** isolate client fixtures across host platforms ([f73bb0f](https://github.com/morluto/rea/commit/f73bb0fe116678543a73d13f58eaa3b48133afc5))

## [3.2.1](https://github.com/morluto/rea/compare/rea-agents-3.2.0...rea-agents-3.2.1) (2026-10-03)


### Bug Fixes

* **release:** tolerate npm registry propagation delay ([726b730](https://github.com/morluto/rea/commit/726b730b84830b208725df50fa0251ece1fa199f))


### Tests

* **release:** accept guarded npm publishing ([b7bc855](https://github.com/morluto/rea/commit/b7bc8554928c8eca9c29842c77e4021c1e42e054))

## [3.2.0](https://github.com/morluto/rea/compare/rea-agents-3.1.0...rea-agents-3.2.0) (2026-10-03)


### Features

* **native:** add investigation features ([#486](https://github.com/morluto/rea/issues/486)) ([ed933d1](https://github.com/morluto/rea/commit/ed933d18933814e3957a920972ccf91117d4ed87))


### Bug Fixes

* **artifacts:** stabilize extraction approval ([7eb1a95](https://github.com/morluto/rea/commit/7eb1a9500c62b66716878c18ee442c324a715a88))
* **browser:** reject unknown Electron input fields ([1860d4f](https://github.com/morluto/rea/commit/1860d4f0e531919ee9b10bec7ad8db43e18a291b))
* **ci:** retain artifacts for delayed reruns ([07888ec](https://github.com/morluto/rea/commit/07888ec096f69753a1535703fb7b3c3070e786b7))
* **cli:** remove ignored result limits ([f3645aa](https://github.com/morluto/rea/commit/f3645aa51e55c5207f7b9b1f0156ffaef7aaed42))
* consolidate boundary ownership and cleanup failure paths ([#477](https://github.com/morluto/rea/issues/477)) ([2160d4f](https://github.com/morluto/rea/commit/2160d4fae581243990e539a9c401d1b8824e1763))
* **contracts:** align byte read schema with provider ([f580d9d](https://github.com/morluto/rea/commit/f580d9d07382bc9642bce896d431c827955339e4))
* **ghidra:** return complete native analysis results ([a66e43a](https://github.com/morluto/rea/commit/a66e43a99dda1604c8250c9eb73aa8ef000371c9))
* **managed:** retain every source location ([33b2099](https://github.com/morluto/rea/commit/33b20991c455306d66f8687a9f80ea22073d4207))
* **process:** capture complete host probe output ([6c68ff5](https://github.com/morluto/rea/commit/6c68ff565fe1196fd8c7a63598e8bd94098abc3c))
* **runtime:** make observed target role optional ([593a8e1](https://github.com/morluto/rea/commit/593a8e12ceac1cfe350493cfe6b0d1360eb85f7c))
* **runtime:** retain complete reconciled graph content ([bedd55a](https://github.com/morluto/rea/commit/bedd55a4b4ccc9a0c1441d3836138b323de6d126))


### Code Refactoring

* **analysis:** remove caller-selected result caps ([a8c58c6](https://github.com/morluto/rea/commit/a8c58c6605ac37a8b504167732affc5ce4fc772f))
* **analysis:** remove fixed result quotas ([20152a9](https://github.com/morluto/rea/commit/20152a9872dd035714beb5ef5b8898a9b4d1d6c4))
* **artifacts:** consolidate inventory into inspection ([0fe96d9](https://github.com/morluto/rea/commit/0fe96d92dfefbaf28d2abfd5e237f6d0e82eee7b))
* **artifact:** simplify extraction and inventory results ([07ff8b3](https://github.com/morluto/rea/commit/07ff8b30ee497d9f4477a0a9ae97f3f5addbb45a))
* **artifacts:** remove duplicate inventory wrapper ([aa6eee1](https://github.com/morluto/rea/commit/aa6eee1a712d1a319bbaed5387aa5f4429755a1f))
* **artifacts:** remove selectors and traversal quotas ([8c24272](https://github.com/morluto/rea/commit/8c24272ee7e6d30b1493ee7ccd63e45734fe2f95))
* **artifacts:** select extraction by logical path ([7ba3580](https://github.com/morluto/rea/commit/7ba3580c860463adcd5edc73b7a80f34b92480cf))
* **browser:** remove arbitrary capture ceilings ([5dd3b46](https://github.com/morluto/rea/commit/5dd3b4655e21222a6598bf8cbc0be90f3cbf5e0f))
* **browser:** return complete observation evidence ([0e2738f](https://github.com/morluto/rea/commit/0e2738ffb6aa35bb06fe01d0af864aec968570cf))
* **browser:** return complete scenario observations ([e80fe41](https://github.com/morluto/rea/commit/e80fe414b13294446f959b382cb240c806cfe000))
* **browser:** share authorized main-frame polling ([eec75ce](https://github.com/morluto/rea/commit/eec75ce918cbac576fd217847911793331aa32a0))
* **browser:** share canonical identity digest ([a6d9e49](https://github.com/morluto/rea/commit/a6d9e49ab46150c8b757f5bdd5f80d3a8ff52f26))
* **contracts:** remove duplicate schema aliases ([4593c29](https://github.com/morluto/rea/commit/4593c29b64d3f6c43ddb19228da6231f1055eba4))
* **contracts:** simplify workflows and drop readiness tool ([7acac61](https://github.com/morluto/rea/commit/7acac615ca2b8e3f4edd65fd8a08b237f85b5ac7))
* **coverage:** evaluate inline without workspaces ([9e76054](https://github.com/morluto/rea/commit/9e7605482acf2de77ad04c5c5e03ac4280a11d7f))
* **domain:** encode comparison and lifecycle states exactly ([#473](https://github.com/morluto/rea/issues/473)) ([d65730c](https://github.com/morluto/rea/commit/d65730c4c24ab6183426516d4564e6c25294b35d))
* **domain:** share AST property name reader ([4f4cc59](https://github.com/morluto/rea/commit/4f4cc59873ec704811649aeca8a49e3bcdbdf324))
* **electron:** retain complete active observations ([e8c56e0](https://github.com/morluto/rea/commit/e8c56e0c0aeb114e09636ad1841d8fd73720b5cc))
* **errors:** remove stale workspace failures ([f570d40](https://github.com/morluto/rea/commit/f570d40f50bc8621b32ba4e255660ed1b1398356))
* **evidence:** remove obsolete ID resolvers ([a3920e2](https://github.com/morluto/rea/commit/a3920e2abd915eba31b59413710315a85caf1afa))
* **evidence:** remove session ledger quotas ([dca293a](https://github.com/morluto/rea/commit/dca293a446fa86767fb4bed6fe734f09b6cfafde))
* **files:** use caller paths for local evidence files ([c34efca](https://github.com/morluto/rea/commit/c34efca4cd322d4816ab4cd526a7475489edc814))
* **ghidra:** remove redundant schema markers ([c2a6f4b](https://github.com/morluto/rea/commit/c2a6f4bc437671c25ba318d21b82818c8e6bf2ce))
* **javascript:** remove analysis ceilings ([9aec690](https://github.com/morluto/rea/commit/9aec6908b5c7ad50da6882415700cbe53c3f62ed))
* **managed:** derive inspection from PE CLI extents ([dfad09e](https://github.com/morluto/rea/commit/dfad09e3b5769b079bf2d07382aee310d682724f))
* **mcp:** simplify evidence and workflows ([6740ed5](https://github.com/morluto/rea/commit/6740ed5215578eaaf33c785d6245649d76a0411c))
* **mcp:** simplify tool inputs and inline results ([f55c2b9](https://github.com/morluto/rea/commit/f55c2b92676e4a7eb06efbc8d9a908a7de62541a))
* **mcp:** simplify workflow and observation scope ([34d00fd](https://github.com/morluto/rea/commit/34d00fd323c793278c6ed126308c58e2fc7efd54))
* **observation:** internalize capture budgets ([7b3c797](https://github.com/morluto/rea/commit/7b3c7972377c7f77b1328e7d1de3f54835bc1397))
* **observation:** retain complete tool results ([fa2b6c5](https://github.com/morluto/rea/commit/fa2b6c5a61adcb75c4c2773ed1c9f7dba83fc1d3))
* **observation:** return complete inventories ([c523c38](https://github.com/morluto/rea/commit/c523c38027f536e8319eb2acc1840274c5bc5986))
* **permission:** remove unused authorization helpers ([1b0ab75](https://github.com/morluto/rea/commit/1b0ab75a84ccdcf036ccfc019d1890b2d626699a))
* **process:** remove fixed scenario ceilings ([abf7c11](https://github.com/morluto/rea/commit/abf7c1142e759a291d2267fedf15b0dd444a5684))
* **process:** remove redundant schema version markers ([b3aca52](https://github.com/morluto/rea/commit/b3aca5289bf973ffb4072253eebe86e0acced347))
* **process:** remove request count ceilings ([f2dc749](https://github.com/morluto/rea/commit/f2dc749c862a16d056de53e95914a9a411592583))
* **process:** remove unused paired experiment ([e1d755f](https://github.com/morluto/rea/commit/e1d755f7cd574860f59965a6244dbd43f5032f2c))
* **prompts:** make tool workflows optional ([3fd9650](https://github.com/morluto/rea/commit/3fd96506f223889a2d327cc7c97a95bf48ccb594))
* **reference:** share graph index projections ([6ee87fb](https://github.com/morluto/rea/commit/6ee87fbf2defcb10a17352b36ebeed67c6ce6dc5))
* remove cross-version investigation workflow ([81996df](https://github.com/morluto/rea/commit/81996df7a59ae6efb0f7be6687af89e66c64cdcb))
* **replay:** share sandbox probe arguments ([9fca6c0](https://github.com/morluto/rea/commit/9fca6c0296ac360f9d2c838440b24d2ea79234b5))
* **replay:** simplify runtime value checks ([60cb68a](https://github.com/morluto/rea/commit/60cb68a276b012964b08c18e9d60af22e64c468f))
* return complete analysis results inline ([a2a3243](https://github.com/morluto/rea/commit/a2a3243ea874ee1662c62a83ced63be218e0218e))
* return complete tool results inline ([0d96275](https://github.com/morluto/rea/commit/0d96275b6887b72519d2bc54f72012db6a8e482c))
* **runtime:** retain complete reconciliation outputs ([79ea571](https://github.com/morluto/rea/commit/79ea571512a1f55200eb5520d6c56104dba54e5b))
* **schema:** remove data-only version markers ([5457f4a](https://github.com/morluto/rea/commit/5457f4a2bceccb9c40e19a9986964025f279fc91))
* **server:** remove registration alias ([8097ec4](https://github.com/morluto/rea/commit/8097ec456a14992b578057438be8a6e89a076cdf))
* **server:** use canonical elicitation type ([bb6a58c](https://github.com/morluto/rea/commit/bb6a58c2a7eec15fb5f224376230398b51d1b952))
* **test:** colocate pure-domain tests and reduce test debt ([#471](https://github.com/morluto/rea/issues/471)) ([e91c8c3](https://github.com/morluto/rea/commit/e91c8c39c2acddc4389ed0d01950d1954c472e47))
* **test:** keep coverage at behavioral boundaries ([#474](https://github.com/morluto/rea/issues/474)) ([d4dc940](https://github.com/morluto/rea/commit/d4dc940bd871089ffa1b42d3475798b2f4f9c992))
* **tools:** remove arbitrary workflow ceilings ([5f73cb0](https://github.com/morluto/rea/commit/5f73cb061b6fec532d1cccf5a8bce59855823fa4))
* **tools:** remove artificial analysis ceilings ([2f08c7c](https://github.com/morluto/rea/commit/2f08c7c932d3619a481709935f07da59de3d3b27))
* **tools:** remove redundant limits and acknowledgements ([bd0e341](https://github.com/morluto/rea/commit/bd0e34157239613aed7aa9315df0e97d03d8636c))
* **tools:** remove remaining arbitrary workflow caps ([ecf3ed8](https://github.com/morluto/rea/commit/ecf3ed8bdb9ef7a83e7a2fb23443eced6c3824b0))
* **tools:** return complete analysis results inline ([2a6eb41](https://github.com/morluto/rea/commit/2a6eb41147e496b9e044011fa3b755ef74388c51))
* **workflows:** simplify evidence reference inputs ([24e1fa9](https://github.com/morluto/rea/commit/24e1fa9a76e447cff318da9f48c7adb659a1f8ab))


### Documentation

* add REA tool design guidance ([#485](https://github.com/morluto/rea/issues/485)) ([36aeec9](https://github.com/morluto/rea/commit/36aeec95863ca28d3e3aa5bec75a45d3824e17f5))
* clarify aggregate context tools ([c7e207c](https://github.com/morluto/rea/commit/c7e207c290e376db5c2f210f9ac08fe170ef3ec4))
* clarify MCP tool design guidance ([36aeec9](https://github.com/morluto/rea/commit/36aeec95863ca28d3e3aa5bec75a45d3824e17f5))
* correct inline evidence and Hopper behavior ([bf9cce1](https://github.com/morluto/rea/commit/bf9cce1aef89a769320d217e82b895b086880e69))
* describe complete application analysis outputs ([271b162](https://github.com/morluto/rea/commit/271b1620e68f3a6bbc69f28aa4c4d18d5c453baf))
* generalize reverse-engineering workflow ([#488](https://github.com/morluto/rea/issues/488)) ([4ecc7a7](https://github.com/morluto/rea/commit/4ecc7a72f2d6d78b8d9c59a146e532fe552c40bb))
* improve GitHub issue and pull request templates ([c490d85](https://github.com/morluto/rea/commit/c490d85045de07488e01747db9c9f77d264b2e36))
* prioritize reusable analysis primitives ([#493](https://github.com/morluto/rea/issues/493)) ([9dd72c4](https://github.com/morluto/rea/commit/9dd72c4911841671594570677f5ba6e3992d076d))
* refresh managed conformance manifest ([23e56c5](https://github.com/morluto/rea/commit/23e56c517c08abcafe3a81919215433458aef27e))
* refresh tool catalog and cleanup audit fixtures ([53db3a4](https://github.com/morluto/rea/commit/53db3a476b2881f498a5d6c87195e783268c1988))
* regenerate tool and evidence catalogs ([2f604a3](https://github.com/morluto/rea/commit/2f604a3c3ad037a68da4c33a30cb5316983b070f))
* regenerate tool and evidence catalogs ([f2bbd59](https://github.com/morluto/rea/commit/f2bbd5957eccac6164b3f12db87921ffb09bdcf2))
* **tools:** clarify complete inline results ([3b64c81](https://github.com/morluto/rea/commit/3b64c813cf8bcd0cdd262d0a3d5950819f320a12))
* **tools:** clarify complete inline workflows ([4168174](https://github.com/morluto/rea/commit/41681742ccea83a7956e7bc303da4aa223ed4877))
* **tools:** describe uncapped tool behavior accurately ([4cea84d](https://github.com/morluto/rea/commit/4cea84d7cbb0508e6c0dde36a2a0542855681f95))
* **tools:** update inline workflow guidance ([4ad937c](https://github.com/morluto/rea/commit/4ad937c6caeec89ded592ea82dec4fa13ea17d8c))


### Tests

* **artifacts:** exercise argument-free extraction preflight ([a6d5b3e](https://github.com/morluto/rea/commit/a6d5b3ea9d1f53afeda33ef53fe50f42feac2343))
* **browser:** assert strict inputs without legacy fields ([9ddf22e](https://github.com/morluto/rea/commit/9ddf22e1962803bf06d54b2e577a0c03a3f3ad48))
* **browser:** cover complete screenshot output ([3f547ea](https://github.com/morluto/rea/commit/3f547eafa4c6f27b8264025c754392161687908e))
* **browser:** remove stale input field assertion ([60c110d](https://github.com/morluto/rea/commit/60c110d97b1b22c010b8597965b3ad09f4f51480))
* **cli:** consolidate duplicate setup journey ([9bd7e2c](https://github.com/morluto/rea/commit/9bd7e2cb459d0354ee2c406555de9e427c549086))
* **cli:** remove duplicate browser discovery case ([dcb0362](https://github.com/morluto/rea/commit/dcb036292e975c81780dbf7a711fd1a565a13a10))
* **conformance:** remove fixture generator test option ([ea853ce](https://github.com/morluto/rea/commit/ea853cebde5641dc9c12ef59005de84197463467))
* **contracts:** remove duplicate tool inventories ([0ae3c08](https://github.com/morluto/rea/commit/0ae3c0837b387e53686bcd6e8aa03cb29f80458a))
* **hopper:** name regex search assertion accurately ([9240bd8](https://github.com/morluto/rea/commit/9240bd8d166ffee93a90fd55c5de4b58d8ff6ad4))
* **hopper:** remove dossier identity assertion ([b5c0b5b](https://github.com/morluto/rea/commit/b5c0b5b53e2d15dd6da9d4e8b1d3c3c21a16c409))
* **mcp:** align workflow assertions with current guidance ([f8bb113](https://github.com/morluto/rea/commit/f8bb113c22cf23916a8cd8a5d77734ccaf63fd08))
* **mcp:** consolidate catalog inventory checks ([3afcd64](https://github.com/morluto/rea/commit/3afcd641462bbd99ebdc3bf2fc8264e2c3344c09))
* **mcp:** validate defaults at tool boundary ([21241d2](https://github.com/morluto/rea/commit/21241d2323d323f405b3cff4692e01364b6ddbde))
* remove duplicate export schema acceptance ([b783e7f](https://github.com/morluto/rea/commit/b783e7febef8c22b41817a61a7f8293393ac6425))
* remove obsolete schema version assertions ([fe342fa](https://github.com/morluto/rea/commit/fe342faa832ec9b17a6fb1dd85b1cf269b33cf1b))
* remove stale limits and handoff expectations ([acf33d6](https://github.com/morluto/rea/commit/acf33d6df272873728aaa7527c5d43fa2a13132b))
* remove vacuous and duplicate assertions ([56e2bf7](https://github.com/morluto/rea/commit/56e2bf7696e6ccbc3e4b5baf9249c6d4152f4a43))
* remove Vitest config test exports ([d6e545c](https://github.com/morluto/rea/commit/d6e545cc4832ed47cc98d974aa8e4aa9453afb98))
* replace brittle workflow and readme checks ([b3529aa](https://github.com/morluto/rea/commit/b3529aa327026472798a5f0971dcb325d221ddc6))
* replace implementation lock-in with behavioural assertions ([#498](https://github.com/morluto/rea/issues/498)) ([7ee3f23](https://github.com/morluto/rea/commit/7ee3f236a9f753dfc90d84f95f20598e4e45fd0d))
* **replay:** remove duplicate schema coverage ([4ec2343](https://github.com/morluto/rea/commit/4ec2343d91925e583b15d5404af2eabaf6ffed0f))

## [3.1.0](https://github.com/morluto/rea/compare/rea-agents-3.0.0...rea-agents-3.1.0) (2026-08-09)


### Features

* **electron:** add autonomous Electron runtime analysis ([#464](https://github.com/morluto/rea/issues/464)) ([8f229ed](https://github.com/morluto/rea/commit/8f229ede70c0a4e224c1cf71d61487e17b779d6a))


### Bug Fixes

* **ci:** guard Release Please PR branch parsing ([84cc819](https://github.com/morluto/rea/commit/84cc819284b9ce7ee648850c85d5daf3a33e5a24))
* **ci:** guard release PR branch parsing ([6838b6b](https://github.com/morluto/rea/commit/6838b6bff9ab5c400432caefd8c8737b86c41f07))
* harden evidence lifecycle and MCP contracts ([5155924](https://github.com/morluto/rea/commit/51559245d2e1c2d7550cfe489716950fe6154bd0))
* harden structured configuration comparisons ([#467](https://github.com/morluto/rea/issues/467)) ([6901edc](https://github.com/morluto/rea/commit/6901edc05d56063bdbe8be96511b1b21863630b5))
* **npm:** preserve explicit setup versions ([#465](https://github.com/morluto/rea/issues/465)) ([1783bf6](https://github.com/morluto/rea/commit/1783bf6dfdd4ec11e824870ce5b1a2f5a321450e))


### Code Refactoring

* **mcp:** make analysis states unrepresentable ([#468](https://github.com/morluto/rea/issues/468)) ([b8a9da0](https://github.com/morluto/rea/commit/b8a9da0c0f9f0b2b022a350d2c7c671d1fa3f886))


### Documentation

* clarify agent reverse-engineering promise ([ed4a628](https://github.com/morluto/rea/commit/ed4a62871f7924948e3774ae6cf880514a560ff4))
* clarify the agent reverse-engineering promise ([#466](https://github.com/morluto/rea/issues/466)) ([ed4a628](https://github.com/morluto/rea/commit/ed4a62871f7924948e3774ae6cf880514a560ff4))
* **npm:** simplify current setup command ([#469](https://github.com/morluto/rea/issues/469)) ([8b62b1a](https://github.com/morluto/rea/commit/8b62b1a71586e9409e4dd645f3d4947ef61e59b1))

## [3.0.0](https://github.com/morluto/rea/compare/rea-agents-2.7.0...rea-agents-3.0.0) (2026-08-01)


### ⚠ BREAKING CHANGES

* export_evidence_bundle now requires a filesystem path and no longer returns an inline bundle.

### Features

* make evidence bundles canonical MCP resources ([1712e6d](https://github.com/morluto/rea/commit/1712e6d821965ce5edc3880fe4ebab2e3cc02fd4))


### Bug Fixes

* address MCP resource review feedback ([f3b3fb0](https://github.com/morluto/rea/commit/f3b3fb07ded3d1ad72c0a4f24ca3147ef9722c5d))
* align aggregate tools with session capabilities ([ede91ff](https://github.com/morluto/rea/commit/ede91ff1f04563001f695ec3869daeb3c826154a))
* **ci:** align Vitest project worker budgets ([f47ee1a](https://github.com/morluto/rea/commit/f47ee1abb4fc8dbd5da3fa13c5870d6580b28bfa))
* **ci:** allow documented public type aliases ([97f6a0f](https://github.com/morluto/rea/commit/97f6a0f3fd2ebf8fa884d7f7ba6e1c66ecfe80e0))
* **ci:** make coverage report merging composable ([788f405](https://github.com/morluto/rea/commit/788f4057aee65dfae441249d2c9789bb996912a7))
* **ci:** stabilize Vitest project routing and shards ([f07acde](https://github.com/morluto/rea/commit/f07acde513d4c74d027b66e143cf5072246b412b))
* **errors:** preserve actionable analysis diagnostics ([0f96bf3](https://github.com/morluto/rea/commit/0f96bf365c330a7eb121a173bfa140cc2b652764))
* **mcp:** clarify routing and advertise input examples ([969519c](https://github.com/morluto/rea/commit/969519c00f31b5bc0f23dcffe8867e091461fda6))
* **mcp:** clarify target routing and caller diagnostics ([3e1e8cd](https://github.com/morluto/rea/commit/3e1e8cd3f829e6d3ac8b3c63d979f9db84dec826))
* **test:** bound boundary worker pressure ([935721d](https://github.com/morluto/rea/commit/935721df10d25d23621dbc2be90d334644e0858c))
* **test:** honor boundary ownership and public aliases ([92a1c33](https://github.com/morluto/rea/commit/92a1c33625ff88d81581554687e7708dd3c91e2d))
* **test:** retain subprocess coverage and cleanup ([7f46bb1](https://github.com/morluto/rea/commit/7f46bb18241bf3815e5e01816277d0cafe8f923b))
* **test:** retain subprocess coverage and cleanup ([dae2b9c](https://github.com/morluto/rea/commit/dae2b9cc4e8753827702ada6e51f2ee01811cfed))
* **test:** stabilize boundary timing ([f0d8cda](https://github.com/morluto/rea/commit/f0d8cdafa86bafdc6ad5d8c2d23a97ef583b53d5))
* **verify:** follow dynamic Hopper tool availability ([281e41f](https://github.com/morluto/rea/commit/281e41f7660066addcc7a204128fb1f49bf7a674))


### Code Refactoring

* preserve provider-neutral runtime seams ([a8161f0](https://github.com/morluto/rea/commit/a8161f0e5540f3261a08015dfe56a4254980c064))


### Documentation

* document resource snapshot workflow ([2a45d8d](https://github.com/morluto/rea/commit/2a45d8de7d52d0a234672d03c7dae794859f8ced))
* refresh generated SDK metadata ([c824db1](https://github.com/morluto/rea/commit/c824db1ab7aed2886e9050c1b7fe2136b77e3698))
* refresh managed completion manifest ([59d4659](https://github.com/morluto/rea/commit/59d465971ea86f933e9037fa32ac2787d935d076))


### Tests

* **contracts:** cover validation branches ([8ccdb33](https://github.com/morluto/rea/commit/8ccdb33dd25922e039140bcd1e3cbf3d5acee837))
* derive MCP SDK identity expectations ([ab4193c](https://github.com/morluto/rea/commit/ab4193c1f48020ff6baa42cb75e033110ee72b36))
* **eval:** cover navigation and address tool routing ([ba098f2](https://github.com/morluto/rea/commit/ba098f24e59efbd567ae8438f65e31af0f0b8050))
* overhaul deterministic suite architecture ([48053d1](https://github.com/morluto/rea/commit/48053d1032324cce6e2fe782ecba43d1b91a1bba))
* overhaul deterministic suite architecture ([513d9b1](https://github.com/morluto/rea/commit/513d9b15558f9174a8e2c0ab00e31cbc05dbaba7))
* **package:** verify npx upgrade on published releases ([7b6f7be](https://github.com/morluto/rea/commit/7b6f7becd257170cebf80f4f9f9c385b0000f074))
* **package:** verify npx upgrade on published releases ([1f8ad7b](https://github.com/morluto/rea/commit/1f8ad7bc68f50d396715116467f19524da7e05e6))


### Continuous Integration

* document deterministic suite ownership ([3c42403](https://github.com/morluto/rea/commit/3c42403b78b53e7b5358c2bca9bc156ef2c32efd))

## [2.7.0](https://github.com/morluto/rea/compare/rea-agents-2.6.0...rea-agents-2.7.0) (2026-07-28)


### Features

* **bytecode:** add JVM and Python bytecode providers ([1a75f8d](https://github.com/morluto/rea/commit/1a75f8dc236d8269a5fa07e042471ac79e79d728))
* **bytecode:** add JVM and Python bytecode providers ([4e0127d](https://github.com/morluto/rea/commit/4e0127d620377e5dc7e09444f9db0977e3d47ed1)), closes [#367](https://github.com/morluto/rea/issues/367)
* **conformance:** add portable conformance export package format ([91fb87d](https://github.com/morluto/rea/commit/91fb87d17e7885439762667c96167af79a2e044e))
* **conformance:** add portable conformance export package format ([4ee30e4](https://github.com/morluto/rea/commit/4ee30e4145db9b496158cd980af05e22010856a7))
* **metadata:** add deeper ObjC/Swift metadata and database save/licensing ([4602efd](https://github.com/morluto/rea/commit/4602efd27cbf8701c2dc15542042bc9d9ef76e7f))
* **metadata:** add deeper ObjC/Swift metadata and database save/licensing ([d7a0753](https://github.com/morluto/rea/commit/d7a07535b0fb61ee8f9ae648bb673dda23290653)), closes [#353](https://github.com/morluto/rea/issues/353)
* **mobile:** add Android APK/AAB/DEX and iOS IPA static investigation providers ([18624df](https://github.com/morluto/rea/commit/18624df5724a2c4d14a4e8e178660456424b2344))
* **mobile:** add Android APK/AAB/DEX and iOS IPA static investigation providers ([fdeeb27](https://github.com/morluto/rea/commit/fdeeb27f23041c19b5857fe7873106f0cd9c6244)), closes [#366](https://github.com/morluto/rea/issues/366)
* **package:** add MSIX/MSI/AppX package, resource, and signature analysis ([0ef1b91](https://github.com/morluto/rea/commit/0ef1b91cf31f6ca53991ee5ca60b4a22f430c01e))
* **package:** add MSIX/MSI/AppX package, resource, and signature analysis ([6c03f83](https://github.com/morluto/rea/commit/6c03f83b1bd55095d136aeb3700733383365ecc4)), closes [#363](https://github.com/morluto/rea/issues/363)
* **pe:** add broader PE/COFF/PDB static inspection ([f942558](https://github.com/morluto/rea/commit/f9425585736a89165390178f245b0f0f5d6cdacf))
* **pe:** add broader PE/COFF/PDB static inspection ([94e6600](https://github.com/morluto/rea/commit/94e6600faf89436e4e2689fda8050792307b268d)), closes [#362](https://github.com/morluto/rea/issues/362)
* **process:** replace procfs sampling with event-backed process-tree capture ([a5e355a](https://github.com/morluto/rea/commit/a5e355a3d52b19e89535449cd923c35e56ccc60d))
* **process:** replace procfs sampling with event-backed process-tree capture ([d5d2e56](https://github.com/morluto/rea/commit/d5d2e56d0461cb0debba540bc658a9938ac30599)), closes [#332](https://github.com/morluto/rea/issues/332)
* **protocol:** add custom TCP/UDP/IPC/XPC and auth-flow capture ([1fb22b4](https://github.com/morluto/rea/commit/1fb22b4c21e3a5581f3928003cc32ddc1cc9530b))
* **protocol:** add custom TCP/UDP/IPC/XPC and auth-flow capture ([6fa6f9b](https://github.com/morluto/rea/commit/6fa6f9b6d9595a480a590766dadcfebb8e7111b5)), closes [#365](https://github.com/morluto/rea/issues/365)
* **protocol:** add gRPC/Protobuf and JSON-RPC/MessagePack capture ([54153ed](https://github.com/morluto/rea/commit/54153ed62cb4f55d1efd4794490c2481ab34e212))
* **protocol:** add gRPC/Protobuf and JSON-RPC/MessagePack capture ([3f336fe](https://github.com/morluto/rea/commit/3f336fefb132971bc6bb37b2b59aa01a5e3be5ca)), closes [#364](https://github.com/morluto/rea/issues/364)


### Bug Fixes

* **catalog:** digest provider projections ([645668b](https://github.com/morluto/rea/commit/645668b70dfdff74582d4ac26cda417947231764))
* **catalog:** digest provider projections ([c4cd033](https://github.com/morluto/rea/commit/c4cd0330e00eeb8e272abbf6ecc6ce961e72f317))

## [2.6.0](https://github.com/morluto/rea/compare/rea-agents-2.5.1...rea-agents-2.6.0) (2026-07-26)


### Features

* complete evidence-backed roadmap workflows ([1a0931b](https://github.com/morluto/rea/commit/1a0931b630587701d495d1634fbafe3638ad5516))
* **hopper:** report bridge progress diagnostics ([7a43420](https://github.com/morluto/rea/commit/7a434200297df85c62c02bb103cf870d14f202f7))
* **native:** inspect API boundaries with evidence ([521139d](https://github.com/morluto/rea/commit/521139d4a57a8ab2e25bb262d2a1fd09fd06be92))


### Bug Fixes

* **setup:** refresh stale local npx bootstrap ([6d37efe](https://github.com/morluto/rea/commit/6d37efe8fa1fb9b09c8eaa3a1ed6b6f63188ae22))
* **setup:** refresh stale local npx bootstrap ([90bb161](https://github.com/morluto/rea/commit/90bb1610f56448846adf85b31d9ae96be12dfb4a))


### Performance Improvements

* **mcp:** reduce cold-start work ([8ec9bb1](https://github.com/morluto/rea/commit/8ec9bb1bfea8bc57441bec72f3fcfbe93cf5d4f4))
* **mcp:** reduce cold-start work ([fecddc0](https://github.com/morluto/rea/commit/fecddc0549a31e99a5ea72cbda84e448b1a961d5))


### Tests

* add critical provider workflow coverage ([4716fa2](https://github.com/morluto/rea/commit/4716fa2ece954f5e53bdda9d1f33afad57d2e151))
* **hopper:** remove brittle diagnostic source assertion ([40bf55b](https://github.com/morluto/rea/commit/40bf55b74ca6b2c90b3243a29018cb75879ba081))
* **investigation:** prove multi-version fixture closure ([5184816](https://github.com/morluto/rea/commit/5184816199895ceff6a489810e12fba0c2c41eb7))
* **mcp:** stabilize lazy-loading verification ([7157ab0](https://github.com/morluto/rea/commit/7157ab0b70833cc8237271e8625ccb7965c318c3))
* **package:** prove artifact cleanup and identity ([9522adf](https://github.com/morluto/rea/commit/9522adf19ac915247e2c74b18d3ef5cab95befc5))

## [2.5.1](https://github.com/morluto/rea/compare/rea-agents-2.5.0...rea-agents-2.5.1) (2026-07-25)


### Bug Fixes

* **ci:** normalize generated release metadata ([d43a461](https://github.com/morluto/rea/commit/d43a461958c7bef56a61f75d7f7da73b43e7c387))
* **ci:** normalize release pull request metadata ([119954c](https://github.com/morluto/rea/commit/119954c701533491ccbc4de649592e059f3f5d39))


### Performance Improvements

* **browser:** lazy-load Playwright sessions ([305e729](https://github.com/morluto/rea/commit/305e72995bd52caee7ad8b42aae531b8924e7d0d))
* **dotnet:** reuse authenticated artifact snapshots ([c5e8871](https://github.com/morluto/rea/commit/c5e8871bda737c52d6b09303f9c95e225bf845f2))
* eliminate repeated work in analysis hot paths ([fbe442b](https://github.com/morluto/rea/commit/fbe442b1e2395b93d1bffa2c192ea5ac9a0fab34))
* **evidence:** validate ledger mutations incrementally ([809dfbf](https://github.com/morluto/rea/commit/809dfbfe4868478bf62be40e5f9db35d1b52f6be))
* **javascript:** reuse parsed source across analyses ([adc4852](https://github.com/morluto/rea/commit/adc4852f3aea5bd2847ce9efb53fe43ad030dde6))
* **server:** cache advertised JSON schemas ([6743644](https://github.com/morluto/rea/commit/674364443dc12b89fe6444fdfb364f1b53086f90))

## [2.5.0](https://github.com/morluto/rea/compare/rea-agents-2.4.0...rea-agents-2.5.0) (2026-07-24)


### Features

* add runtime reconstruction roadmap workflows ([1dbb157](https://github.com/morluto/rea/commit/1dbb15734f484db5f4945bd1d1805d8763bfef0e))
* **analysis:** add bounded memory and call tracing ([8e7709d](https://github.com/morluto/rea/commit/8e7709d35ae0ab49392418106b67c2eaa9ea82dc))
* **artifacts:** add provider-neutral inspection ([d997728](https://github.com/morluto/rea/commit/d9977286f95090b5db3afab78573fa29841f7e90))
* **browser:** capture controlled Playwright scenarios ([1ac3118](https://github.com/morluto/rea/commit/1ac3118aa29d846c266edd1e8cd504c4707cf4df))
* **browser:** compare scenario and storage evidence ([f27dd74](https://github.com/morluto/rea/commit/f27dd745b8e398bba544a97374eed9a45aa4b688))
* **javascript:** compare source with shipped bundles ([697be94](https://github.com/morluto/rea/commit/697be942e8780f3b94aaa6e9fd37432c0bb31b47))
* **javascript:** recover runtime semantic effects ([38c883b](https://github.com/morluto/rea/commit/38c883bbc8a8d059ef21cdd85272e6f31a9ee45c))
* **process:** support explicit stdin closure ([205bf15](https://github.com/morluto/rea/commit/205bf1529bf0679095f817ef2bc82c9e8166a669))
* **reconstruction:** add obligation ledgers ([9d48ca7](https://github.com/morluto/rea/commit/9d48ca788cacabb5bc329e9cc0467784359c5d6d))
* **reconstruction:** evaluate end-to-end readiness ([38ff741](https://github.com/morluto/rea/commit/38ff7418efc3299150f3a8a1eab65e8314ef7aa3))
* **runtime:** add passive V8 Inspector observation ([8271650](https://github.com/morluto/rea/commit/82716509451fff1d0b1f91d8e9479b9c7d94ec20))
* **server:** advertise available tools dynamically ([035e114](https://github.com/morluto/rea/commit/035e1144b0295434c6f3c7295d4b576ef72de396))


### Bug Fixes

* **analysis:** report call-edge truncation ([6039b92](https://github.com/morluto/rea/commit/6039b92be7af50e9f94095b4c6b375293ae38df4))
* **browser:** close scenario containment gaps ([1bd65f6](https://github.com/morluto/rea/commit/1bd65f68bc632345b74a62bffe4394c84415a7f2))
* **browser:** contain scenario pages and preserve inputs ([24b3dc4](https://github.com/morluto/rea/commit/24b3dc41dff1862405d6926aa618a60d06c737b1))
* **browser:** require storage fingerprint approval ([f0069cb](https://github.com/morluto/rea/commit/f0069cbee4551e7988cfc4865ccf03dda48dc0dd))
* **ci:** allow slower real browser startup ([095c75d](https://github.com/morluto/rea/commit/095c75df2349b9da5b8a2222eecd8fec67149f0c))
* **ci:** propagate readiness verifier failures ([9f9f9c3](https://github.com/morluto/rea/commit/9f9f9c39688f9201fbb5dfa2826e576873c2e3d8))
* **ci:** repair cross-platform package verification ([1c9e508](https://github.com/morluto/rea/commit/1c9e50814e3e3a7797c463e00e06afeb6afd0e20))
* **comparison:** preserve uncertainty and v1 inputs ([b9217dc](https://github.com/morluto/rea/commit/b9217dcd746a842f92c0ae0012b35fb8ab9fa310))
* **hopper:** add bounded analysis recovery ([e0bc7fd](https://github.com/morluto/rea/commit/e0bc7fd973b26448fb2192a2059ab1229bec0817))
* **javascript:** keep digestless bundle matches unknown ([5a76aaf](https://github.com/morluto/rea/commit/5a76aaffde3c728f8984e917ff53aa2a628f5941))
* **process:** expose launcher identity mismatch ([62ac73c](https://github.com/morluto/rea/commit/62ac73cdd79bee708d50b17a2dde8c23e0b66f1e))
* **process:** normalize macOS launcher identity ([9c3aec8](https://github.com/morluto/rea/commit/9c3aec81317cd6caf627f13ebb0c6dc0f6735516))
* **process:** tolerate exit during ownership revalidation ([a0f8b72](https://github.com/morluto/rea/commit/a0f8b72b7a4c90184390d5412690d3df20da047d))
* **reconstruction:** authenticate obligation proof boundaries ([7b1e3bd](https://github.com/morluto/rea/commit/7b1e3bda00e4f9737a8882983b8750345eb7e1e2))
* **reconstruction:** bind proof evidence to claims ([83b3368](https://github.com/morluto/rea/commit/83b3368d8debf95df29095ef53a4112ca666bcb2))
* **runtime:** preserve deterministic context identity ([9bd2ac5](https://github.com/morluto/rea/commit/9bd2ac590c00703826283ef11b35a0ba2149bfa1))
* **test:** use direct Node launcher on macOS ([13f3372](https://github.com/morluto/rea/commit/13f3372a8beaa165473bd7ecaccaa2997dcbf2ab))


### Performance Improvements

* **test:** speed up local and CI validation ([1546a8d](https://github.com/morluto/rea/commit/1546a8db029a56ed705e5246a6bf7020227234ce))
* **test:** speed up local and CI validation ([42fbbb2](https://github.com/morluto/rea/commit/42fbbb297b8f40bcfbbfa219a1de098f3d0780ad))


### Code Refactoring

* **application:** reuse graph evidence resolution ([4e8aa98](https://github.com/morluto/rea/commit/4e8aa98267bb837033bf0ced58afc52d24f42492))
* **browser:** centralize scenario metadata budgeting ([e79e367](https://github.com/morluto/rea/commit/e79e36785b51cf8c27a27516280a8f83a9ebd2cc))
* **browser:** clarify inspector capture identifiers ([ca035a7](https://github.com/morluto/rea/commit/ca035a75eb6b7d1a79a928cdde572b9cb1df0d54))
* **browser:** reuse CDP endpoint parsing ([00abf45](https://github.com/morluto/rea/commit/00abf45d2085464fd6090a44f786a53669111177))
* **javascript:** centralize source range comparison ([c9500d3](https://github.com/morluto/rea/commit/c9500d32f69e8076255d4206203a41e39bab8dcb))
* **javascript:** share semantic call-site lookup ([94a2c60](https://github.com/morluto/rea/commit/94a2c6013da122899f3d9aefbe5a0bf608033076))
* **reconstruction:** isolate ledger coverage ([4f62695](https://github.com/morluto/rea/commit/4f62695a5cfc9e627387b0a04c1cebe253debbc8))
* **server:** reuse availability policy type ([eeb4349](https://github.com/morluto/rea/commit/eeb4349f1f130b2bde9b0f89382d36a66553cbf1))


### Documentation

* document roadmap analysis workflows ([f29f683](https://github.com/morluto/rea/commit/f29f6834230fd0d3850c558c28af8a43746533c5))
* refresh generated roadmap metadata ([f904668](https://github.com/morluto/rea/commit/f904668fbcba9a7866c6cde21e9628cfa2afe7aa))


### Tests

* **browser:** use neutral scenario fixture identifiers ([fd25a7e](https://github.com/morluto/rea/commit/fd25a7e15aa2eba0bef01269e5061254b607bfdd))
* **package:** stabilize fake Hopper ownership ([0b70131](https://github.com/morluto/rea/commit/0b7013134c58085b72177f2954e55534be053ebe))


### Continuous Integration

* verify runtime observation and readiness ([9349ff5](https://github.com/morluto/rea/commit/9349ff5921fbd1bc7ac8b8d1d27bef0f36b76d92))

## [2.4.0](https://github.com/morluto/rea/compare/rea-agents-2.3.0...rea-agents-2.4.0) (2026-07-23)


### Features

* **artifacts:** support MSIX and AppX packages ([6e6cce1](https://github.com/morluto/rea/commit/6e6cce1bf3cbd9c48799bee9969c53d66c42162e))
* expand reactive capture and package analysis ([9da1794](https://github.com/morluto/rea/commit/9da179425e83df9f255597437320c1ab6ff5c5c2))
* **process:** add reactive capture scenarios ([69761e9](https://github.com/morluto/rea/commit/69761e95b63ec7617aa161f7a1b4e3c8847a6175))


### Bug Fixes

* **capabilities:** expose typed availability codes ([b906def](https://github.com/morluto/rea/commit/b906defbff28885a1d39f78da7c2b7170a7108c6))

## [2.3.0](https://github.com/morluto/rea/compare/rea-agents-2.2.0...rea-agents-2.3.0) (2026-07-23)


### Features

* complete REA remediation program ([d25e98c](https://github.com/morluto/rea/commit/d25e98c3f9f16e1758ee2a7b5ea44ed6d9534351))
* **evidence:** generate verifier completion ledgers ([c02d33f](https://github.com/morluto/rea/commit/c02d33f381b42028186dcf76e3fb1976a42488bf))
* **evidence:** generate verifier completion ledgers ([f5b3e22](https://github.com/morluto/rea/commit/f5b3e22e720011fa346ee17acaaa927e3379499f))
* **javascript:** add bounded semantic relation graph ([b3939ea](https://github.com/morluto/rea/commit/b3939ea9ffc79a6f0998af76b0f6c9f166d2963b))
* **javascript:** add bounded semantic tracing ([56c1a66](https://github.com/morluto/rea/commit/56c1a669d7edb295ecfce1d348ef7c043ee48390))
* **javascript:** add local semantic call flow ([a26a1c7](https://github.com/morluto/rea/commit/a26a1c73df019e060a5ca50208e71dad1eb55f1e))
* **javascript:** expose bounded semantic tracing ([508a9cc](https://github.com/morluto/rea/commit/508a9ccde9c4beef2fa4dbd39093a1030287e967))
* **process:** add bounded reactive scenario domain ([42f3b9c](https://github.com/morluto/rea/commit/42f3b9c2ec46f48fa680489259fce4841d3ddc0b))
* **process:** add bounded reactive scenario domain ([d34463c](https://github.com/morluto/rea/commit/d34463c27c9b5d71c9e2e3b33cdaef2eab5b99de))
* **process:** add direct replay machine runner ([3df9a07](https://github.com/morluto/rea/commit/3df9a074136faf9c279c9ea936de33f25b6dd447))
* **process:** compare declared concurrent traces ([d81745c](https://github.com/morluto/rea/commit/d81745cb95b1564b94bf260d4f737d03b4625849))
* **process:** coordinate reactive capture effects ([b874efd](https://github.com/morluto/rea/commit/b874efd96824e98ac2120b93368e30a921dcf872))
* **process:** coordinate reactive capture effects ([db9a831](https://github.com/morluto/rea/commit/db9a83190b841c8195da0b3036644831770ba369))
* **process:** record global capture event order ([8bcdb98](https://github.com/morluto/rea/commit/8bcdb986893becd151c4dbb825f69bb6ced8b52e))
* **process:** record provider and verifier run lineage ([02b01d4](https://github.com/morluto/rea/commit/02b01d4193a78a1180e5dd467a4e85838546fcde))
* **process:** record provider and verifier run lineage ([513fa29](https://github.com/morluto/rea/commit/513fa294a49cd5059d4039e1d267e003b0234fad))
* **process:** run finite-state replay during capture ([820af60](https://github.com/morluto/rea/commit/820af60c25cb342d74a06d733b8eac8be814ef6b))
* **process:** run finite-state replay during capture ([34c583a](https://github.com/morluto/rea/commit/34c583a170782b4b28d16a2ec33223922608008d))


### Bug Fixes

* **browser:** redact transitional target titles ([f6095cb](https://github.com/morluto/rea/commit/f6095cb6ba9db4e69e7bcd64643c59c8ac129a4c))
* **cli:** retain bundled skill and bias setup wizard toward apply ([5692b3f](https://github.com/morluto/rea/commit/5692b3f809a6868c7c1e4b6f17ca03ad84557427))
* **cli:** retain bundled skill and bias setup wizard toward apply ([fec5c3c](https://github.com/morluto/rea/commit/fec5c3ce7fc8899bf312a67da2c39e8615781748))
* **cli:** route JavaScript applications from analyze ([737940c](https://github.com/morluto/rea/commit/737940c90c7507a1b0ede3e839598c922ca7a81e))
* **cli:** route JavaScript applications from analyze ([74965d9](https://github.com/morluto/rea/commit/74965d9088cca6e048a62352567b95c63c6621d2))
* **javascript:** preserve candidate trace ambiguity ([8678b57](https://github.com/morluto/rea/commit/8678b57b5e03b0fb103803eb0a9e9ebda3124647))
* **knip:** ignore ps binary and in-file schema exports ([9960982](https://github.com/morluto/rea/commit/99609823ef496245c18c9630dc9ef82fc748ef1a))
* **mcp:** preserve investigation input policy ([5a908a0](https://github.com/morluto/rea/commit/5a908a03a673fe499421283a9309c52164d14a9d))
* **mcp:** preserve investigation input policy ([f4156d9](https://github.com/morluto/rea/commit/f4156d9663a1847d5b3bbe29f98036b9c76606b4))
* **process:** bound trace comparison semantics ([b4df565](https://github.com/morluto/rea/commit/b4df565b779c4f38ebf1c784dad73bf7f3de68eb))
* **process:** normalize resize frame timestamps ([74d1c7b](https://github.com/morluto/rea/commit/74d1c7b2748a88341b98bd463be3ad227501c4f4))
* **process:** normalize resize frame timestamps ([77696df](https://github.com/morluto/rea/commit/77696dff9144fd6c110247711bbff144ec63b19b))
* **process:** preserve nonconforming differences ([f1cc485](https://github.com/morluto/rea/commit/f1cc48558122a922365a1b71dbf4fb196b037825))
* **process:** preserve replay event causality ([d895e49](https://github.com/morluto/rea/commit/d895e49145222eb02eb34cd7de93c5212884f5cc))
* **process:** protect unrelated Hopper during cleanup ([81539c4](https://github.com/morluto/rea/commit/81539c47fb5dbebec83e83526685b0f6b85095aa))
* **process:** protect unrelated Hopper during cleanup ([e4ee4c9](https://github.com/morluto/rea/commit/e4ee4c963547f026defe3f5e5e2978c1ab2e6f21))


### Code Refactoring

* **process:** extract capture journal recorder ([a32b988](https://github.com/morluto/rea/commit/a32b988a35a31d0fbabaa861eddb6e3bbb363943))
* **process:** split trace comparison domain logic ([75d5a87](https://github.com/morluto/rea/commit/75d5a8705498bf567a9860eef9eecdf4521c9cc6))
* **process:** split trace comparison helpers ([6d8ecd2](https://github.com/morluto/rea/commit/6d8ecd2b88ddd4868ee55bef84bf88a542d4616b))


### Documentation

* **cli:** clarify setup consent comment ([e869137](https://github.com/morluto/rea/commit/e8691378a07b083277e3b963c5f6d179e12d7626))
* refresh Node 24 TypeDoc output ([846193c](https://github.com/morluto/rea/commit/846193c60305242b27f39c69715f332627ba1725))


### Tests

* **browser:** stabilize real shape capture ([bb2e243](https://github.com/morluto/rea/commit/bb2e2432a5ff4634b4f54eff7834b6da826f725f))


### Continuous Integration

* remove redundant typecheck, lint, and format compatibility jobs ([eb27f01](https://github.com/morluto/rea/commit/eb27f01aeef0f531eebeb0342eba6cc507dfa6f4))
* remove redundant typecheck, lint, and format compatibility jobs ([aeb5cb3](https://github.com/morluto/rea/commit/aeb5cb3adb0e43c45017cf61d2a95bac200024ae))
* shard coverage tests and skip docs-only suites ([c736317](https://github.com/morluto/rea/commit/c7363178e7c8c1f8db1e69085bcd0826293e3814))
* shard coverage tests and skip docs-only suites ([fa58082](https://github.com/morluto/rea/commit/fa58082bf0268b9f9f6c7aac2d6871576e7d5fae))

## [2.2.0](https://github.com/morluto/rea/compare/rea-agents-2.1.0...rea-agents-2.2.0) (2026-07-20)


### Features

* **artifacts:** project mobile application inventories ([c6a1a93](https://github.com/morluto/rea/commit/c6a1a93a9aff1efa06a39aae9911f6c704c350f5))
* **artifacts:** project mobile application inventories ([d36b385](https://github.com/morluto/rea/commit/d36b38537821dd2d74d99a9e49eccd569cfaf341))
* **process:** add bounded replay state machines ([fea965b](https://github.com/morluto/rea/commit/fea965b1b82a858fe423df2ef8fb004524f1934e))
* **process:** add bounded replay state machines ([dc0c2e5](https://github.com/morluto/rea/commit/dc0c2e5ac31387138ec47b027bac6a4cbf007ba0))
* **process:** compare repeatable paired experiments ([e9899c0](https://github.com/morluto/rea/commit/e9899c003b72c2799c67d74bd9553c9a03d083dd))
* **process:** compare repeatable paired experiments ([9ab7aa3](https://github.com/morluto/rea/commit/9ab7aa320c2f234e86d16ff8535b11768a0e080e))
* streamline agent integration and MCP routing ([02cb20b](https://github.com/morluto/rea/commit/02cb20b54682bc334077d8e247841e179a26abd7))
* streamline agent integration and MCP routing ([3e3d458](https://github.com/morluto/rea/commit/3e3d45856ede849371027b62ad1a7b0687798951))


### Bug Fixes

* align session filters and Hopper verification ([d7d6bdf](https://github.com/morluto/rea/commit/d7d6bdf474a1672a9b33888044a38672d28ab0ee))
* **artifacts:** align projection provider targets ([560dbda](https://github.com/morluto/rea/commit/560dbda76d9a07ea9291c00bec8a383456ad0e03))
* **artifacts:** bound mobile projection candidates ([0cc9d46](https://github.com/morluto/rea/commit/0cc9d468c4d6f3036b5888d12173157b487371c3))
* **ci:** keep tool kind type internal ([b9bead2](https://github.com/morluto/rea/commit/b9bead2809eca4448ac28f3e2465f8021a109983))
* **ci:** retry published package verification ([0810486](https://github.com/morluto/rea/commit/0810486f636a99b492f26758f6cd0fa65935f5aa))
* **ci:** retry published package verification ([c379455](https://github.com/morluto/rea/commit/c379455da7b32069c861addfbf8d19bb432ddb84))


### Documentation

* refresh generated API links ([a2089a4](https://github.com/morluto/rea/commit/a2089a40671b3edae7db98ce37587da87f093d1b))
* update application projection API ([b0cb28a](https://github.com/morluto/rea/commit/b0cb28a9bf04f849e792346306bb42ed4fac6b29))
* update paired process experiment API ([a222327](https://github.com/morluto/rea/commit/a222327f304555104b51370d0955dc6c8ca4d0ce))
* update replay machine API ([d74f897](https://github.com/morluto/rea/commit/d74f89754fe4e5c19a757893a3fe388f2c64372f))


### Tests

* budget CLI output variant subprocesses ([8d3587b](https://github.com/morluto/rea/commit/8d3587bbcac18e90652cc95e5853158a4f9aef18))
* cap workers across all hosts ([bc80359](https://github.com/morluto/rea/commit/bc8035918b1d6a3eac7fc2307867d4dc2787d3b5))
* inherit root options in Vitest projects ([168100e](https://github.com/morluto/rea/commit/168100e5326958fc89431a26a1f3cca762516133))
* isolate slow filesystem and CLI suites ([c2e134b](https://github.com/morluto/rea/commit/c2e134b8e46d780b61faab1021772704380e6a37))
* stabilize subprocess-heavy integration suites ([a556e94](https://github.com/morluto/rea/commit/a556e945096fd9430fc48217a2f4b6dc3d06518c))

## [2.1.0](https://github.com/morluto/rea/compare/rea-agents-2.0.0...rea-agents-2.1.0) (2026-07-18)


### Features

* add managed characterization and coverage closure ([1943496](https://github.com/morluto/rea/commit/194349683a19ee8b35c1bd9b124d032e83e6867a))
* add managed characterization and reconstruction coverage ([02c913b](https://github.com/morluto/rea/commit/02c913bcdab5904e1b6ce8a24940b75ddc20c826))
* **cli:** add explicit package-runner setup wizard ([891a11f](https://github.com/morluto/rea/commit/891a11f315d02628bbf04f290d211e48d1916a1d))
* **cli:** improve setup onboarding ([4851449](https://github.com/morluto/rea/commit/4851449f715af122d02e5517b4f6b925962f2a01))
* **cli:** improve setup onboarding ([16002ff](https://github.com/morluto/rea/commit/16002ff3c216ecd91e9c28bab8de288f3b553e57))
* **cli:** support package-name setup wizard ([1b90e7f](https://github.com/morluto/rea/commit/1b90e7f992276e4e05644823583f77c27ccac702))
* **doctor:** admit the Windows x64 Ghidra boundary ([32dda0c](https://github.com/morluto/rea/commit/32dda0c19eee5ddf91a35d9e21374f9cb111b07d))
* **dotnet:** add BYO ILSpy oracle diagnostics ([aa200ce](https://github.com/morluto/rea/commit/aa200ce8ca5690113a39259e91ab1ae9edc0b436))
* **ghidra:** add authenticated Windows loopback transport ([629ffc3](https://github.com/morluto/rea/commit/629ffc3872cdf2f3dabbe053890ac6a4103fdd1c))
* **ghidra:** bind imports to admitted target bytes ([be19c3f](https://github.com/morluto/rea/commit/be19c3fd12da55df84d92c5ec2641fe739df0438))
* **ghidra:** define the Windows P0 admission boundary ([6b1fd16](https://github.com/morluto/rea/commit/6b1fd166b0a6d37af9d42c38c5fd587fe3989659))
* **ghidra:** inspect Windows headless installations ([86e44be](https://github.com/morluto/rea/commit/86e44bef08d36cc1b56e44b7b544d5d6d21d141d))
* **ghidra:** launch bounded Windows headless sessions ([bc0fb45](https://github.com/morluto/rea/commit/bc0fb45f16db97d3f79860d850c9f2fe0f6b7b22))
* harden authority and runtime conformance boundaries ([b537ebf](https://github.com/morluto/rea/commit/b537ebfa3460f782c2aee4996ced2e726f7d6328))
* **javascript:** add binding and constant-value semantic IR ([3ea8523](https://github.com/morluto/rea/commit/3ea852323aa9a0509691105d47f5e5622c24050b))
* **javascript:** add binding and constant-value semantic IR ([3d71bb5](https://github.com/morluto/rea/commit/3d71bb551e3353df23afa5832883e5074fe0f2d0))
* **javascript:** add webpack and rspack runtime adapters ([7bccb7c](https://github.com/morluto/rea/commit/7bccb7c6ae2f48a37e053cfd871309971e81bbc4))
* **javascript:** add webpack and rspack runtime adapters ([44c7017](https://github.com/morluto/rea/commit/44c70176b845e2900244151aaadb7a4dc3f8b302))
* **javascript:** recover commonjs and esm module relationships ([9766fc0](https://github.com/morluto/rea/commit/9766fc04c13a366fa449f60cccabb1c97d68e84d))
* **javascript:** recover commonjs and esm module relationships ([6c41791](https://github.com/morluto/rea/commit/6c41791519069811d0be0115c450801432f96660))
* **permissions:** add scoped process capture elicitation ([e6cfce3](https://github.com/morluto/rea/commit/e6cfce3902a8f0c403caa07e2c597e8156aa5498))
* **skill:** rename skill to reverse-engineer-anything ([9356634](https://github.com/morluto/rea/commit/9356634ccba8d913a376798dae47bb3c4a86c07a))
* **target:** classify Windows PE admission metadata ([24274fe](https://github.com/morluto/rea/commit/24274fe6b694c5bf08ae21fd7f4afa1846f67ef2))
* **windows:** define native authority boundary ([a1a6b42](https://github.com/morluto/rea/commit/a1a6b4200ed638b1ea4d186ae1253805032d002a))


### Bug Fixes

* **build:** preserve native generated-file line endings ([00a3078](https://github.com/morluto/rea/commit/00a3078148e90a2d45648891f96158378c2561ce))
* **ci:** remove retired native rebuild steps ([2d22731](https://github.com/morluto/rea/commit/2d22731ebb3f81483ec8a561ed8b1cb313b4eac1))
* **ci:** validate packaged Windows CLI commands exactly ([43418ee](https://github.com/morluto/rea/commit/43418ee9112358d81d56d78b5cbe1ca37f6099be))
* **cli:** require explicit setup selections ([992ec50](https://github.com/morluto/rea/commit/992ec505b279114dcb13230fcd008db8668578af))
* **contracts:** make agent-facing schemas self-describing ([0df11dd](https://github.com/morluto/rea/commit/0df11dd4d1de4cb1c4fab6562d874e3be285aeec))
* **dotnet:** admit real CLI GUID and fat CIL bodies ([735973b](https://github.com/morluto/rea/commit/735973b08b364d45a8e2a551e17ad96c31b039c9))
* **dotnet:** correct CLI pointer and byref signatures ([1387be0](https://github.com/morluto/rea/commit/1387be08dd398ca8ef92410307fe35faa8936ed5))
* **dotnet:** correct CLI pointer and byref signatures ([fb9ff56](https://github.com/morluto/rea/commit/fb9ff5659dffb6af5185c9465ddac6e86eca7dd2))
* **dotnet:** downgrade truncated CIL identity and coverage ([736a4e1](https://github.com/morluto/rea/commit/736a4e1480fb34df12b00372c697acc327b0046c))
* **dotnet:** downgrade truncated CIL identity and coverage ([dae6807](https://github.com/morluto/rea/commit/dae6807c4a4aad7a20c4b9da085e39dcfb58430a))
* **electron:** keep missing unpacked ASAR entries unavailable ([fb6964a](https://github.com/morluto/rea/commit/fb6964a74ea60751560a6d10366bfdad3dab4535))
* **electron:** resolve package and dirname entrypoints by context ([4847fc4](https://github.com/morluto/rea/commit/4847fc4fc14114cbb15350a23f6db4a2ad7962fe))
* **electron:** resolve package and dirname entrypoints by context ([1ac9a09](https://github.com/morluto/rea/commit/1ac9a09ce1574b202d98177392628ba468a568df))
* **ghidra:** preserve native endpoint diagnostics ([5970a71](https://github.com/morluto/rea/commit/5970a7182481656e30a8ad51e4855d4c8e50eed7))
* **ghidra:** preserve Windows batch invocation semantics ([0ac418d](https://github.com/morluto/rea/commit/0ac418dd8be62357f852767a64f0d5b5c78495cc))
* **ghidra:** validate Windows control characters explicitly ([4dccbec](https://github.com/morluto/rea/commit/4dccbecf064b56b0d33c7d8c926772353667c739))
* **managed:** emit valid x64 conformance PE ([dcd94f1](https://github.com/morluto/rea/commit/dcd94f1472cbdfd5fff90eb26bbac68f5fb2b06b))
* **managed:** emit valid x64 conformance PE ([c52a822](https://github.com/morluto/rea/commit/c52a8223c62ab85373eb86a68dbdc626648aa40f))
* **managed:** preserve page incompleteness in graph and comparison ([a6f02a0](https://github.com/morluto/rea/commit/a6f02a05a48254e46a6485cedfadda426ab60e21))
* **managed:** preserve page incompleteness in graph and comparison ([8ee0f04](https://github.com/morluto/rea/commit/8ee0f04562814e44f77fd8a0f19184c127bcf92e))
* **mcp:** clarify advertised schema fields ([1581e40](https://github.com/morluto/rea/commit/1581e40fce733c19e11b460b47722e4121e9fd0e))
* **npm:** use latest entry points without install scripts ([34252f5](https://github.com/morluto/rea/commit/34252f55e963fcd63c0fd127dc249ba2c8398082))
* **npm:** use latest entry points, remove install scripts, and rename skill ([bf85ee6](https://github.com/morluto/rea/commit/bf85ee62c976dd06fdc47429a9b3c7f3d99b7f3b))
* preserve optional unknown filters ([db1efef](https://github.com/morluto/rea/commit/db1efef9d285d1726f56c288593161434b9f322f))
* remove unused boundary exports ([49f1ec1](https://github.com/morluto/rea/commit/49f1ec14fe4f5b67345ff9dde8af8ef1066fb3c8))
* satisfy dead-code and generated-doc checks ([b15a9ec](https://github.com/morluto/rea/commit/b15a9ecfef55dec00b92babf92883f6dedaa2209))
* **setup:** preserve onboarding after refactor ([da48033](https://github.com/morluto/rea/commit/da48033c191f491f47b9933f65806f0f0a223643))
* **skill:** disclose retired skill cleanup ([4c69e61](https://github.com/morluto/rea/commit/4c69e6120a2c0a630272e845cda2112724c4be7b))


### Code Refactoring

* **adapters:** split oversized provider workflows ([1a99a60](https://github.com/morluto/rea/commit/1a99a60a29c231c7a104c5900c2c20a7d10268d5))
* **app:** split session and CLI workflows ([c6ee004](https://github.com/morluto/rea/commit/c6ee0049c4bffe2880ddb8cf5a2a6c4195ae18f6))
* **domain:** split analysis boundaries ([e2c868c](https://github.com/morluto/rea/commit/e2c868c4bdd4f83f1e33a50bca0e3d91d4605387))
* finish lint cleanup ([2bea405](https://github.com/morluto/rea/commit/2bea40571d47f8b3454cdb9b467839521d3174b4))
* **managed:** split metadata analysis ([20c88dd](https://github.com/morluto/rea/commit/20c88dd5676a3081e13bef26cfa38d8a69856842))
* **setup:** keep planner helpers private ([2d1f961](https://github.com/morluto/rea/commit/2d1f9616b76b9e383d0196b820a377573def836d))
* simplify authorization boundaries ([2e5b443](https://github.com/morluto/rea/commit/2e5b44365fd1ea3c515efd03b56fee0083a20a31))
* simplify doctor and error projections ([37f4ac6](https://github.com/morluto/rea/commit/37f4ac6d7073693fb4d2290b5aff6bcb6b36cd19))
* **skill:** keep only the canonical skill identity ([a7c1e87](https://github.com/morluto/rea/commit/a7c1e87365cec0333bc9431ec5d7418cb7a54be1))
* **skill:** remove legacy skill compatibility ([8cf0dd2](https://github.com/morluto/rea/commit/8cf0dd2bf645d18afe6a9c8493178bdd905c0647))
* split oversized analysis workflows ([af2399e](https://github.com/morluto/rea/commit/af2399eeacbca5f1af344c7d7ef747f3d976bcf7))
* split oversized analysis workflows ([3e61a63](https://github.com/morluto/rea/commit/3e61a63a104859e1c8ca3bcdc6bad0511d1f1735))
* **windows:** keep capability outcomes module-private ([585f523](https://github.com/morluto/rea/commit/585f52389107c79cea99ecd26ea87cbcda08d245))


### Documentation

* **cli:** describe every command input ([d4be3e7](https://github.com/morluto/rea/commit/d4be3e7f9a609050303c82aa83d4884bb6daae77))
* **ghidra:** define the experimental Windows P0 ([8b5ae41](https://github.com/morluto/rea/commit/8b5ae417f3a69e679ad69574f13d1d179ebb22c3))
* **managed:** align normalized CIL claims with shipped v1 semantics ([9a92a79](https://github.com/morluto/rea/commit/9a92a7958cceedafe184b48ca93ab094386401a7))
* **managed:** align normalized CIL claims with shipped v1 semantics ([3f788e9](https://github.com/morluto/rea/commit/3f788e9065d5ce457ba174c13bc8e4e0b74d5156))
* normalize inherited source paths ([d33213a](https://github.com/morluto/rea/commit/d33213a99c824b5834323c924dac6b7852df5831))
* preserve generated source links ([2ea375f](https://github.com/morluto/rea/commit/2ea375f8ea413aba05baab0d9af3e3401d8b2956))
* prioritize agent usability in tool design ([ad17fe7](https://github.com/morluto/rea/commit/ad17fe7aa71f5cbffcdff3e27b08bc4538e73c7d))
* refresh Electron path resolution API ([734a4ef](https://github.com/morluto/rea/commit/734a4ef04fce7bbff76b3fbf9c3f1250d7ab8963))
* refresh generated API reference ([f5f653b](https://github.com/morluto/rea/commit/f5f653bd8dba8d441efe13f2404b8677dc6dd8f3))
* regenerate managed coverage API with Node 24 ([e47c00e](https://github.com/morluto/rea/commit/e47c00ef04b537bd67caff69d27f48a81bdf04e3))


### Tests

* add limit monotonicity and partial-evidence regressions ([2cce98c](https://github.com/morluto/rea/commit/2cce98cca29ab8752c34281c4b439a0150308b2c))
* add limit monotonicity and partial-evidence regressions ([4afd970](https://github.com/morluto/rea/commit/4afd97029c3eebc0c755b0c9dee2fd74217a1305))
* **ci:** guard Windows Ghidra workflow isolation ([81ed68f](https://github.com/morluto/rea/commit/81ed68f67d8332b3013131dc6d86a001d1dc55a3))
* **ci:** guard Windows Ghidra workflow isolation ([98540c8](https://github.com/morluto/rea/commit/98540c8a12722aaa005102518746916018107ccb))
* **cli:** cover package-name binary alias ([40e2f94](https://github.com/morluto/rea/commit/40e2f943a52cbf957db2ae898c3624e5ac5faec6))
* **hopper:** add semantic runtime conformance ([da1da3b](https://github.com/morluto/rea/commit/da1da3bfb83e2fdd2a7a0a84a6a70aa73a4a68d6))
* **package:** align setup preflight contract ([b33ebb1](https://github.com/morluto/rea/commit/b33ebb1627423a09fa56b628284362118e68ca40))


### Continuous Integration

* **ghidra:** add Windows P0 acceptance and real-engine lanes ([0b35510](https://github.com/morluto/rea/commit/0b3551076d591be04efbb829d3eb1d17bcc828a9))

## [2.0.0](https://github.com/morluto/rea/compare/rea-agents-1.7.0...rea-agents-2.0.0) (2026-07-16)


### ⚠ BREAKING CHANGES

* **mcp:** require Evidence for managed reconstruction
* **mcp:** comparison tools now require session-owned Evidence IDs or approved bundle paths, and structured Evidence results use compact references.

### Features

* **application:** add cross-layer graph workflows ([778b995](https://github.com/morluto/rea/commit/778b995bbfd4b4bb28ace9bf0f7428e50cd1be50))
* **application:** add isolated JavaScript replay ([d86231a](https://github.com/morluto/rea/commit/d86231ad33e750c2a6ef60a33d833ac8db9219be))
* **dotnet:** add managed artifact triage ([c251c38](https://github.com/morluto/rea/commit/c251c38aa2ead24e4aaeb95678a10dddaa212dc4))
* **dotnet:** add managed member comparison ([55794d6](https://github.com/morluto/rea/commit/55794d6083d6746fa2c7ad08a5f548c05272b1ae))
* **dotnet:** add managed member inspection ([98cad37](https://github.com/morluto/rea/commit/98cad3788d05ae31d86bb448d6fa8e5ebb1c742c))
* **dotnet:** add managed native boundary inspection ([466b1bb](https://github.com/morluto/rea/commit/466b1bbebee8c9266708de885b5e5405d23d0b7c))
* **dotnet:** add managed runtime correlation planning ([5f66cfd](https://github.com/morluto/rea/commit/5f66cfd57aeec39bb3337cbbbc2b7c3c8460df54))
* **dotnet:** import managed reconstructions ([c506664](https://github.com/morluto/rea/commit/c5066647445f3a8be0a9df4ff0f41b7e478f79b5))
* **dotnet:** verify managed native boundaries ([8cbc125](https://github.com/morluto/rea/commit/8cbc125b9393f3cc84a8a1b4e1cb160714c833ad))
* **electron:** map static process and IPC boundaries ([3fa2304](https://github.com/morluto/rea/commit/3fa2304bc70beb96cf30feb51bb6d7ac4fb7a2b0))
* **electron:** reconcile static artifacts with passive runtime ([8c67dbd](https://github.com/morluto/rea/commit/8c67dbd49e74b2f304a03845a8a55e6a433cc915))
* **managed:** project static evidence into application graph ([6194c1a](https://github.com/morluto/rea/commit/6194c1a781a97043dbd02f0f6717c17598459abe))
* **managed:** project static evidence into application graph ([77178bb](https://github.com/morluto/rea/commit/77178bba543ed40b5cb29d301ad930e698a1968c))
* **mcp:** harden contracts and evidence references ([ee1cd40](https://github.com/morluto/rea/commit/ee1cd40405405097b9d5f9686cbcc765ab03d96a))
* **mcp:** require Evidence for managed reconstruction ([d36af5d](https://github.com/morluto/rea/commit/d36af5d0f708637f514f356521242b2b1066c8ed))
* **setup:** verify installed skill catalog identity ([b2d1f2a](https://github.com/morluto/rea/commit/b2d1f2affdc7faa0e1c56feefe596eb39dea0612))


### Bug Fixes

* **deps:** run freshness check from escaped paths ([8a1c128](https://github.com/morluto/rea/commit/8a1c128b67ee41ce054fe984946a5d7bfcc1a3b4))
* **mcp:** align runtime unknown argument validation ([d1e7220](https://github.com/morluto/rea/commit/d1e72207f48609e3214a66c2a248c70a2a1abd6c))
* **mcp:** hide managed workflows without a session ([412bbaf](https://github.com/morluto/rea/commit/412bbaf05e0d6fa5add68303c83325628cc2e7da))
* **mcp:** integrate managed contracts after rebase ([9c4a93d](https://github.com/morluto/rea/commit/9c4a93d9b1be36155bd9c0a39d8b541ec3986c64))
* **mcp:** normalize inferred field descriptions ([a807471](https://github.com/morluto/rea/commit/a807471e4e612e215ef82ebd2d16a1c454d5ad31))
* **mcp:** parse adapter inputs exactly once ([37c0f39](https://github.com/morluto/rea/commit/37c0f399544c9424c55e468d6784da61426a458e))
* **mcp:** remove arbitrary schema byte gate ([fd08025](https://github.com/morluto/rea/commit/fd08025dcd21cc31fa1e7356c90e76b4863b1af2))
* **mcp:** remove schema byte compaction ([f728295](https://github.com/morluto/rea/commit/f728295bd00585623b9597cf5702051aefa8ddc9))
* **package:** accept expected doctor diagnostics ([0f2d013](https://github.com/morluto/rea/commit/0f2d01300a4bc9fc534114a6913ec8dfcd5fa457))
* **test:** make host fixtures portable ([f23f529](https://github.com/morluto/rea/commit/f23f52903cb6df4eed6fec0e09f79c82ad9825dc))


### Code Refactoring

* **mcp:** remove obsolete managed evidence parser ([f7aa191](https://github.com/morluto/rea/commit/f7aa19154d9bc24b3ccdb8bde40ee926f06049a1))


### Documentation

* **analysis:** define managed-code evidence boundary ([80faff3](https://github.com/morluto/rea/commit/80faff3e5bf8baa65b0b18e03594e86753a76ac6))
* **api:** refresh managed reconstruction contracts ([2b06433](https://github.com/morluto/rea/commit/2b064335ea63db4484d16b35544dd5e8024ecf6d))
* **dotnet:** refresh managed reconstruction api ([cc1e47c](https://github.com/morluto/rea/commit/cc1e47c615bbbb6d2f7dc24ec1710c39e4b96bf4))
* refresh application workflow API links ([4a30820](https://github.com/morluto/rea/commit/4a30820a93a33f4ebb7b69202890c5c6a114ba0f))
* refresh managed native verification api ([849c052](https://github.com/morluto/rea/commit/849c05290aced212505c2621f208e89266c3ea96))
* refresh managed runtime api docs ([798631a](https://github.com/morluto/rea/commit/798631ade628464b6b233d240e53b7eea44721a0))
* refresh runtime reconciliation API ([87b2348](https://github.com/morluto/rea/commit/87b23482e28ed4e43674c4b9a775da4b16cb4636))
* **security:** define controlled replay authority ([461990d](https://github.com/morluto/rea/commit/461990da3f8e4ec573217432943f04311d577524))
* stabilize replay API source links ([a8c1057](https://github.com/morluto/rea/commit/a8c1057279d529d9f16ab9b093b0f6518915b6fa))


### Tests

* **dotnet:** add managed conformance verifier ([2b75fcf](https://github.com/morluto/rea/commit/2b75fcfaac8432b08b2d88cd95492333df2674d4))
* **dotnet:** verify managed app graph manifests ([5be4051](https://github.com/morluto/rea/commit/5be405169ef752e34199022e97c5fa4896693472))
* **dotnet:** verify managed app graph manifests ([a5e5c68](https://github.com/morluto/rea/commit/a5e5c68d117cdef33a47291ed4f641c9a89045f3))
* **dotnet:** verify managed app manifests ([793a948](https://github.com/morluto/rea/commit/793a948c1b6a61ce3ba2860fe977b19180c6fa9b))
* **hopper:** avoid scheduler-sensitive exit timing ([6e6827c](https://github.com/morluto/rea/commit/6e6827cd76fc080a959695ab19bfcc34b80c270c))
* **mcp:** cover strict compact wire contracts ([8de25d0](https://github.com/morluto/rea/commit/8de25d02302e7a03c1a0c6ab19ccb459758973ca))
* **mcp:** derive sessionless managed inventory ([cab7c4a](https://github.com/morluto/rea/commit/cab7c4a5212eb5bf2b233c835ac57b5764a4e0f3))
* **replay:** use portable seam executables ([3183f47](https://github.com/morluto/rea/commit/3183f47c0f785bdda52f9db6613932440094c522))

## [1.7.0](https://github.com/morluto/rea/compare/rea-agents-1.6.0...rea-agents-1.7.0) (2026-07-15)


### Features

* **artifact:** reconstruct JavaScript application structure ([aa46abf](https://github.com/morluto/rea/commit/aa46abfe1b59ecab160029c88b0c925ff68d6033))
* **domain:** add versioned JavaScript Application Graph ([2ca5672](https://github.com/morluto/rea/commit/2ca56724e4be7429372904ad26fe97fa5943bcf4))
* **ghidra:** add function analysis and conformance ([d8321de](https://github.com/morluto/rea/commit/d8321defd77c57df424b2635a4a70d38fe9a1fae))
* **ghidra:** add private headless provider session ([f0e625d](https://github.com/morluto/rea/commit/f0e625d7ee5a3f79158514aa93f89fca81a2da6a))
* **ghidra:** implement read-only inventory operations ([b1c07dd](https://github.com/morluto/rea/commit/b1c07dd9c6fe8c4dd109fefe67f4b16fdd1115d1))
* **session:** add explicit provider registry and target binding ([941d710](https://github.com/morluto/rea/commit/941d7101dd3c8b7cdd790724c55ff00a90f42270))


### Bug Fixes

* address setup, upgrade, and process test regressions ([960d759](https://github.com/morluto/rea/commit/960d759cc1979a32ae416c50e6095abfd629fbe7))
* address setup, upgrade, and process test regressions ([02f12b9](https://github.com/morluto/rea/commit/02f12b927a17615150d6e1126d1b841c5dca648b))
* **cli:** make clean source checkouts start reliably ([ed17e76](https://github.com/morluto/rea/commit/ed17e764733c819a1123372ad64d4122ba0c06e3))
* **cli:** make clean source checkouts start reliably ([6ba9765](https://github.com/morluto/rea/commit/6ba97656ca73e97ae1dbecc15a86a193978298b6))
* **setup:** replace managed Hopper on reinstall ([0ca93f9](https://github.com/morluto/rea/commit/0ca93f9779bc6c576479561c488982963fbb9167))


### Code Refactoring

* **domain:** remove provider-specific target and snapshot state ([21da71e](https://github.com/morluto/rea/commit/21da71ec6d30a63e497b871d16a69ab02f5b210b))
* **process:** extract reusable provider lifecycle primitives ([70e1a0f](https://github.com/morluto/rea/commit/70e1a0f5326fa1598e4f4e673a4ba1545cef5b65))


### Documentation

* **api:** refresh profile source anchors ([bd3cf96](https://github.com/morluto/rea/commit/bd3cf964d62bea2571559cfde6bdfe686922255f))
* **api:** refresh provider source anchors ([a7621c2](https://github.com/morluto/rea/commit/a7621c263392a92c63162febf511824c9c788548))
* **architecture:** define provider selection and analysis profiles ([75f8696](https://github.com/morluto/rea/commit/75f8696a57cf25a2a72a2a337d8076214f04ece4))
* **architecture:** define provider selection and analysis profiles ([f9f2fbe](https://github.com/morluto/rea/commit/f9f2fbe2fc04bd202d9fd580fc54c30529809fc0))
* reconcile product documentation with shipped behavior ([addc208](https://github.com/morluto/rea/commit/addc208f12790e3b0e48697c75e978e08814d303))
* reconcile product documentation with shipped behavior ([54056a9](https://github.com/morluto/rea/commit/54056a9782f3f51f8f1b510d8b9c1bf4c3c9f067))
* refresh Ghidra inventory API links ([a45de27](https://github.com/morluto/rea/commit/a45de27d9e97b8c7a76b3e6da12b0b4efdfa5dcb))
* regenerate JavaScript graph API with Node 24 ([da4817a](https://github.com/morluto/rea/commit/da4817abd10fe2d6b68bf4d393d067ce42ece910))


### Tests

* keep package setup verification read-only ([acaf030](https://github.com/morluto/rea/commit/acaf03056d6b457d85c6b7744565d6c7d56c424c))

## [1.6.0](https://github.com/morluto/rea/compare/rea-agents-1.5.0...rea-agents-1.6.0) (2026-07-14)


### Features

* add web and Electron reverse-engineering workflows ([be76f80](https://github.com/morluto/rea/commit/be76f8090b5195680cdf73a8c21f65e6516efc92))


### Bug Fixes

* **application:** add explicit investigation replay ([7112e1e](https://github.com/morluto/rea/commit/7112e1e6bf33bccd605bf3ee5541b83a522831e5))
* **application:** add explicit investigation replay ([a6b5ca4](https://github.com/morluto/rea/commit/a6b5ca4135ac2cf168470b47e97a05d8b67f3147))
* **browser:** keep page endpoint type internal ([3743962](https://github.com/morluto/rea/commit/37439620710d4c47bf48f1df0b099eab0c115446))
* **browser:** observe direct target disconnects ([9be24f8](https://github.com/morluto/rea/commit/9be24f8de14edc04cdd3649e0ea66d53edb72328))
* **browser:** preserve operation-aware cancellation errors ([0aac8aa](https://github.com/morluto/rea/commit/0aac8aaba5a5097d99277d7501dae6fdd017f2d0))
* **browser:** support page-scoped CDP transports ([c4930f4](https://github.com/morluto/rea/commit/c4930f4820dbf114da6fa850500f1415d0d6b7a9))
* **browser:** support page-scoped CDP transports ([bf96192](https://github.com/morluto/rea/commit/bf9619267b45f2383ebdd648dea05a7d2e3945a6))
* **browser:** support relative source map URLs ([5231e95](https://github.com/morluto/rea/commit/5231e95c19d309113a4335fe44a5793e3924219a))
* **cli:** confirm project grant revocation ([6397e54](https://github.com/morluto/rea/commit/6397e54169a55b4fcab7ad92f42bbd8f8c616810))
* **cli:** confirm project grant revocation ([7a4cfb4](https://github.com/morluto/rea/commit/7a4cfb4fbd96df34f5502adbf70f5bfb12bbc56c))
* **cli:** restrict production MCP dispatch ([8bd0e5f](https://github.com/morluto/rea/commit/8bd0e5f1ea7f36b23f83113ef285c31a36ff315c))
* **cli:** restrict production MCP dispatch ([190e5d3](https://github.com/morluto/rea/commit/190e5d3282f0f1bc980ad488a7774a500ae3e87d))
* **doctor:** honor explicit Hopper launcher ([c69fe2c](https://github.com/morluto/rea/commit/c69fe2c897b8f567e1607424690e9d59aaefadf1))
* **doctor:** honor explicit Hopper launcher ([9208592](https://github.com/morluto/rea/commit/9208592f41ed920c32206c78fcf43c8d7db77f22))
* **evidence:** enforce the combined record limit ([c791802](https://github.com/morluto/rea/commit/c7918024bc89995f4054bd499fef88a34a3e24d7))
* **evidence:** enforce the combined record limit ([834c70c](https://github.com/morluto/rea/commit/834c70cf4b9c8dca000c7a20491215d1acc0db89))
* **hopper:** cancel startup before closing ([f471a63](https://github.com/morluto/rea/commit/f471a63c87679eff9564553741d9967724c57f0a))
* **hopper:** cancel startup before closing ([6cc2fdf](https://github.com/morluto/rea/commit/6cc2fdf80ce2d0220fe996ddbed2f0378f5397cd))
* **hopper:** select verified Linux demo mode explicitly ([46e4052](https://github.com/morluto/rea/commit/46e40520285c2338bd1ffedd16599977c333befb))
* **hopper:** select verified Linux demo mode explicitly ([04c5fd6](https://github.com/morluto/rea/commit/04c5fd63b72e6e497363ecbde5e24088eef639cd))
* **native:** harden command capture edge cases ([c2e64a4](https://github.com/morluto/rea/commit/c2e64a42c84bd245f3df4eb8b61039c8594704f8))
* **native:** harden command capture edge cases ([d39f98d](https://github.com/morluto/rea/commit/d39f98d06dd53cdfd427e75e2f45f2c8b8792f50))
* preserve setup diagnostics and clean Knip config ([2d1e021](https://github.com/morluto/rea/commit/2d1e021782dc903faaa401207dad47278bfb57b2))
* preserve setup diagnostics and clean Knip config ([5a7ccef](https://github.com/morluto/rea/commit/5a7ccefc68e3d7359bfd9a6262701641da380d37))
* **process:** gate sampling on initialized PTY root ([57938a8](https://github.com/morluto/rea/commit/57938a8465add2d6e89dae13e66059bad7f72a45))
* **process:** gate sampling on initialized PTY roots ([e831a41](https://github.com/morluto/rea/commit/e831a41375148336d72beadd5d13405047c82e67))
* **process:** keep validation detail internal ([614a119](https://github.com/morluto/rea/commit/614a1197f5b699b61c46d82a24e0564bf0d87829))
* **process:** restrict cleanup to captured group leaders ([40c6f60](https://github.com/morluto/rea/commit/40c6f60ac9a4b86f4cbe28a72e7692e1acf761b1))
* **process:** settle exited zombie groups ([072ce5a](https://github.com/morluto/rea/commit/072ce5aede03a2dab59ce8776a04063218448925))
* **process:** settle exited zombie groups ([4828326](https://github.com/morluto/rea/commit/482832607910a6e872bccc27c956eeaf55dd6056))
* **process:** stabilize and speed up the test suite ([a3b7de9](https://github.com/morluto/rea/commit/a3b7de9fa5e89808a3c01a5623779709edb7c691))
* **reference:** preserve distinct parse failures ([e02cb2f](https://github.com/morluto/rea/commit/e02cb2f877e8fd9874245ee6e15f68666afaeb46))
* **reference:** preserve distinct parse failures ([543510f](https://github.com/morluto/rea/commit/543510f62fd257b42e6a7dfc876112dda0e0ea01))
* rollup batch of fixes ([b348b2c](https://github.com/morluto/rea/commit/b348b2c98772b3d38b33e6aa4d14ae7dce78a4b9))
* **runtime:** apply permission reloads atomically ([49e843e](https://github.com/morluto/rea/commit/49e843e8ff2eb87bf1c6174823191cc97ad1ced8))
* **runtime:** apply permission reloads atomically ([3ae7109](https://github.com/morluto/rea/commit/3ae7109faa29175e84ef695b296ad4db14097a37))
* **runtime:** serialize permission reloads ([7e53dd6](https://github.com/morluto/rea/commit/7e53dd6ad321f9b75dbe458f9e116da7637d740c))
* **runtime:** unregister shutdown handlers ([71072d8](https://github.com/morluto/rea/commit/71072d86b161530d523a10e920e5d67ca220a7e9))
* **runtime:** unregister shutdown handlers ([f9e3c23](https://github.com/morluto/rea/commit/f9e3c23987bdf37be07d6c4602666c6ac90ae0ed))
* **session:** isolate availability observers ([43766fd](https://github.com/morluto/rea/commit/43766fda699f5498909af21e386ae4817159e4cf))
* **session:** isolate availability observers ([e5a80d4](https://github.com/morluto/rea/commit/e5a80d4f06cd0d4bf64e6b94b50f7430829c336a))
* **session:** reopen replaced targets ([e98413c](https://github.com/morluto/rea/commit/e98413c3d5b0adae72ac9f3814f401ad9eec2bb6))
* **session:** reopen replaced targets ([5c55999](https://github.com/morluto/rea/commit/5c559998e14bcb9be1e589a1266e31296a8f2af8))
* **setup:** configure every detected client ([69744a4](https://github.com/morluto/rea/commit/69744a421a28bad525fe95697938b99d7ffcf5b6))
* **setup:** configure every detected client ([24f9a1f](https://github.com/morluto/rea/commit/24f9a1ff11e4d1a6361071739fa937d88159fb33))
* **setup:** omit aligned client configurations from plan ([a86da4f](https://github.com/morluto/rea/commit/a86da4ff3f9279e4ca3fc792e6f18542fee9e0ce))
* **setup:** omit aligned skill from plan ([d81687f](https://github.com/morluto/rea/commit/d81687f38393128b0a91ca83deb9b250190fb509))
* **setup:** omit aligned skill from plan ([2984fa7](https://github.com/morluto/rea/commit/2984fa74acfb6f7cbb504677a348e20bff85b806))
* **setup:** preserve client config symlinks ([85285f1](https://github.com/morluto/rea/commit/85285f1563d8d24bb934e1fe227cb91fe36c6dd4))
* **setup:** preserve client config symlinks ([df87544](https://github.com/morluto/rea/commit/df87544a5dcee13f15aa6e435c2b61fb3b220397))
* **test:** adapt mainReload shutdown seam to registerShutdown signature ([0a430c1](https://github.com/morluto/rea/commit/0a430c12c158cf7f1ef04cdf537d5277c08c6106))
* **tooling:** isolate concurrent repository checks ([fb17156](https://github.com/morluto/rea/commit/fb17156499c592b5e18ffae996c55c372e3727d0))
* **tooling:** isolate concurrent repository checks ([ab8c5c1](https://github.com/morluto/rea/commit/ab8c5c1e13041690e07896f2f2f0dfa2134ad97e))
* **upgrade:** prevent version downgrades ([a204840](https://github.com/morluto/rea/commit/a2048406302b808e4f897eabd6c00ce64c529c16))
* **upgrade:** prevent version downgrades ([1d1d234](https://github.com/morluto/rea/commit/1d1d234eedd3b73108cd2fb41878680ca107bb7c))
* **verify:** reconcile PR-212/215/228 package E2E expectations ([cfa110c](https://github.com/morluto/rea/commit/cfa110ccb4021d383cc8be1caa17fef923edc183))


### Performance Improvements

* **application:** scan version artifacts in parallel ([528c05e](https://github.com/morluto/rea/commit/528c05e2faa557e17b6b83ccd7e1b0e779ba892a))
* **application:** scan version artifacts in parallel ([c00739b](https://github.com/morluto/rea/commit/c00739bb1f1ae3cb6f00464e8fd9f5b5f7dc6b6e))


### Tests

* **application:** verify packaged MCP replay ([6601e0c](https://github.com/morluto/rea/commit/6601e0cb7e57fe94cf0ae65bf0d04de25a3a7b49))
* **browser:** harden Chrome startup on CI ([74c5121](https://github.com/morluto/rea/commit/74c512130c5bc25d6c119eda72a86e73fcc9f1ff))
* **browser:** route discovery sockets through proxy ([e363f0e](https://github.com/morluto/rea/commit/e363f0eab8325a9f83568295d4669d70e7d47a2d))
* **browser:** verify page-scoped Chrome transport ([c252536](https://github.com/morluto/rea/commit/c252536494c15f36e69978eaf068eae176e71688))
* **cli:** verify packaged policy revocation ([3d71737](https://github.com/morluto/rea/commit/3d71737dc9ba8b449c0d174da90c3f1df54789d2))
* **hopper:** cover verified Linux rejection ([db202c2](https://github.com/morluto/rea/commit/db202c2b6ac9ce771c401cc558c56ecf6d2e51ee))
* **hopper:** retry after cancelled startup ([6de726f](https://github.com/morluto/rea/commit/6de726ffddc54ea354e6970f022eaab2f0863586))
* **hopper:** verify alternate Linux launcher path ([d93257b](https://github.com/morluto/rea/commit/d93257b50fae81272cbd2da28ba24d03647c2c99))
* **package:** cover aligned setup plan ([a597639](https://github.com/morluto/rea/commit/a5976396eb424933232844e161cdab84b452b361))
* **package:** cover config symlink lifecycle ([d1ef7a5](https://github.com/morluto/rea/commit/d1ef7a54394ff2ed4316ba01cfe0aa4aac313aed))
* **package:** preserve unrelated symlink config ([c50e51e](https://github.com/morluto/rea/commit/c50e51eb6fe5686ad9d680abe0d96b3e4b58dc78))
* reduce test suite runtime ([2223da1](https://github.com/morluto/rea/commit/2223da19166a3ec485d98a0d005113a9d0358f37))
* **reference:** cover failure normalization ([3d5041f](https://github.com/morluto/rea/commit/3d5041fb2f8964c30f0273615b4f039620eef0bf))
* **runtime:** cover idempotent handler cleanup ([1bdb59e](https://github.com/morluto/rea/commit/1bdb59e201a26b53f5ed8b2eb870941ca4b788f7))
* serialize subprocess-heavy integrations ([f46fc7f](https://github.com/morluto/rea/commit/f46fc7f1f3a265123c69d007c64c928a8974d98f))
* **session:** reopen replaced target through MCP ([1c32880](https://github.com/morluto/rea/commit/1c32880e56450b610d766c5a6c1bee6873ee6323))
* **setup:** cover later clients after failure ([8f73112](https://github.com/morluto/rea/commit/8f7311285b2ba7a1ed427d61e437dd2665e20d12))

## [1.5.0](https://github.com/morluto/rea/compare/rea-agents-1.4.0...rea-agents-1.5.0) (2026-07-14)


### Features

* add passive website reverse engineering ([9986971](https://github.com/morluto/rea/commit/998697155dcc733be73e75bc77c069638942f111))
* add passive website reverse engineering ([2c1ceab](https://github.com/morluto/rea/commit/2c1ceabbf1f117daafe166e1134b47737b38e1f6))


### Bug Fixes

* **browser:** drop disallowed redirect evidence ([8481be9](https://github.com/morluto/rea/commit/8481be9c9709b13f572fefefcf8508d9e2605386))
* **browser:** scope CDP events and fail closed ([5279d77](https://github.com/morluto/rea/commit/5279d7755c74df579028ce51b4bc53b089bb2749))
* **browser:** scope workers and binary frame sizes ([dfc06cf](https://github.com/morluto/rea/commit/dfc06cf0ad4a39719ef74846cb83f05e7b6f6289))
* harden PTY events and configured roots ([ae8b1c5](https://github.com/morluto/rea/commit/ae8b1c5ca9c2d122d7fc30ebfa25e08d57ca7a51))
* harden PTY events and configured roots ([31b40f3](https://github.com/morluto/rea/commit/31b40f39e4c29a077deebefbe29e90c30e50cd0c))
* **permission:** defer cache write grants ([6a3fd5b](https://github.com/morluto/rea/commit/6a3fd5b4cec7569eebfe8a7ca6a7c0c1e3a7340d))
* **permission:** defer cache write grants ([f840e70](https://github.com/morluto/rea/commit/f840e70749ffadfe34cf8b7e464b54e8ffebd816))
* resolve triaged correctness issues ([2575b30](https://github.com/morluto/rea/commit/2575b30dfcb79c2e26ed16311f780a8723578c6a))
* resolve triaged correctness issues ([e8ed307](https://github.com/morluto/rea/commit/e8ed3073ac915e32b5ea630446ed6e14bc788119))
* resolve validation and artifact edge cases ([2468682](https://github.com/morluto/rea/commit/246868232e4196394fbc6e67cfae4d3ca214fe60))
* resolve validation and artifact edge cases ([ef7f2f9](https://github.com/morluto/rea/commit/ef7f2f93747f0a4d9f70c9fc2e252456d20843f3))


### Documentation

* add Hopper screenshot to README ([a699fdd](https://github.com/morluto/rea/commit/a699fdd6a5cc9c9812c7d78fd98b51469488866f))
* add Hopper screenshot to README ([08981a3](https://github.com/morluto/rea/commit/08981a31b5e9b76e15914c0570244158d491e047))


### Tests

* **cli:** allow cold-start integration timing ([7d5621d](https://github.com/morluto/rea/commit/7d5621dfbc4333f99846cbe52227d3b4f53ee0cd))

## [1.4.0](https://github.com/morluto/rea/compare/rea-agents-1.3.0...rea-agents-1.4.0) (2026-07-14)


### Features

* **core:** add typed policy and integrity contracts ([190efca](https://github.com/morluto/rea/commit/190efcaf1728743a02fb65a35319abdc14ea2227))
* **identity:** derive MCP surface metadata ([2722722](https://github.com/morluto/rea/commit/2722722425cb7e7f5954de95ea4641ba2f1ae03b))
* **mcp:** expose progress resources and availability ([da59299](https://github.com/morluto/rea/commit/da59299a8a83241e6912a062cf8d5744993cad9e))
* **mcp:** land policy, resources, and typed contracts ([8f79ee7](https://github.com/morluto/rea/commit/8f79ee771e362f69001a483dcbdb59f4c7b89af0))


### Bug Fixes

* **ci:** keep generated error docs with their owner ([3e60e38](https://github.com/morluto/rea/commit/3e60e38a147eafa0445e4f9935ede279b4aab688))
* **ci:** preserve stacked integration changes ([cf8e5cf](https://github.com/morluto/rea/commit/cf8e5cf5e61fe00731768107790e715958a96fc8))
* **cli:** return nonzero status for operation failures ([#121](https://github.com/morluto/rea/issues/121)) ([00c187e](https://github.com/morluto/rea/commit/00c187e32b3d2add37245a48f21185c2bd4fc22a))
* **cli:** return nonzero status for operation failures ([#122](https://github.com/morluto/rea/issues/122)) ([964620a](https://github.com/morluto/rea/commit/964620a0a108c3c671d982da37b5d4c05c4ef035))
* **hopper:** complete owned Linux shutdown ([#116](https://github.com/morluto/rea/issues/116)) ([fb51874](https://github.com/morluto/rea/commit/fb51874bb9ee1d5144c897e0de4c7e083ba4d390))
* **mcp:** preserve migrated revisions and valid links ([4149472](https://github.com/morluto/rea/commit/414947243963fed5f769a124758424dda371dcd7))
* preserve actionable artifact diagnostics ([#119](https://github.com/morluto/rea/issues/119)) ([7385220](https://github.com/morluto/rea/commit/73852202d42743fe5589fd9477f0d0991d87c060))
* **workspace:** migrate legacy integrity identities ([d092d4c](https://github.com/morluto/rea/commit/d092d4c97a51882f7cdbc0e3dd167cea309b8adf))


### Tests

* **identity:** defer live MCP integration proof ([74db3fc](https://github.com/morluto/rea/commit/74db3fcd4259f3c09fb29cc7762952320b99ae71))

## [1.3.0](https://github.com/morluto/rea/compare/rea-agents-1.2.0...rea-agents-1.3.0) (2026-07-13)


### Features

* add guided MCP workflow prompts ([08d5b91](https://github.com/morluto/rea/commit/08d5b913b00a382af6e9e8c847459608e2f2384e))
* add guided MCP workflow prompts ([24c3adb](https://github.com/morluto/rea/commit/24c3adb553407fb9ac696e8e7c8d6eea643d14d6))
* add persistent cross-version investigation workspaces ([c52eb46](https://github.com/morluto/rea/commit/c52eb4600a275fe080d8ba1f27fd6cef95f85850))
* add persistent cross-version investigation workspaces ([41366ed](https://github.com/morluto/rea/commit/41366edd566ba17cce81cd0cc3b503065775febc))
* **analysis:** add provider-neutral persistent snapshots ([c439b9e](https://github.com/morluto/rea/commit/c439b9e7787f3947eced0126a9c7b4d091584363))
* **analysis:** persist snapshots and close Hopper reliably ([c6407ef](https://github.com/morluto/rea/commit/c6407ef3d66d78e7635ec1b082144cd38068f93a))
* **errors:** add caller-safe typed error projections ([3be439c](https://github.com/morluto/rea/commit/3be439cbf3db2c53c766bf93a4e247fdfb8242ae))
* **mcp:** return structured typed tool results ([eb38e4c](https://github.com/morluto/rea/commit/eb38e4c4024a7d66001b3e69f8309c85492f05c0))


### Bug Fixes

* **bridge:** bound regex search work ([733a382](https://github.com/morluto/rea/commit/733a382b3020c4953747d7c6e2caf73883a6274c))
* **bridge:** bound regex search work ([65682ee](https://github.com/morluto/rea/commit/65682ee65c9f899875be5a785c0ec688bc4eda14))
* **ci:** remove unused setup type export ([c5728af](https://github.com/morluto/rea/commit/c5728af0b4574631d056f7ed1eb7785e80d80111))
* **cli:** render actionable analysis errors ([af8c4ef](https://github.com/morluto/rea/commit/af8c4efb4a415e4bdeae0151a8d29cd71af61916))
* **copy:** use agent terminology ([12060f6](https://github.com/morluto/rea/commit/12060f6d8dd3ed61fbd1d07fa604652c6b0a93e2))
* **errors:** improve recovery guidance ([77454dc](https://github.com/morluto/rea/commit/77454dc8f412e8431bbceff1a4c90ee8f636c9c7))
* **errors:** return actionable caller-safe failures ([fb0da03](https://github.com/morluto/rea/commit/fb0da031cf6305f5aaec5e9ec8178f08fd664479))
* **hopper:** cancel analysis and close documents reliably ([179870e](https://github.com/morluto/rea/commit/179870e8256419402464f02c918146865c6fbb93))
* **hopper:** return addresses for procedure relationships ([2c707ab](https://github.com/morluto/rea/commit/2c707abb66433f9065733398a0e5ea9af04cfb96))
* **linux:** start Hopper demo sessions headlessly ([32c5080](https://github.com/morluto/rea/commit/32c5080a26cae603f02dce9dc5777e98d1e5fc75))
* **linux:** start Hopper demo sessions headlessly ([75818d1](https://github.com/morluto/rea/commit/75818d119e3eb3b8df5acdbd554a2b86b82af23a))
* **security:** restrict investigation artifact inputs ([a2076b4](https://github.com/morluto/rea/commit/a2076b47a6b43d9c80396ee4a5954af590d65088))


### Tests

* **linux:** verify setup through CLI and MCP ([67504d2](https://github.com/morluto/rea/commit/67504d2d51151fd9eed76b12c9bae67c70817432))
* **package:** preserve unsupported host verification ([977119f](https://github.com/morluto/rea/commit/977119f91b4af39ea208a5e63d9445bf366b2eeb))
* strengthen MCP prompt acceptance coverage ([05fb9b1](https://github.com/morluto/rea/commit/05fb9b17c91b2ed7bfb58c3399499e0fb9e3f73e))

## [1.2.0](https://github.com/morluto/rea/compare/rea-agents-1.1.0...rea-agents-1.2.0) (2026-07-13)


### Features

* **artifacts:** add approved native DMG traversal ([24d000a](https://github.com/morluto/rea/commit/24d000a76e3fb98c69d47ab26ac1322a4c87f901))
* **process:** add deterministic capture v3 ([d0e21f9](https://github.com/morluto/rea/commit/d0e21f923158b7a3de73d06edf57462869022556))
* **process:** add deterministic capture v3 ([5a361a6](https://github.com/morluto/rea/commit/5a361a67258e1f89507497eafd5fc487e54d5820))
* **process:** introduce evidence-safe capture v4 ([ee4d284](https://github.com/morluto/rea/commit/ee4d284597a32b4acc4279b74083d9bf4e32d08b))


### Bug Fixes

* **artifacts:** diagnose unpacked ASAR integrity failures ([a504342](https://github.com/morluto/rea/commit/a504342d2b7e5ed87620d449f78102282054e063))
* **ci:** remove redundant process exports ([19bb231](https://github.com/morluto/rea/commit/19bb2317d1bd6773e5fa3f61e32cbf3d6d257830))
* **process:** harden capture validation and cleanup ([ac78de0](https://github.com/morluto/rea/commit/ac78de0a74b09a01efd91d9f88a16fde4f0ed9d9))


### Code Refactoring

* **artifacts:** simplify inventory traversal ([c8d762e](https://github.com/morluto/rea/commit/c8d762e6ffe0a2e23fb539590d7b1850ef1ce2a7))
* **setup:** split setup and CLI registration ([07e1b5a](https://github.com/morluto/rea/commit/07e1b5ac5f6a1724b1064c47ea05f04ccffcb4f3))


### Documentation

* document capture v4 and native mounts ([aca518b](https://github.com/morluto/rea/commit/aca518bb885825b912567eba95eb64a776a5624c))
* document process capture v3 ([50f4a29](https://github.com/morluto/rea/commit/50f4a298f44bf56dc78d5717cb23d69db5df4265))
* **process:** preserve capture invariants ([841990b](https://github.com/morluto/rea/commit/841990bde158a996be65feabcef4aa5e18fc3a4b))
* **skill:** document capture v4 and DMG mounts ([f0a9a3c](https://github.com/morluto/rea/commit/f0a9a3cd258d60046dcd74feea243956489c60dc))


### Tests

* **process:** use deterministic hang fixture ([ba15d16](https://github.com/morluto/rea/commit/ba15d16c5869ef29e85a0e9bacff3ac07edda3a2))

## [1.1.0](https://github.com/morluto/rea/compare/rea-agents-1.0.0...rea-agents-1.1.0) (2026-07-13)


### Features

* **setup:** make installation explicit and safe ([29d92ca](https://github.com/morluto/rea/commit/29d92cac5ab23a4e6a5286b0871224abbe705642))
* **setup:** make installation explicit and safe ([3793889](https://github.com/morluto/rea/commit/3793889ce8662ca8e1e92af1bb5c6ee854848467))


### Bug Fixes

* preserve requested evidence paths on macOS ([0c0e2b8](https://github.com/morluto/rea/commit/0c0e2b8a1efb3f56672b9c95fda5c5ab5746284b))
* preserve requested evidence paths on macOS ([3d0ad79](https://github.com/morluto/rea/commit/3d0ad799c4deb1d3627d8721c31bc76be3f3abd2))


### Documentation

* **api:** regenerate TypeDoc reference ([0a66cae](https://github.com/morluto/rea/commit/0a66cae16ef8e2a243bbed502bbb7cdbd12a965f))
* define REA contributor priorities ([5df4ef6](https://github.com/morluto/rea/commit/5df4ef67a4676f46900aa6022c1af2224efa8761))
* explain the installation workflow ([1c83263](https://github.com/morluto/rea/commit/1c83263bbb79aa050d1e560d17da66557afdbad2))

## [1.0.0](https://github.com/morluto/rea/compare/rea-agents-0.5.0...rea-agents-1.0.0) (2026-07-13)


### ⚠ BREAKING CHANGES

* **contracts:** batch_decompile, get_call_graph, and find_xrefs_to_name now return structured discriminated output shapes.

### Features

* **cli:** add self-upgrade command ([c004220](https://github.com/morluto/rea/commit/c004220a2699ac60a67a9c7edf1f96cad8a31d3e))
* **cli:** add self-upgrade command ([0d77a9f](https://github.com/morluto/rea/commit/0d77a9f1350056a7d2c43771d579e0461029f5b5))


### Bug Fixes

* **contracts:** keep error schema internal ([ac8cc66](https://github.com/morluto/rea/commit/ac8cc668fb6b9305d2dc9014f7a6006d96b18ba6))
* **contracts:** return structured workflow failures ([4c54ff6](https://github.com/morluto/rea/commit/4c54ff6bcaac02f39c6620a54ac29690a121f33d))
* **native:** classify pre-aborted analysis first ([dfd598f](https://github.com/morluto/rea/commit/dfd598f76505af978f2d11afffb5e1f362d3a769))


### Documentation

* list upgrade in CLI reference ([8a24088](https://github.com/morluto/rea/commit/8a24088c2bffd34050ea6f6f0e103f64a3f67a64))

## [0.5.0](https://github.com/morluto/rea/compare/rea-agents-0.4.0...rea-agents-0.5.0) (2026-07-13)


### Features

* **analysis:** harden agent workflows and evidence boundaries ([883db91](https://github.com/morluto/rea/commit/883db912da6e38e1078286997cc9048471e03896))
* **cli:** align terminal workflows with MCP ([b1912b1](https://github.com/morluto/rea/commit/b1912b18e1723c594a030b16acf01341f083455b))


### Bug Fixes

* **analysis:** accept valid final dossier pages ([7c36f36](https://github.com/morluto/rea/commit/7c36f3631862e67a0751967c84abc4f423f5475c))
* **bridge:** harden bounded Hopper boundaries ([f8e8ea3](https://github.com/morluto/rea/commit/f8e8ea35ff08ce5071acbccab188df808708b71c))
* **cli:** preserve function provider provenance ([c630f41](https://github.com/morluto/rea/commit/c630f410b6a81864bf90211a088c715bfe234722))
* **lifecycle:** validate owned Hopper process identity ([898d6b0](https://github.com/morluto/rea/commit/898d6b0192126030cedd7e5c2cb76f40568cda05))
* **process:** default capture networking to loopback ([bce3398](https://github.com/morluto/rea/commit/bce3398dbe3a3b20952f37573a656aa77b168977))
* **process:** keep network approval fail-closed ([9526389](https://github.com/morluto/rea/commit/9526389f815f0937fc01198ff3a8a850c6c1c81a))


### Code Refactoring

* **cli:** share direct analysis tool types ([329fdf6](https://github.com/morluto/rea/commit/329fdf6fe8f3a2bf9679b13a8ce5cb16cf946129))


### Documentation

* correct pull request tool inventory ([d806480](https://github.com/morluto/rea/commit/d806480e41bcb623448a258ddffeb75082fe1e1f))
* document CLI safety and provider evaluation ([efc9bd2](https://github.com/morluto/rea/commit/efc9bd270f58a5aaba15edb07cee135d2c54db83))


### Tests

* **docs:** keep localized claims and tool counts aligned ([a7b84a9](https://github.com/morluto/rea/commit/a7b84a9b4b7ea4336c0f327e13b2948a8d94fba9))
* **verification:** strengthen conformance and real-Hopper checks ([0d36976](https://github.com/morluto/rea/commit/0d369762770d2d92dd72c7dcb2f2f90a64b206ff))

## [0.4.0](https://github.com/morluto/rea/compare/rea-agents-0.3.0...rea-agents-0.4.0) (2026-07-12)


### Features

* add cross-platform installation lifecycle ([cc6a955](https://github.com/morluto/rea/commit/cc6a9557e1fdd8c057902e9c0fcfbba2561cbcd7))
* add cross-platform installation lifecycle ([e651cb6](https://github.com/morluto/rea/commit/e651cb65db87b6d9df9fb13b66a6e5e76f0965e0))


### Documentation

* document installation and Linux support ([034563a](https://github.com/morluto/rea/commit/034563a4c015c69e878054d4fd06e0e9fa630e24))
* simplify REA onboarding ([e1dfe86](https://github.com/morluto/rea/commit/e1dfe8613e5a986d5ee64764851f0abcc901398b))
* simplify REA onboarding ([d85b661](https://github.com/morluto/rea/commit/d85b661be80bd19d477c46ebe0501839c7b63ee7))


### Tests

* add package installation end-to-end coverage ([993356b](https://github.com/morluto/rea/commit/993356b85adc72036ba44cd87b9335e2ec172a32))
* stabilize artifact pagination coverage ([f56bdde](https://github.com/morluto/rea/commit/f56bdde27679e1f05b34d2cf5efbc6e49bd4c2ca))


### Continuous Integration

* enforce conventional pull request titles ([07a0b98](https://github.com/morluto/rea/commit/07a0b984f2bdbc4fe1ce18d5db13500aa8f3992f))
* enforce conventional pull request titles ([3a21f16](https://github.com/morluto/rea/commit/3a21f16c1832430765083636511a8c12dbccf2dd))
* verify installed package with Linux Hopper ([4f97f69](https://github.com/morluto/rea/commit/4f97f699e4d5471557d1ce0ff91e144065d06a61))

## [0.3.0](https://github.com/morluto/rea/compare/rea-0.2.1...rea-agents-0.3.0) (2026-07-12)


### Features

* add evidence-backed process investigations ([cc8681a](https://github.com/morluto/rea/commit/cc8681a856dacb296f835112d0a27133d4c05ad1))
* **cli:** add guided local onboarding ([8ca3db8](https://github.com/morluto/rea/commit/8ca3db829f90f99dcaa57bbfc44fb3fe6a6b60c0))
* evolve REA analysis platform ([4f18e26](https://github.com/morluto/rea/commit/4f18e26ee58f616de788e07639f5b2f91d37ef11))
* **identity:** rename package and CLI to REA ([3d70812](https://github.com/morluto/rea/commit/3d70812c373ca7ef9a41146555605455515998dd))
* **mcp:** add typed bounded analysis tools ([893d2e2](https://github.com/morluto/rea/commit/893d2e2d0550271297c452b418f80bdf8ae21514))
* **session:** add dynamic binary lifecycle ([f32e718](https://github.com/morluto/rea/commit/f32e718cc741bba4deb0162c1a9b93f127e7741a))


### Bug Fixes

* **boundaries:** reject unsafe local inputs ([15e8cf3](https://github.com/morluto/rea/commit/15e8cf3234bd3b5ee929db84c5c71e9a18441eb6))
* **doctor:** require an executable Hopper launcher ([aee9cb8](https://github.com/morluto/rea/commit/aee9cb8e4e919d28ae851987f6555cfceee46977))
* **hopper:** launch analysis without stealing focus ([ff321dc](https://github.com/morluto/rea/commit/ff321dc574cd510e036fe5910fba79058e5c015b))
* **hopper:** make loader selection non-interactive ([2b7ef86](https://github.com/morluto/rea/commit/2b7ef8610df3cbee5fe0a4600dce5381cce77793))
* keep execution options internal ([167a824](https://github.com/morluto/rea/commit/167a824f9131a60d07fca3e99301eecc98d5d5e9))
* **setup:** persist detected Hopper launcher ([b2866e4](https://github.com/morluto/rea/commit/b2866e4706f939ffebf65645f5e3feaf4b4095fd))
* **setup:** preserve consent and startup target kind ([a67054f](https://github.com/morluto/rea/commit/a67054f81500033c0a5b8d87f7f009ed2adda6e3))
* **setup:** preserve invalid MCP configuration ([88f5edc](https://github.com/morluto/rea/commit/88f5edc2365da92673c184ad0d2a9b218ba22f91))
* **targets:** cancel startup and probe PE offsets ([66b8d6e](https://github.com/morluto/rea/commit/66b8d6ea90dabc01162c7d42e37056ea3501939e))
* **verify:** tolerate exited Hopper helpers ([b167bd7](https://github.com/morluto/rea/commit/b167bd7e13ad2e4889f721235fd6b6e3d8e3b08c))


### Code Refactoring

* **cli:** share runtime between CLI and MCP ([97541d8](https://github.com/morluto/rea/commit/97541d8dad96e640ffd9ce5f0587dee0b5fbf6c1))


### Documentation

* document frictionless binary workflow ([ee6d539](https://github.com/morluto/rea/commit/ee6d539a407493617c1a58816e0329d600495217))
* document the 43-tool workflow ([1f235cb](https://github.com/morluto/rea/commit/1f235cb52f61c08b65ecb674cac649c34005bc66))
* record runtime and release constraints ([62ede51](https://github.com/morluto/rea/commit/62ede515b7c7e092714fa936575fd54d282deb93))
* redesign and localize README ([051b6db](https://github.com/morluto/rea/commit/051b6db65687fd14826b6462cd623feb2504f123))
* redesign and localize README ([910eda6](https://github.com/morluto/rea/commit/910eda6f323ba1151b0771fe5de6c60a91e3d46d))


### Tests

* add source-built Hopper conformance fixtures ([d648bcd](https://github.com/morluto/rea/commit/d648bcd2e41ec0b45bc02a69dee0d7206fc64f8f))

## [0.2.1](https://github.com/morluto/rea/compare/rea-0.2.0...rea-0.2.1) (2026-07-12)


### Documentation

* redesign and localize README ([051b6db](https://github.com/morluto/rea/commit/051b6db65687fd14826b6462cd623feb2504f123))
* redesign and localize README ([910eda6](https://github.com/morluto/rea/commit/910eda6f323ba1151b0771fe5de6c60a91e3d46d))

## [0.2.0](https://github.com/morluto/rea/releases/tag/rea-0.2.0) (2026-07-12)


### Features

* **cli:** add guided local onboarding ([8ca3db8](https://github.com/morluto/rea/commit/8ca3db829f90f99dcaa57bbfc44fb3fe6a6b60c0))
* **identity:** rename package and CLI to REA ([3d70812](https://github.com/morluto/rea/commit/3d70812c373ca7ef9a41146555605455515998dd))
* **session:** add dynamic binary lifecycle ([f32e718](https://github.com/morluto/rea/commit/f32e718cc741bba4deb0162c1a9b93f127e7741a))


### Bug Fixes

* **boundaries:** reject unsafe local inputs ([15e8cf3](https://github.com/morluto/rea/commit/15e8cf3234bd3b5ee929db84c5c71e9a18441eb6))
* **doctor:** require an executable Hopper launcher ([aee9cb8](https://github.com/morluto/rea/commit/aee9cb8e4e919d28ae851987f6555cfceee46977))
* **hopper:** launch analysis without stealing focus ([ff321dc](https://github.com/morluto/rea/commit/ff321dc574cd510e036fe5910fba79058e5c015b))
* **hopper:** make loader selection non-interactive ([2b7ef86](https://github.com/morluto/rea/commit/2b7ef8610df3cbee5fe0a4600dce5381cce77793))
* **setup:** persist detected Hopper launcher ([b2866e4](https://github.com/morluto/rea/commit/b2866e4706f939ffebf65645f5e3feaf4b4095fd))
* **setup:** preserve consent and startup target kind ([a67054f](https://github.com/morluto/rea/commit/a67054f81500033c0a5b8d87f7f009ed2adda6e3))
* **setup:** preserve invalid MCP configuration ([88f5edc](https://github.com/morluto/rea/commit/88f5edc2365da92673c184ad0d2a9b218ba22f91))
* **targets:** cancel startup and probe PE offsets ([66b8d6e](https://github.com/morluto/rea/commit/66b8d6ea90dabc01162c7d42e37056ea3501939e))
* **verify:** tolerate exited Hopper helpers ([b167bd7](https://github.com/morluto/rea/commit/b167bd7e13ad2e4889f721235fd6b6e3d8e3b08c))


### Code Refactoring

* **cli:** share runtime between CLI and MCP ([97541d8](https://github.com/morluto/rea/commit/97541d8dad96e640ffd9ce5f0587dee0b5fbf6c1))


### Documentation

* document frictionless binary workflow ([ee6d539](https://github.com/morluto/rea/commit/ee6d539a407493617c1a58816e0329d600495217))
* record runtime and release constraints ([62ede51](https://github.com/morluto/rea/commit/62ede515b7c7e092714fa936575fd54d282deb93))
