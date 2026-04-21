#!/usr/bin/env python3
"""
MCP HTTP transport test harness for open-brain.

Start the server first:
    node mcp-server.js

Then run:
    python tests/test_mcp_http.py
    python tests/test_mcp_http.py --url http://localhost:3000
    python tests/test_mcp_http.py --verbose
"""

import argparse, json, os, sys, time, uuid
import requests
from dotenv import load_dotenv
load_dotenv()

DEFAULT_URL = "http://localhost:3000"
TIMEOUT = 15

def rpc(base_url, method, params=None, req_id=1, verbose=False):
    token = os.environ.get('MCP_AUTH_TOKEN', '')
    if verbose:
        print(f"token = {token}|")
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    payload = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}}
    resp = requests.post(f"{base_url}/mcp", json=payload,
                         headers=headers,
                         timeout=TIMEOUT, stream=True)
    resp.raise_for_status()
    if "text/event-stream" in resp.headers.get("content-type", ""):
        try:
            for line in resp.iter_lines():
                if line and line.startswith(b"data: "):
                    return json.loads(line[6:])
        finally:
            resp.close()
        raise ValueError("SSE stream ended with no data event")
    return resp.json()

class TestRunner:
    def __init__(self, base_url, verbose=False):
        self.base_url = base_url.rstrip("/")
        self.verbose = verbose
        self.passed = self.failed = 0
        self.test_tag = f"test-{uuid.uuid4().hex[:8]}"

    def ok(self, name): self.passed += 1; print(f"  ✓  {name}")
    def fail(self, name, reason): self.failed += 1; print(f"  ✗  {name}\n     → {reason}")
    def show(self, label, data):
        if self.verbose: print(f"     {label}: {json.dumps(data, indent=2)}")

    def test_health(self):
        try:
            r = requests.get(f"{self.base_url}/health", timeout=TIMEOUT)
            r.raise_for_status()
            body = r.json()
            self.show("health", body)
            assert body.get("status") == "ok"
            self.ok("health check")
        except Exception as e: self.fail("health check", str(e))

    def test_tools_list(self):
        expected = {"search_memory", "store_memory", "list_recent"}
        try:
            data = rpc(self.base_url, "tools/list", verbose=self.verbose)
            self.show("tools/list", data)
            tools = {t["name"] for t in data.get("result", {}).get("tools", [])}
            missing = expected - tools
            if missing: self.fail("tools/list", f"missing: {missing}")
            else: self.ok(f"tools/list — {', '.join(sorted(tools))}")
        except Exception as e: self.fail("tools/list", str(e))

    def test_store_memory(self):
        content = f"HTTP transport smoke test [{self.test_tag}]"
        try:
            data = rpc(self.base_url, "tools/call",
                       {"name": "store_memory",
                        "arguments": {"content": content, "source": "test-harness"}})
            self.show("store_memory", data)
            text = data.get("result", {}).get("content", [{}])[0].get("text", "")
            assert "error" not in text.lower(), f"error in response: {text}"
            self.ok("store_memory")
            return True
        except Exception as e:
            self.fail("store_memory", str(e))
            return False

    def test_search_memory(self, stored):
        if not stored:
            self.fail("search_memory", "skipped — store_memory failed")
            return
        time.sleep(1)
        try:
            data = rpc(self.base_url, "tools/call",
                       {"name": "search_memory",
                        "arguments": {"query": f"HTTP transport smoke test {self.test_tag}", "limit": 5}})
            self.show("search_memory", data)
            text = data.get("result", {}).get("content", [{}])[0].get("text", "")
            assert self.test_tag in text, f"tag not found in: {text[:300]}"
            self.ok("search_memory — retrieved stored memory")
        except Exception as e: self.fail("search_memory", str(e))

    def test_list_recent(self):
        try:
            data = rpc(self.base_url, "tools/call",
                       {"name": "list_recent", "arguments": {"days": 1}})
            self.show("list_recent", data)
            text = data.get("result", {}).get("content", [{}])[0].get("text", "")
            parsed = json.loads(text)
            assert isinstance(parsed, list)
            self.ok(f"list_recent — {len(parsed)} entries")
        except Exception as e: self.fail("list_recent", str(e))

    def run(self):
        print(f"\nopen-brain MCP HTTP test harness")
        print(f"target : {self.base_url}")
        print(f"run tag: {self.test_tag}")
        print("─" * 48)
        self.test_health()
        self.test_tools_list()
        stored = self.test_store_memory()
        self.test_search_memory(stored)
        self.test_list_recent()
        print("─" * 48)
        print(f"results: {self.passed} passed, {self.failed} failed\n")
        return self.failed == 0

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    sys.exit(0 if TestRunner(args.url, args.verbose).run() else 1)

if __name__ == "__main__":
    main()