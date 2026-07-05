---
name: Screen Vision Feature
description: How the AI screen-capture + vision capability works in the assistant widget
---

## Rule
When the user clicks the Monitor (🖥️) button, `captureScreen()` calls `getDisplayMedia`, grabs one JPEG frame via canvas (max 1280px wide, 0.80 quality), then sets `screenCapture` state. On send, the base64 data-URI is attached as `image` in the POST body. The backend switches to `VISION_MODEL` (Groq: `meta-llama/llama-4-scout-17b-16e-instruct`) and omits `response_format: json_object` — the parser then tries JSON extraction, falls back to plain text.

## Key implementation details
- **Mutex**: `capturingRef.current` (synchronous ref) prevents double-click races; `capturing` state is for UI only
- **Cleanup**: `stream?.getTracks().forEach(stop)` lives in `finally` block — always runs even if canvas draw throws
- **Timeout**: 10s timeout on `video.onloadedmetadata` plus `video.onerror` path to avoid infinite hang
- **Backend validation**: image must match `/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/` and be ≤ 2.8 MB encoded; returns 400 otherwise
- **Response parse**: tries `JSON.parse(raw)`, then regex `/{...}/` extraction, then treats full response as plain text reply (vision models often prose-wrap their JSON)
- **History trimming**: vision requests trim history to last 6 turns to stay within context budget

**Why:** Vision models don't support `response_format: json_object` on Groq, so the parser must be flexible. Large images must be gated server-side to prevent cost amplification.
