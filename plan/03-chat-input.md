# 03 — Chat Input: Shift+Enter & Auto-Expanding Textarea

## Problem

The chat input currently uses Shadcn's `<Input>` component, which renders as a single-line `<input type="text">` element. This has two issues:

1. **No Shift+Enter support** — Pressing Enter submits the form; there's no way to insert a newline
2. **No auto-expand** — The input is a fixed 44px height; long messages require horizontal scrolling

## Root Cause

The `<Input>` component (from `@base-ui/react/input`) is designed for single-line text input. The code at `page.js` line ~1513:

```javascript
<Input 
  value={prompt}
  onChange={(e) => setPrompt(e.target.value)}
  onKeyDown={(e) => e.key === "Enter" && ... && handleSubmitPrompt()}
  ...
/>
```

There's no multi-line support whatsoever.

## Solution

### Replace `<Input>` with `<textarea>`

Replace the Shadcn `<Input>` with a native `<textarea>` element styled to match the current input appearance.

### Behavior

| Key Combo | Action |
|-----------|--------|
| `Enter` | Submit the message |
| `Shift+Enter` | Insert newline in the textarea |
| `Ctrl+Enter` | Submit (alternative) |

### Auto-Expand Logic

The textarea should:
- Start at ~44px height (matching current input)
- Auto-expand as the user types, up to a max of ~200px
- Scroll within the textarea if content exceeds max height
- Shrink back when content is removed (reset to min height)

### Implementation

```javascript
// Auto-grow textarea
const textareaRef = useRef(null);

const autoGrow = () => {
  const el = textareaRef.current;
  if (el) {
    el.style.height = "44px"; // reset to min
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }
};

// In the component:
<textarea
  ref={textareaRef}
  value={prompt}
  onChange={(e) => {
    setPrompt(e.target.value);
    autoGrow();
  }}
  onKeyDown={(e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmitPrompt();
    }
  }}
  rows={1}
  style={{
    flex: 1,
    borderRadius: "var(--radius-md)",
    minHeight: "44px",
    maxHeight: "200px",
    fontSize: "0.95rem",
    backgroundColor: "var(--input-bg)",
    color: "var(--text-main)",
    border: "1px solid var(--border-color)",
    padding: "10px 14px",
    resize: "none",
    overflowY: "auto",
    lineHeight: "1.5",
    fontFamily: "inherit"
  }}
  placeholder="Type your message..."
  disabled={status === "thinking" || status === "executing"}
/>
```

### Additional Feature: Input History

While we're at it, add command history:
- `Up Arrow` → recall previous prompts (like a terminal)
- `Down Arrow` → forward through history
- Store last N prompts in a ref array

## Files to Change

```
dashboard/src/app/page.js              # Replace Input with textarea
dashboard/src/components/ui/input.jsx  # No changes needed (keep for other uses)
```

## Implementation Order

1. Replace `<Input>` with `<textarea>` in page.js
2. Add auto-grow logic with ref
3. Add Shift+Enter / Enter key handling
4. Add input history (optional, nice-to-have)
5. Test with long messages

## References

See [reference.md](./reference.md) for Tailwind v4 styling patterns.
