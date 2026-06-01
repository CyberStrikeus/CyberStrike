#!/usr/bin/env python3
"""Race condition tester — send concurrent requests to detect TOCTOU vulnerabilities."""
import asyncio
import aiohttp
import argparse
import json
import sys
import time

async def send_request(session, method, url, headers, data, req_id):
    start = time.time()
    try:
        async with session.request(method, url, headers=headers, json=data if isinstance(data, dict) else None, data=data if isinstance(data, str) else None) as resp:
            body = await resp.text()
            elapsed = time.time() - start
            return {
                "id": req_id,
                "status": resp.status,
                "length": len(body),
                "elapsed_ms": round(elapsed * 1000, 2),
                "body_preview": body[:200],
            }
    except Exception as e:
        return {"id": req_id, "status": 0, "error": str(e), "elapsed_ms": round((time.time() - start) * 1000, 2)}

async def race(method, url, headers, data, count, delay_ms=0):
    connector = aiohttp.TCPConnector(limit=count, force_close=True)
    async with aiohttp.ClientSession(connector=connector) as session:
        if delay_ms > 0:
            tasks = []
            for i in range(count):
                tasks.append(send_request(session, method, url, headers, data, i))
                await asyncio.sleep(delay_ms / 1000)
        else:
            tasks = [send_request(session, method, url, headers, data, i) for i in range(count)]
        return await asyncio.gather(*tasks)

def main():
    parser = argparse.ArgumentParser(description="Race condition tester")
    parser.add_argument("url", help="Target URL")
    parser.add_argument("-m", "--method", default="POST", help="HTTP method (default: POST)")
    parser.add_argument("-H", "--header", action="append", default=[], help="Headers (key:value)")
    parser.add_argument("-d", "--data", default=None, help="Request body (JSON string)")
    parser.add_argument("-c", "--count", type=int, default=20, help="Number of concurrent requests (default: 20)")
    parser.add_argument("--delay", type=int, default=0, help="Delay between requests in ms (0 = all at once)")
    parser.add_argument("--json-output", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    headers = {}
    for h in args.header:
        k, v = h.split(":", 1)
        headers[k.strip()] = v.strip()

    data = None
    if args.data:
        try:
            data = json.loads(args.data)
        except json.JSONDecodeError:
            data = args.data

    results = asyncio.run(race(args.method, args.url, headers, data, args.count, args.delay))

    if args.json_output:
        print(json.dumps(results, indent=2))
    else:
        status_counts = {}
        for r in results:
            s = r.get("status", 0)
            status_counts[s] = status_counts.get(s, 0) + 1

        print(f"\n{'='*60}")
        print(f"RACE CONDITION TEST: {args.count} concurrent {args.method} requests")
        print(f"Target: {args.url}")
        print(f"{'='*60}")
        print(f"\nStatus distribution:")
        for status, count in sorted(status_counts.items()):
            print(f"  {status}: {count} responses")

        success = [r for r in results if 200 <= r.get("status", 0) < 300]
        if len(success) > 1:
            lengths = set(r.get("length", 0) for r in success)
            if len(lengths) == 1:
                print(f"\n[!] POTENTIAL RACE CONDITION: {len(success)} successful responses with identical length")
            else:
                print(f"\n[!] POTENTIAL RACE CONDITION: {len(success)} successful responses with varying lengths: {lengths}")
        else:
            print(f"\n[*] No race condition detected ({len(success)} success)")

        print(f"\nTiming range: {min(r['elapsed_ms'] for r in results):.1f}ms - {max(r['elapsed_ms'] for r in results):.1f}ms")

if __name__ == "__main__":
    main()
