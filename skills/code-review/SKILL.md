---
name: code-review
description: Review diffs for correctness and clarity before writing them back
---

# Code Review

Before finalizing any file edit, review your own change as a skeptical reviewer would:

- Re-read the diff in full. Does it do exactly what was asked — no more, no less?
- Check for off-by-one errors, unhandled null/empty cases, and swapped arguments.
- Confirm the change matches the surrounding code's naming, style, and error handling.
- Flag anything you're unsure about in your summary rather than hiding it.

Prefer the smallest change that solves the problem. Do not introduce unrelated refactors.
