# Foundation XML archive encoding fixture

`producer.swift` creates an actual NSKeyedArchiver XML representation, then
uses Foundation string encoding to produce BOM-marked UTF-16 little- and
big-endian representations of the same XML graph. Foundation's
PropertyListSerialization reads both representations successfully; `plutil
-lint` also accepts all three files.

```sh
xcrun swiftc producer.swift -o writer
./writer archive.xml little-endian.plist big-endian.plist
plutil -lint archive.xml little-endian.plist big-endian.plist
```

Only the UTF-8 XML source capture is committed. The tests encode its same text
as UTF-16 so no compiled binaries or binary fixtures are committed. This is
format/filesystem verification; no archived classes are instantiated by REA.
