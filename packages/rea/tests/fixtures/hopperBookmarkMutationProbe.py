"""Exercise bookmark mutation and exact readback at the Hopper bridge boundary."""

import json
from pathlib import Path
import sys


class FakeSegment:
    pass


class FakeDocument:
    def __init__(self):
        self.names = {}
        self.setter_calls = []
        self.rename_calls = []
        self.ignore_next_set = False
        self.ignore_next_rename = False
        self.default_name_on_omitted = False

    def getDocumentName(self):
        return "bookmark-fixture"

    def getExecutableFilePath(self):
        return "/tmp/rea-hopper-bookmark-fixture"

    def getDatabaseFilePath(self):
        return None

    def backgroundProcessActive(self):
        return False

    def getSegmentAtAddress(self, address):
        return FakeSegment() if address == 0x401000 else None

    def setBookmarkAtAddress(self, address, name=None):
        self.setter_calls.append((address, name))
        if self.ignore_next_set:
            self.ignore_next_set = False
            return True
        if address not in self.names:
            if name is None and self.default_name_on_omitted:
                self.names[address] = "provider-default"
            else:
                self.names[address] = "" if name == "" else name
        elif name is not None and name != "":
            self.names[address] = name
        # The native API return is not authoritative; the bridge reads state back.
        return False

    def renameBookmarkAtAddress(self, address, name):
        self.rename_calls.append((address, name))
        if self.ignore_next_rename:
            self.ignore_next_rename = False
            return False
        self.names[address] = None if name == "" else name
        return False

    def hasBookmarkAtAddress(self, address):
        return address in self.names

    def getBookmarkName(self, address):
        return self.names[address]

    def getBookmarks(self):
        return list(self.names)

    def removeBookmarkAtAddress(self, address):
        self.names.pop(address, None)
        return False


class FakeDocumentProvider:
    document = FakeDocument()

    @classmethod
    def getAllDocuments(cls):
        return [cls.document]

    @classmethod
    def getCurrentDocument(cls):
        return cls.document


def main():
    bridge_path = sys.argv[1]
    namespace = {"__file__": bridge_path, "__name__": "rea_hopper_bridge"}
    source = Path(bridge_path).read_text(encoding="utf-8")
    exec(compile(source, bridge_path, "exec"), namespace)
    namespace["REA_TARGET_PATH"] = FakeDocumentProvider.document.getExecutableFilePath()
    namespace["_configure_hopper_api"](FakeDocumentProvider)
    namespace["_bind_session_document"]()
    dispatch = namespace["_dispatch"]
    address = "0x401000"
    document = FakeDocumentProvider.document

    fresh_empty_result = dispatch("set_bookmark", {"address": address, "name": ""})
    fresh_empty_listing = dispatch("list_bookmarks", {})
    fresh_empty_raw_name = document.getBookmarkName(0x401000)
    dispatch("unset_bookmark", {"address": address})

    document.default_name_on_omitted = True
    default_named_omitted_result = dispatch("set_bookmark", {"address": address})
    default_named_omitted_listing = dispatch("list_bookmarks", {})
    dispatch("unset_bookmark", {"address": address})
    document.default_name_on_omitted = False

    fresh_omitted_result = dispatch("set_bookmark", {"address": address})
    fresh_omitted_listing = dispatch("list_bookmarks", {})
    dispatch("unset_bookmark", {"address": address})

    named_creation_result = dispatch(
        "set_bookmark", {"address": address, "name": "initial-name"}
    )
    clear_result = dispatch("set_bookmark", {"address": address, "name": ""})
    clear_listing = dispatch("list_bookmarks", {})
    renamed_result = dispatch(
        "set_bookmark", {"address": address, "name": "replacement-name"}
    )
    replacement_listing = dispatch("list_bookmarks", {})
    setter_calls_before_omitted = len(document.setter_calls)
    omitted_result = dispatch("set_bookmark", {"address": address})
    setter_calls_after_omitted = len(document.setter_calls)
    omitted_listing = dispatch("list_bookmarks", {})

    document.ignore_next_set = True
    ignored_set_result = dispatch(
        "set_bookmark", {"address": address, "name": "ignored-name"}
    )
    ignored_set_listing = dispatch("list_bookmarks", {})

    document.ignore_next_rename = True
    failed_clear_result = dispatch("set_bookmark", {"address": address, "name": ""})
    failed_clear_listing = dispatch("list_bookmarks", {})

    rename_method = document.renameBookmarkAtAddress
    document.renameBookmarkAtAddress = None
    missing_rename = None
    try:
        dispatch("set_bookmark", {"address": address, "name": ""})
    except Exception as error:
        missing_rename = {
            "type": type(error).__name__,
            "diagnostic_type": namespace["_diagnostic_type"](error),
        }
    document.renameBookmarkAtAddress = rename_method
    preserved_after_missing_rename = dispatch("list_bookmarks", {})
    unset_result = dispatch("unset_bookmark", {"address": address})
    after_unset = dispatch("list_bookmarks", {})

    missing_apis = []
    for operation, api in [
        ("list_bookmarks", "getBookmarks"),
        ("unset_bookmark", "hasBookmarkAtAddress"),
        ("unset_bookmark", "removeBookmarkAtAddress"),
    ]:
        original = getattr(document, api)
        setattr(document, api, None)
        try:
            dispatch(operation, {"address": address} if operation == "unset_bookmark" else {})
        except Exception as error:
            missing_apis.append({
                "api": api,
                "diagnostic_type": namespace["_diagnostic_type"](error),
                "message": str(error),
            })
        finally:
            setattr(document, api, original)

    print(json.dumps({
        "missing_apis": missing_apis,
        "fresh_empty": {
            "result": fresh_empty_result,
            "listing": fresh_empty_listing,
            "raw_name": fresh_empty_raw_name,
        },
        "fresh_omitted": {
            "result": fresh_omitted_result,
            "listing": fresh_omitted_listing,
        },
        "default_named_omitted": {
            "result": default_named_omitted_result,
            "listing": default_named_omitted_listing,
        },
        "named_creation_result": named_creation_result,
        "empty_clear": {"result": clear_result, "listing": clear_listing},
        "nonempty_replacement": {"result": renamed_result, "listing": replacement_listing},
        "omitted_existing": {
            "result": omitted_result,
            "setter_calls_before": setter_calls_before_omitted,
            "setter_calls_after": setter_calls_after_omitted,
            "listing": omitted_listing,
        },
        "ignored_setter": {"result": ignored_set_result, "listing": ignored_set_listing},
        "failed_clear": {"result": failed_clear_result, "listing": failed_clear_listing},
        "missing_rename": missing_rename,
        "preserved_after_missing_rename": preserved_after_missing_rename,
        "unset": {"result": unset_result, "listing": after_unset},
        "rename_calls": [[hex(item[0]), item[1]] for item in document.rename_calls],
    }, sort_keys=True))


if __name__ == "__main__":
    main()
