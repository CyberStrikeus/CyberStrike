"""Catch typed resource failures while loading or running the owned recorded-core adapter.

Only this package's fixed sibling is executed; caller input stays in request.json.
Interpreter startup failures before this boundary remain unclassified.
"""
import os
import sys


def resource_exit(status, marker):
    try:
        if len(sys.argv) > 2:
            descriptor = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.write(descriptor, marker)
            os.close(descriptor)
    except (OSError, MemoryError):
        # Without a complete marker the parent keeps this failure unclassified.
        pass
    os._exit(status)

try:
    implementation = os.path.join(os.path.dirname(__file__), "recorded_crash_impl.py")
    with open(implementation, "rb") as handle:
        source = handle.read()
    exec(compile(source, implementation, "exec"), {
        "__file__": implementation,
        "__name__": "__main__",
    })
except MemoryError:
    # Reserved status: an observed allocation failure, including imports/compile.
    resource_exit(75, b"M")
except OSError as error:
    # Linux ENOMEM is an observed allocation failure, independent of error text.
    if error.errno == 12:
        resource_exit(75, b"M")
    # Linux EFBIG is observed directly, including a partial limits/reply write.
    if error.errno == 27:
        resource_exit(76, b"F")
    raise
