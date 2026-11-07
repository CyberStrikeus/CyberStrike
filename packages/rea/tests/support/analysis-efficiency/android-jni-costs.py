"""Estimate complete JNI task context; these counts are not model billing."""
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
    qualifications = summary.get("qualifications", [])
    task_calls = sum(run["calls"] for run in summary["runs"])
    assert len(calls) == summary["calls"] == task_calls + sum(row["calls"] for row in qualifications)
    assert summary.get("task_calls", task_calls) == task_calls
    assert all(not call["result"].get("isError") for call in calls)
    count = lambda value: len(encoding.encode(value, disallowed_special=()))
    inputs = [{key: tool[key] for key in ("name", "description", "inputSchema")} for tool in catalog["tools"]]
    question = count(summary["question"])
    discovery = count(compact(inputs))
    offset = 0
    runs = []
    def costs(selected, prompt, catalog_tokens):
        args = sum(count(compact({"name": call["name"], "arguments": call["arguments"]})) for call in selected)
        replies = sum(count(block["text"]) for call in selected for block in call["result"]["content"] if block["type"] == "text")
        return {"question_tokens": count(prompt), "input_catalog_tokens": catalog_tokens,
                "argument_tokens": args, "all_text_reply_tokens": replies,
                "text_tokens": count(prompt) + catalog_tokens + args + replies}
    for run in summary["runs"]:
        selected = calls[offset:offset + run["calls"]]
        offset += run["calls"]
        assert all(call.get("phase", "task") == "task" for call in selected)
        measured = costs(selected, summary["question"], discovery)
        wire = [{key: call[key] for key in ("name", "arguments", "result")} for call in selected]
        runs.append({**run, "question_tokens": question, "input_catalog_once_tokens": discovery,
                     "argument_tokens": measured["argument_tokens"], "all_text_reply_tokens": measured["all_text_reply_tokens"],
                     "whole_task_text_tokens": measured["text_tokens"],
                     "sdk_catalog_and_calls_tokens": count(compact({"catalog": catalog, "calls": wire}))})
    qualified = []
    for row in qualifications:
        assert row["first_call"] == offset
        selected = calls[offset:offset + row["calls"]]
        offset += row["calls"]
        assert all(call["phase"] == "qualification" for call in selected)
        qualified.append({**row, **costs(selected, row["question"], 0),
                          "catalog_scope": "Reuses already discovered catalog; incremental qualification costs, separate from investigation tasks."})
    assert offset == len(calls)
    receipt_paths = ["summary.json", "catalog.json", "calls.json"]
    parity = path / "cli-parity.json"
    cli = None
    if parity.exists():
        data = json.loads(parity.read_text())
        receipt_paths.append(parity.name)
        for name in ["cli-stdout.json", "cli-stderr.log"]:
            if (path / name).exists():
                receipt_paths.append(name)
        cli = {"elapsed_ms": data["elapsed_ms"], "fact_digest": data["fact_digest"],
               "response_tokens": count((path / "cli-stdout.json").read_text()) if (path / "cli-stdout.json").exists() else count(compact(data["response"])),
               "scope": "Separate single cold CLI parity check; not added to the MCP task/token totals."}
    wire = [{key: call[key] for key in ("name", "arguments", "result")} for call in calls]
    return {**summary, "case": str(path), "runs": runs, "qualifications": qualified, "cli_parity": cli,
            "all_recorded_sdk_catalog_and_calls_tokens": count(compact({"catalog": catalog, "calls": wire})),
            "receipts_sha256": {name: hashlib.sha256((path / name).read_bytes()).hexdigest() for name in receipt_paths}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("cases", nargs="+", type=Path)
    args = parser.parse_args()
    encoding = tiktoken.get_encoding("o200k_base")
    records = [inspect(path, encoding) for path in args.cases]
    args.output.write_text(json.dumps({
        "tokenizer": f"tiktoken {tiktoken.__version__}", "encoding": encoding.name,
        "scope": "Each completed run counts its fixed analyst question, discovered input catalog once, every argument and text reply, including pages and proof-export receipts. SDK totals additionally count output schemas and structuredContent duplicates. Full exported files are verified locally, not charged as agent context unless returned inline. Startup/discovery and final cleanup wall time are separate; outer resource receipts include CPU and process-family memory. Actual billing, hidden prompts, host rendering and pruning are unmeasured.",
        "baseline": "Earlier main lacks this JNI batch/table capability; manual export lookup has unequal coverage and is not an equivalent before workflow.",
        "actual_model_usage": None, "records": records,
    }, indent=2) + "\n")


if __name__ == "__main__":
    main()
