// Golden projection of Ghidra 12.1.4 list_procedures/list_names on macOS arm64.
// Source: tests/conformance/swift/type-inventory.swift, compiled with swiftc -O -g.
// Includes selected procedure entries, all their symbols, and an off-entry metadata symbol.
export const GHIDRA_SWIFT_INVENTORY = {
  procedures: [
    {
      address: "0x100000858",
      value: "entry",
      procedure: {
        external: false,
        thunk: false,
        thunk_target: null,
      },
    },
    {
      address: "0x100000954",
      value: "main::Pair::init",
      procedure: {
        external: false,
        thunk: false,
        thunk_target: null,
      },
    },
    {
      address: "0x100000958",
      value: "main::$swiftIndirect",
      procedure: {
        external: false,
        thunk: false,
        thunk_target: null,
      },
    },
    {
      address: "0x1000009bc",
      value: "main::Pair::set_a",
      procedure: {
        external: false,
        thunk: false,
        thunk_target: null,
      },
    },
    {
      address: "0x100000a28",
      value: "main::Scorer::$score",
      procedure: {
        external: false,
        thunk: false,
        thunk_target: null,
      },
    },
    {
      address: "0x100000ab4",
      value: "main::Pair::typeMetadataAccessor",
      procedure: {
        external: false,
        thunk: false,
        thunk_target: null,
      },
    },
    {
      address: "0x100000ac4",
      value: "main::Scorer::typeMetadataAccessor",
      procedure: {
        external: false,
        thunk: false,
        thunk_target: null,
      },
    },
  ],
  symbols: [
    {
      address: "0x100000858",
      value: "_main",
      symbol: {
        primary: false,
        dynamic: false,
        external: false,
        type: "label",
        source: "imported",
      },
    },
    {
      address: "0x100000858",
      value: "entry",
      symbol: {
        primary: true,
        dynamic: false,
        external: false,
        type: "function",
        source: "imported",
      },
    },
    {
      address: "0x100000954",
      value: "_$s4main4PairV1a1bACSi_SitcfC",
      symbol: {
        primary: false,
        dynamic: false,
        external: false,
        type: "label",
        source: "imported",
      },
    },
    {
      address: "0x100000954",
      value: "_$s4main4PairV1aSivM.resume.0",
      symbol: {
        primary: false,
        dynamic: false,
        external: false,
        type: "label",
        source: "imported",
      },
    },
    {
      address: "0x100000954",
      value: "_$s4main4PairV1aSivg",
      symbol: {
        primary: false,
        dynamic: false,
        external: false,
        type: "label",
        source: "imported",
      },
    },
    {
      address: "0x100000954",
      value: "_$s4main4PairV1bSivM.resume.0",
      symbol: {
        primary: false,
        dynamic: false,
        external: false,
        type: "label",
        source: "imported",
      },
    },
    {
      address: "0x100000954",
      value: "_$s4main6ScorerVACycfC",
      symbol: {
        primary: false,
        dynamic: false,
        external: false,
        type: "label",
        source: "imported",
      },
    },
    {
      address: "0x100000954",
      value: "main::Pair::init",
      symbol: {
        primary: true,
        dynamic: false,
        external: false,
        type: "function",
        source: "analysis",
      },
    },
    {
      address: "0x100000958",
      value: "_$s4main13swiftIndirectySiAA7Scoring_p_SitF",
      symbol: {
        primary: false,
        dynamic: false,
        external: false,
        type: "label",
        source: "imported",
      },
    },
    {
      address: "0x100000958",
      value: "main::$swiftIndirect",
      symbol: {
        primary: true,
        dynamic: false,
        external: false,
        type: "function",
        source: "analysis",
      },
    },
    {
      address: "0x1000009bc",
      value: "_$s4main4PairV1aSivs",
      symbol: {
        primary: false,
        dynamic: false,
        external: false,
        type: "label",
        source: "imported",
      },
    },
    {
      address: "0x1000009bc",
      value: "main::Pair::set_a",
      symbol: {
        primary: true,
        dynamic: false,
        external: false,
        type: "function",
        source: "analysis",
      },
    },
    {
      address: "0x100000a28",
      value: "_$s4main6ScorerV5scoreyS2iFTf4nd_n",
      symbol: {
        primary: false,
        dynamic: false,
        external: false,
        type: "label",
        source: "imported",
      },
    },
    {
      address: "0x100000a28",
      value: "main::Scorer::$score",
      symbol: {
        primary: true,
        dynamic: false,
        external: false,
        type: "function",
        source: "analysis",
      },
    },
    {
      address: "0x100000ab4",
      value: "_$s4main4PairVMa",
      symbol: {
        primary: false,
        dynamic: false,
        external: false,
        type: "label",
        source: "imported",
      },
    },
    {
      address: "0x100000ab4",
      value: "main::Pair::typeMetadataAccessor",
      symbol: {
        primary: true,
        dynamic: false,
        external: false,
        type: "function",
        source: "analysis",
      },
    },
    {
      address: "0x100000ac4",
      value: "_$s4main6ScorerVMa",
      symbol: {
        primary: false,
        dynamic: false,
        external: false,
        type: "label",
        source: "imported",
      },
    },
    {
      address: "0x100000ac4",
      value: "main::Scorer::typeMetadataAccessor",
      symbol: {
        primary: true,
        dynamic: false,
        external: false,
        type: "function",
        source: "analysis",
      },
    },
    {
      address: "0x100000c0c",
      value: "_$s4main4PairVMn",
      symbol: {
        primary: false,
        dynamic: false,
        external: false,
        type: "label",
        source: "imported",
      },
    },
  ],
};
