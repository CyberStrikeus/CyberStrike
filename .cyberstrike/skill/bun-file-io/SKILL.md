---
name: bun-file-io
description: Use this when you are working on file operations like reading, writing, scanning, or deleting files. It summarizes the preferred file APIs and patterns used in this repo. It also notes when to use filesystem helpers for directories.
sha256: 604669713cb065f38e73ad63edb6d5ef3f203ed4dabfc7c14e6cc98a4b644c4b
signature: 95VrHoJaF6San27XXZRu+1g0/xB6Wa+lExnAPbapE1yC/5Pjy5BhFUGTh9k6puGstjVy4bmqp/lyTNekxKrhDA==
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
