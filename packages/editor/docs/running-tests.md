# Running Tests

## Prerequisites

```sh
# Install dependencies (from repo root)
pnpm install

# Install Playwright browsers (required for browser tests)
npx playwright install chromium
```

## Test Commands

All commands run from `packages/editor/`:

```sh
cd packages/editor
```

### Run all tests

```sh
pnpm test
```

Runs both browser tests (Playwright + Vitest) and unit tests.

### Run browser tests only

```sh
# All browser tests (chromium)
pnpm test:browser:chromium

# Watch mode — re-runs on file changes
pnpm test:browser:chromium:watch
```

Browser tests use `@vitest/browser-playwright` and run in headless Chromium. They include:

- `tests/` — Feature tests (suggesting state, events, paste, etc.)
- `gherkin-tests/` — BDD-style tests
- `src/editor/*.test.ts` — Editor core tests
- `src/plugins/*.test.tsx` — Plugin tests
- `src/internal-utils/slate-utils.test.tsx` — Utility tests
- `src/history/**/*.test.ts` — History/undo tests

### Run unit tests only

```sh
# Unit tests (jsdom environment)
pnpm test:unit

# Watch mode
pnpm test:unit:watch
```

Unit tests run in jsdom and include type-checking tests (`*.test-d.ts`).

### Run a specific test file

```sh
# Run only the suggesting state tests
npx vitest --run --project "browser (chromium)" tests/suggesting-state.test.tsx

# Watch a specific file
npx vitest --project "browser (chromium)" tests/suggesting-state.test.tsx
```

### Run tests matching a pattern

```sh
# Run tests whose name matches "suggesting"
npx vitest --run --project "browser (chromium)" -t "suggesting"
```

## Suggesting Mode Tests

The suggesting mode tests are in `tests/suggesting-state.test.tsx` (17 tests):

| Group                   | Count | What's tested                                                       |
| ----------------------- | ----- | ------------------------------------------------------------------- |
| State transitions       | 8     | Mode switching, readOnly override, round-trips, no-ops              |
| Behavior interception   | 3     | Mutation interception, non-mutation passthrough, restore on disable |
| Backwards compatibility | 3     | Legacy `isActive()` flag, veto/bypass pattern, readOnly unchanged   |
| Emitted events          | 3     | `'suggesting'`, `'editable'`, `'read only'` events on transitions   |

Run them:

```sh
npx vitest --run --project "browser (chromium)" tests/suggesting-state.test.tsx
```

## Type Checking

```sh
# From packages/editor/
pnpm check:types

# Or directly:
npx tsc --noEmit --project tsconfig.json
```

**Known pre-existing type errors** (not related to suggesting mode):

- `tests/event.paste.test.tsx:223`
- `tests/upload-images-on-paste.test.tsx:207,380`

## Running the Playground

The playground is a Vite app that demonstrates the editor with all features including suggesting mode.

```sh
# From repo root
cd apps/playground

# Start dev server
pnpm dev
```

Opens at `http://localhost:5173`. The playground uses Vite aliases to resolve `@portabletext/editor` directly from source — no build step needed for the editor package.

### Testing suggesting mode in the playground

1. Start the playground (`pnpm dev`)
2. Click the speech bubble icon (💬) in the **right** button group of the editor footer (next to the pencil/Editable toggle)
3. The editor border turns amber and a "Suggest mode" banner appears
4. Type — text appears as green inline suggestions instead of editing the document
5. Use the suggestion panel (bottom of editor) to accept or reject suggestions

### Playground type checking

The playground has its own tsconfig that resolves packages through `node_modules` (not Vite aliases), so some type errors are expected when packages haven't been built:

```sh
cd apps/playground
pnpm check:types  # May show errors for unbuilt packages
```

For a clean type check, build all packages first:

```sh
# From repo root
pnpm build
cd apps/playground
pnpm check:types
```

## CI Notes

The full test suite runs ~1026 browser tests. Typical run time is 2-3 minutes on CI. The suggesting mode tests add 17 tests to this count.

Firefox and WebKit browsers are also supported:

```sh
pnpm test:browser:firefox
pnpm test:browser:webkit
```

These require the corresponding Playwright browsers to be installed (`npx playwright install firefox webkit`).
