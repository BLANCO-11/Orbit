---
name: workspace-snapshot
description: Checkpoint the workspace before a batch of edits
---

# Workspace Snapshot

Before a multi-file edit, establish a recovery point:

- Note the current git status and branch. If the tree is dirty in unrelated ways, say so before proceeding.
- Prefer a new branch for anything non-trivial rather than editing the default branch directly.
- After the edits, summarize exactly which files changed so the user can review or revert as one unit.
