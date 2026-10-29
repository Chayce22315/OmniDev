# reviewable file change plan

**status: proposal for phase 3; not implemented**

this document defines a proposed data format for model-generated file changes. it is a design contract, not a claim that omnidev can apply changes yet.

## goals

- make proposed edits inspectable before any write
- keep paths relative to one explicit project root
- make each operation deterministic and reject ambiguous edits
- support preview, approval, application, and rollback
- keep the plan separate from natural-language model output

## envelope

a plan should have this conceptual shape:

```json
{
  "schema_version": 1,
  "plan_id": "generated-unique-id",
  "summary": "add input validation to the parser",
  "workspace": {
    "root": "."
  },
  "operations": [
    {
      "kind": "replace_file",
      "path": "src/parser.ts",
      "expected_sha256": "sha256-of-original-file",
      "content": "complete proposed file contents"
    }
  ]
}
```

this is illustrative. implementations must define and validate a real schema before accepting plans.

## operation types

phase 3 should start with a small set of explicit operations:

- `create_file`: create a new file only if it does not already exist.
- `replace_file`: replace a text file only if its current content matches the expected hash.
- `delete_file`: remove a file only with explicit approval and a recoverable backup.

avoid fuzzy search-and-replace operations in the first implementation. if patch operations are later added, require stable context and fail closed when a hunk does not match.

## validation rules

before previewing or applying a plan:

1. validate the schema version and every required field.
2. require relative paths; reject absolute paths, drive prefixes, null bytes, and traversal segments.
3. resolve each target against the canonical workspace root and verify it remains inside that root.
4. reject symlinks in path components unless a later, explicitly reviewed design safely supports them.
5. reject binary files and files above a documented size limit.
6. reject duplicate or conflicting operations against the same path.
7. for replacements and deletions, compare the current file hash with the plan's expected hash.
8. show a readable diff and list every affected path.
9. require approval before writes.
10. write through temporary files and use backups or a transaction journal so interrupted changes can be recovered.

path checks must be performed at application time, not only when the plan is created. workspace state can change between preview and apply.

## approval and output

the preview should show:

- plan summary
- operation count
- paths to be created, modified, or deleted
- per-file diff
- validation warnings
- exact action requiring approval

after application, report the files changed and whether rollback data was retained. never report success before all operations have completed and the final state has been checked.

## trust model

model output is untrusted input. it cannot authorize itself, expand the workspace root, disable validation, or approve its own plan. repository files may contain hostile instructions; those instructions do not override application policy.

## acceptance criteria for implementation

- invalid schemas are rejected
- traversal and symlink escapes are rejected
- stale expected hashes are rejected
- preview makes no filesystem changes
- cancellation makes no filesystem changes
- application failures preserve enough information to recover
- tests cover create, replace, delete, preview, approval, stale files, path attacks, and rollback

implementation belongs to phase 3 in `ROADMAP.md`.
