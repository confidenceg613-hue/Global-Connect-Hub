# PhoneLink — Offline AI Chatbot

100% on-device AI assistant for location history analysis. No cloud, no internet required after the model is downloaded.

---

## Architecture

```
artifacts/mobile/
├── lib/
│   ├── db/
│   │   ├── schema.ts          # SQLite DDL + TypeScript types
│   │   ├── database.ts        # expo-sqlite singleton + helpers
│   │   └── location-repo.ts   # All data queries + RAG doc builders
│   ├── ai/
│   │   ├── bm25.ts            # BM25Okapi retrieval engine (pure JS)
│   │   ├── embeddings.ts      # Trigram hash embeddings + re-ranking
│   │   ├── intent.ts          # Keyword-based query intent classifier
│   │   ├── prompts.ts         # System prompts + context formatters
│   │   ├── llm.ts             # llama.rn streaming wrapper
│   │   ├── model-manager.ts   # Download / load / release lifecycle
│   │   ├── rag.ts             # Full RAG pipeline (retrieve→augment→generate)
│   │   ├── app-actions.ts     # AI-commanded app action dispatcher
│   │   └── sync.ts            # API → local SQLite sync
│   └── utils/
│       └── geo.ts             # Haversine distance, date helpers
├── components/chat/
│   ├── ChatScreen (app/(tabs)/chat.tsx)   # Top-level screen
│   ├── MessageBubble.tsx      # Markdown-rendering message bubble
│   ├── InputBar.tsx           # Text input + send/stop buttons
│   ├── ModelLoader.tsx        # Download progress + model selection
│   └── QuickChips.tsx         # Suggested query shortcuts
```

---

## Data pipeline

```
API Server (when online)
        │
        ▼ sync.ts (fetch /api/location/history/:token)
        │
        ▼ SQLite: location_points table
        │
        ▼ location-repo.ts: buildDaySummaries()
        │
        ▼ SQLite: rag_documents table (pre-formatted text chunks)
        │
        ▼ BM25Engine.search() + trigram rerank
        │
        ▼ Top-K context chunks → prompt
        │
        ▼ llama.rn → on-device LLM → streamed tokens → ChatScreen
```

---

## Retrieval approach

| Layer | Algorithm | Purpose |
|-------|-----------|---------|
| Primary | BM25 Okapi | Fast keyword retrieval over location text |
| Secondary | Trigram hash embeddings + cosine similarity | Semantic re-ranking of BM25 candidates |
| Date filter | SQLite WHERE clause | Timeframe scoping (today / week / month) |
| Recency boost | Exponential decay (half-life 21 days) | Prefer recent location data |

The hybrid BM25 + embedding approach gives near-vector-search quality with zero native deps — it runs in < 5 ms even on 10,000 documents.

---

## Supported query types

| Query example | Intent | Data source |
|---|---|---|
| "Where was I this week?" | `location_summary` | `rag_documents` (day type) |
| "Analyze my patterns" | `pattern_analysis` | `location_points` aggregate stats |
| "How far did I travel?" | `distance_query` | `rag_documents` (day type) |
| "What's my morning routine?" | `pattern_analysis` | Hour distribution stats |
| "Show my notes" | `note_query` | `rag_documents` (note type) |
| "Start tracking" | `app_action` | Calls `LocationTrackingContext.startTracking` |
| "Create a note: coffee meeting" | `app_action` | Saves to `notes` table |

---

## Recommended models

| Model | Size | Speed | Quality |
|---|---|---|---|
| **SmolLM2 1.7B Q4_K_M** ← default | ~1.1 GB | ~20 tok/s on iPhone 15 | ⭐⭐⭐⭐ |
| Qwen 2.5 1.5B Q4_K_M | ~1.0 GB | ~22 tok/s | ⭐⭐⭐⭐ |
| Gemma 2 2B Q4_K_M | ~1.5 GB | ~15 tok/s | ⭐⭐⭐⭐⭐ |

Download happens once, stored in the app's private document directory. Models survive app updates and are never backed up to iCloud/Google Drive.

---

## Build requirements

The app requires a **development build** (not Expo Go) because `llama.rn` ships native C++ code.

```bash
# Install EAS CLI
npm install -g eas-cli

# Build for iOS simulator
eas build --platform ios --profile development --local

# Build for Android device
eas build --platform android --profile development --local
```

Or use `expo run:ios` / `expo run:android` from the `artifacts/mobile` directory.

---

## Performance optimizations

1. **n_threads: 4** — matches typical mobile core count; avoids thermal throttle
2. **n_ctx: 2048** — generous but not excessive; keeps VRAM/RAM usage bounded
3. **n_batch: 512** — prompt evaluation batch size; tune down to 256 on low-RAM devices
4. **Singleton context** — model stays loaded between queries; reload only on explicit user action
5. **BM25 in-memory** — rebuilt each query from SQLite; fast for < 50k docs
6. **Streaming tokens** — UI updates at 60 fps via React state batching
7. **AbortController** — immediate stop without waiting for llama.rn completion
8. **WAL journal mode** — SQLite write-ahead logging for non-blocking concurrent reads

---

## Privacy model

- All location data is stored in `expo-file-system`'s `documentDirectory` — sandboxed, not accessible to other apps
- No analytics, telemetry, or crash reporting touches the AI module
- The GGUF model file is stored in `<documentDirectory>/phonelink_models/` — excluded from iCloud backup by Expo's default behaviour
- Network access is used **only** for the initial model download from HuggingFace and optional API sync; both are opt-in
