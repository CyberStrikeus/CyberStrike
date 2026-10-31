"""Run every source-owned Python bridge and analysis-efficiency test."""

from pathlib import Path
import json
import subprocess
import sys
import unittest

root = Path(__file__).resolve().parent.parent
REQUIRED_BRIDGE_FAMILIES = ("mitmproxy", "native", "pwndbg")


def fail(code, **details):
    print(json.dumps({"code": code, **details}, sort_keys=True), file=sys.stderr)
    raise SystemExit(1)


class ExecutedResult(unittest.TextTestResult):
    """Record tests with a non-skipped test or subtest outcome."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.completed = set()
        self.active_test = None
        self.has_subtests = False

    def record(self, test):
        self.completed.add(test.id())

    def startTest(self, test):
        self.active_test = test
        self.has_subtests = False
        super().startTest(test)

    def stopTest(self, test):
        super().stopTest(test)
        self.active_test = None

    def addSuccess(self, test):
        # A parent with only skipped subtests also receives addSuccess.
        if not self.has_subtests:
            self.record(test)
        super().addSuccess(test)

    def addSubTest(self, test, subtest, outcome):
        self.has_subtests = True
        if outcome is None:
            self.record(test)
        super().addSubTest(test, subtest, outcome)

    def addSkip(self, test, reason):
        if self.active_test is not None and test is not self.active_test:
            self.has_subtests = True
        super().addSkip(test, reason)

    def addExpectedFailure(self, test, err):
        self.record(test)
        super().addExpectedFailure(test, err)


def run_bridge(modules):
    # The script directory is sys.path[0]; imports must resolve from the checkout.
    sys.path.insert(0, str(root))
    suite = unittest.defaultTestLoader.loadTestsFromNames(modules)
    result = unittest.TextTestRunner(verbosity=2, resultclass=ExecutedResult).run(suite)
    completed_families = {
        parts[1]
        for name in result.completed
        if len(parts := name.split(".")) > 2 and parts[0] == "bridge"
    }
    missing = [
        family
        for family in REQUIRED_BRIDGE_FAMILIES
        if family not in completed_families
    ]
    if missing:
        fail("no_executed_bridge_tests", families=missing)
    if not result.wasSuccessful():
        raise SystemExit(1)


def run_analysis_efficiency():
    # Match the checkout-root import path of `python -m unittest discover`.
    sys.path.insert(0, str(root))
    suite = unittest.defaultTestLoader.discover(
        str(root / "tests/support/analysis-efficiency"), pattern="test_*.py"
    )
    result = unittest.TextTestRunner(verbosity=2, resultclass=ExecutedResult).run(suite)
    if not result.wasSuccessful():
        raise SystemExit(1)
    if not result.completed:
        fail("no_executed_analysis_efficiency_tests")


bridge_root = root / "bridge"
bridge_tests = sorted(
    path for path in bridge_root.rglob("test_*.py") if path.is_file()
)
families = {path.relative_to(bridge_root).parts[0] for path in bridge_tests}
missing_families = [
    family for family in REQUIRED_BRIDGE_FAMILIES if family not in families
]
if missing_families:
    fail("missing_bridge_family", families=missing_families)
if not list(root.joinpath("tests/support/analysis-efficiency").glob("test_*.py")):
    fail("missing_analysis_efficiency_tests")
modules = [
    ".".join(path.relative_to(root).with_suffix("").parts) for path in bridge_tests
]
if sys.argv[1:] == ["--bridge"]:
    run_bridge(modules)
    raise SystemExit(0)
if sys.argv[1:] == ["--analysis-efficiency"]:
    run_analysis_efficiency()
    raise SystemExit(0)
if sys.argv[1:]:
    fail("invalid_python_test_arguments")
bridge_result = subprocess.run(
    [sys.executable, __file__, "--bridge"], cwd=root, check=False
)
if bridge_result.returncode:
    sys.exit(bridge_result.returncode)
result = subprocess.run(
    [sys.executable, __file__, "--analysis-efficiency"],
    cwd=root,
    check=False,
)
if result.returncode:
    sys.exit(result.returncode)
