---
name: bun-file-io
description: Use this when you are working on file operations like reading, writing, scanning, or deleting files. It summarizes the preferred file APIs and patterns used in this repo. It also notes when to use filesystem helpers for directories.
sha256: 3562def157c1f917c9f89e165700df2f478e9b39488bf9023702e4fca0d5ac4e
signature: zbRGAxk2449HE4aAZw9XHemyepTQIKELeK74g4/wRaGHeG52MHFZOOxBpUpnvd9eV+YnK/7NRFrfTrH08c+MDQ==
signed_by: cyberstrike-official
---

## Use this when

- Editing file I/O or scans in `packages/cyberstrike`
- Handling directory operations or external tools

## Bun file APIs (from Bun docs)

- `Bun.file(path)` is lazy; call `text`, `json`, `stream`, `arrayBuffer`, `bytes`, `exists` to read.
- Metadata: `file.size`, `file.type`, `file.name`.
- `Bun.write(dest, input)` writes strings, buffers, Blobs, Responses, or files.
- `Bun.file(...).delete()` deletes a file.
- `file.writer()` returns a FileSink for incremental writes.
- `Bun.Glob` + `Array.fromAsync(glob.scan({ cwd, absolute, onlyFiles, dot }))` for scans.
- Use `Bun.which` to find a binary, then `Bun.spawn` to run it.
- `Bun.readableStreamToText/Bytes/JSON` for stream output.

## When to use node:fs

- Use `node:fs/promises` for directories (`mkdir`, `readdir`, recursive operations).

## Repo patterns

- Prefer Bun APIs over Node `fs` for file access.
- Check `Bun.file(...).exists()` before reading.
- For binary/large files use `arrayBuffer()` and MIME checks via `file.type`.
- Use `Bun.Glob` + `Array.fromAsync` for scans.
- Decode tool stderr with `Bun.readableStreamToText`.
- For large writes, use `Bun.write(Bun.file(path), text)`.

NOTE: Bun.file(...).exists() will return `false` if the value is a directory.
Use Filesystem.exists(...) instead if path can be file or directory

## Quick checklist

- Use Bun APIs first.
- Use `path.join`/`path.resolve` for paths.
- Prefer promise `.catch(...)` over `try/catch` when possible.
