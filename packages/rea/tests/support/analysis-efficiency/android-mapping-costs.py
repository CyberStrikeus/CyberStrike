"""Count complete mapping tasks; estimates are not model billing or host rendering."""
import argparse
import hashlib
import json
from pathlib import Path

import tiktoken


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def inspect(path, encoding):
    summary = json.loads((path / "summary.json").read_text())
    catalog = json.loads((path / "catalog.json").read_text())
    calls = json.loads((path / "calls.json").read_text())
    assert len(calls) == summary["calls"] == sum(run["calls"] for run in summary["runs"])
    assert all(not call["result"].get("isError") for call in calls)
    inputs = [{key: tool[key] for key in ["name", "description", "inputSchema"]}
              for tool in catalog["tools"]]
    count = lambda text: len(encoding.encode(text, disallowed_special=()))
    question = ("Inspect the selected Android class inventories and requested method bodies "
                "using the caller-selected local R8 mapping. Preserve raw DEX identities, "
                "original mapping-derived types, APK and mapping SHA-256, and uncertainty.")
    offset, runs = 0, []
    facts = []
    for run in summary["runs"]:
        selected = calls[offset:offset + run["calls"]]
        offset += run["calls"]
        args = sum(count(compact({"name": call["name"], "arguments": call["arguments"]}))
                   for call in selected)
        text = sum(count(block["text"]) for call in selected for block in call["result"]["content"]
                   if block["type"] == "text")
        wire = [{key: call[key] for key in ["name", "arguments", "result"]} for call in selected]
        runs.append({**run, "question_tokens": count(question),
                     "input_catalog_once_tokens": count(compact(inputs)),
                     "argument_tokens": args, "text_reply_tokens": text,
                     "whole_task_text_tokens": count(question) + count(compact(inputs)) + args + text,
                     "sdk_catalog_and_calls_tokens": count(compact({"catalog": catalog, "calls": wire}))})
        normalized = [call["result"]["structuredContent"]["normalized_result"]
                      for call in selected if call["name"] != "export_evidence_bundle"]
        facts.append([value["summary"] if value.get("kind") == "summary" else value for value in normalized])
    return {**summary, "case": str(path), "runs": runs,
            "normalized_fact_sha256": hashlib.sha256(compact(facts).encode()).hexdigest(),
            "receipts_sha256": {name: hashlib.sha256((path / name).read_bytes()).hexdigest()
                                for name in ["catalog.json", "calls.json", "summary.json"]}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("cases", type=Path, nargs="+")
    args = parser.parse_args()
    encoding = tiktoken.get_encoding("o200k_base")
    records = [inspect(path, encoding) for path in args.cases]
    args.output.write_text(json.dumps({"tokenizer": f"tiktoken {tiktoken.__version__}",
        "encoding": encoding.name,
        "scope": "Each run counts a fixed question, discovered input catalog once, all arguments and text replies, including proof exports when selected. SDK totals additionally count output schemas and structuredContent duplicates. Summary runs verify complete parent Evidence in the exported bundle. Model billing, hidden prompts, catalog pruning and replay are unmeasured.",
        "actual_model_usage": None, "records": records}, indent=2) + "\n")


if __name__ == "__main__":
    main()
