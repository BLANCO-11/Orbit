# AegisAgent - Product Improvement Plan

> **Status:** Draft — Awaiting your approval before any code changes
> **Target:** Turning a debug console into a sellable product

## The Problems (as I see them)

After analyzing every line of the codebase, here's what's holding this back from being sellable:

### 🔴 Critical UX Issues
1. **The UI is a dev console, not a product** — Inline styles everywhere, mixed visual metaphors (retro TUI + glassmorphism + Shadcn), no coherent brand identity
2. **TTS fires only at the end** — The backend accumulates all text, then dumps it. The streaming TTS frontend code exists but isn't properly connected to real-time agent output
3. **Single-line input** — Uses `<Input>` which doesn't support Shift+Enter or auto-grow
4. **No onboarding** — First-time users see a blank chat with no guidance
5. **Settings crammed into a sidebar** — Security configs, model selection, TTS voice, and memory compaction all thrown together without hierarchy

### 🟡 Architecture Issues
6. **Inline styles in page.js** — ~2200 lines, almost all inline styles. Zero component decomposition
7. **Dashboard treated as git submodule** — The `m dashboard` in git status suggests it was cloned as a submodule, not integrated
8. **Session persistence works but has race conditions** — Fire-and-forget fetch to SQLite with localStorage fallback; no proper sync

### 🟢 Quick Wins
9. **Shift+Enter + auto-expanding input** — Small change, huge UX difference
10. **Streaming TTS** — The frontend code exists (`handleStreamingSpeech`) but the backend sends the full text on `agent_end` instead of emitting sentences as they arrive
11. **Session persistence is already partially built** — SQLite backend + localStorage fallback exist, just need hardening

---

## File Map

| File | Purpose |
|------|---------|
| [`01-ui-redesign.md`](./01-ui-redesign.md) | Complete UI overhaul strategy |
| [`02-tts-streaming.md`](./02-tts-streaming.md) | Fix TTS to stream in real-time |
| [`03-chat-input.md`](./03-chat-input.md) | Shift+Enter and auto-expanding textarea |
| [`04-session-persistence.md`](./04-session-persistence.md) | Harden session storage |
| [`05-sellable-product.md`](./05-sellable-product.md) | Productization roadmap |
| [`reference.md`](./reference.md) | Resource links and code references |

## How to Use

1. Read each plan file for details
2. I need your explicit **permission** before making any code changes
3. Each plan file is structured as: **Problem → Root Cause → Solution → Files to Change → Implementation Steps**
