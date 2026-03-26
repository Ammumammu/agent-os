# .claude/rules/code-style.md
# Code style and naming conventions for Agent OS v7

## JavaScript / Node.js
- ES modules everywhere: `import`/`export`, never `require()`
- All files: `"type": "module"` in package.json (already set)
- Async/await only — no `.then()` chains
- No TypeScript — plain JS with JSDoc comments where type clarity matters
- Arrow functions for callbacks, named functions for top-level declarations

## Naming Conventions
```
Files:          kebab-case.js        (market-agent.js, fetch-retry.js)
Functions:      camelCase            (callAPI, fetchWithRetry, sendAlert)
Constants:      SCREAMING_SNAKE      (BASE_URL, AGENT_NAME, FREE_LIMIT)
API actions:    camelCase            (createProduct, getRevenue, buildProduct)
Supabase cols:  snake_case           (started_at, phase1_data, mrr_cents)
CSS classes:    kebab-case           (.card-surface, .btn-primary, .status-pill)
React comps:    PascalCase           (BuildTab, RevenueChart, StatusPill)
```

## React (index.html specific)
- React 18 CDN + Babel standalone — no JSX compiler, no build step
- All components in one `<script type="text/babel">` block
- State: `useState`, `useEffect`, `useRef`, `useCallback` only — no Redux
- No class components
- Inline styles for dynamic values, CSS classes for static styles
- Keep components under 100 lines; extract if longer

## Error Handling
```js
// CORRECT — always explicit
try {
  const res = await fetchWithRetry(url, options);
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  const data = await res.json();
} catch (e) {
  console.error('[context] Error:', e.message);
  await sendAlert(agentName, e.message);
}

// WRONG — silent failures
const data = await fetch(url).then(r => r.json()).catch(() => null);
```

## Serverless Functions
- Always handle `OPTIONS` method first: `if (req.method === 'OPTIONS') return res.status(200).end()`
- Destructure action from body: `const { action, ...p } = req.body`
- Return consistent JSON: `res.status(200).json(data)` or `res.status(500).json({ error: e.message })`
- Max file size: 200 lines — if growing beyond that, split into helper modules

## Comments
- Only add comments where the logic isn't self-evident
- Never add docstrings or JSDoc to code you didn't write
- Prefer self-documenting variable/function names over comments

## No-Nos
- No `console.log` with full API keys or tokens (mask: `key.slice(-4)`)
- No `any` (not TS but same principle — be explicit)
- No unused variables or imports
- No `var` — only `const` and `let`
