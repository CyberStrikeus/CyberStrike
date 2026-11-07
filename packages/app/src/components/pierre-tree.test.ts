import { expect, test } from "bun:test"
import { FileTree, type FileTreeDirectoryHandle } from "@pierre/trees"

test("reports directory expansion changes", () => {
  const changes: Array<{ path: string; expanded: boolean }> = []
  const opts: any = {
    paths: ["src/"],
    onExpansionChange: (change: { path: string; expanded: boolean }) => changes.push(change),
  }
  const tree = new FileTree(opts)

  const src = tree.getItem("src/")
  if (!src || !src.isDirectory()) throw new Error("Expected src to be a directory")
  const directory = src as FileTreeDirectoryHandle

  directory.expand()
  directory.collapse()

  expect(changes).toEqual([
    { path: "src/", expanded: true },
    { path: "src/", expanded: false },
  ])
  tree.cleanUp()
})
