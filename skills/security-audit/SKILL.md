---
name: security-audit
description: Path and command hygiene checks on every file and shell action
---

# Security Audit

When touching the filesystem or running shell commands, apply these checks:

- Never write outside the workspace unless the task explicitly requires it and it is approved.
- Treat paths under `.ssh`, `.gemini`, credential stores, and dotfiles as off-limits.
- Avoid destructive commands (`rm -rf`, `dd`, `mkfs`) unless unambiguously required and confirmed.
- Never echo secrets, API keys, or tokens into logs or command output.
- Prefer read-only inspection first; escalate to writes only once the plan is clear.
