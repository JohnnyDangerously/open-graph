# Tests TODO

## Plan to Add Testing Framework

The project currently lacks a testing framework. Here's the plan to add comprehensive testing:

### 1. Add Vitest (Recommended)
- **Why Vitest**: Since the project uses Vite, Vitest is the natural choice for seamless integration
- **Benefits**: 
  - Fast execution
  - Native TypeScript support
  - Excellent Vite integration
  - Jest-compatible API

### 2. Test Structure
```
grandgraph-demo/
├── renderer/
│   └── src/
│       ├── lib/
│       │   ├── api.test.ts          # API function tests
│       │   ├── api.__probe.test.ts  # Specific probe function tests
│       │   └── cache.test.ts        # Cache functionality tests
│       ├── ui/
│       │   ├── AgentProbe.test.tsx  # Component tests
│       │   └── Settings.test.tsx    # Component tests
│       └── graph/
│           ├── parse.test.ts        # Graph parsing tests
│           └── CanvasScene.test.tsx # Scene tests
```

### 3. Priority Test Cases

#### High Priority:
- [ ] `__probe_echo` function (assert ok === true)
- [ ] `resolveCompany` (mock fetch; domain and name paths; null not-found)
- [ ] `companyContacts` ranking (mock fetch; current-only filter)
- [ ] AgentProbe component rendering and interactions

#### Medium Priority:
- [ ] `resolvePerson` function
- [ ] `fetchEgoClientJSON` function
- [ ] Graph parsing functions
- [ ] Cache functionality

#### Low Priority:
- [ ] UI component interactions
- [ ] Integration tests
- [ ] E2E tests with Playwright

### 4. Implementation Steps
1. Install Vitest and related dependencies:
   ```bash
   npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom
   ```

2. Configure Vitest in `vite.config.ts`:
   ```typescript
   import { defineConfig } from "vite";
   import react from "@vitejs/plugin-react";
   
   export default defineConfig(({ mode, command }) => ({
     // ... existing config
     test: {
       globals: true,
       environment: 'jsdom',
       setupFiles: ['./src/test/setup.ts'],
     },
     // ... rest of config
   }));
   ```

3. Add test scripts to `package.json`:
   ```json
   {
     "scripts": {
       "test": "vitest",
       "test:ui": "vitest --ui",
       "test:run": "vitest run"
     }
   }
   ```

4. Create test setup file for React Testing Library

5. Write the first tests: `api.resolveCompany.test.ts` and `ui.CompanyContacts.test.tsx`

### 5. Exact Test Plan (files, cases, mocks)

#### A) API: resolveCompany
- File: `grandgraph-demo/renderer/src/lib/api.resolveCompany.test.ts`
- Mocks:
  - Stub `global.fetch` to return JSONEachRow bodies or empty string
  - Use `vi.spyOn(Storage.prototype, 'getItem')` to set `API_BASE_URL` if needed
- Cases:
  1. Domain exact: `white.com` → returns `company:<id>` when backend returns one JSONEachRow line `{"id":"2259..."}`.
  2. Name contains (case-insensitive): backend returns first match → `company:<id>`.
  3. Not found: both domain and name paths return empty → returns `null`.
  4. Canonical passthrough: input `company:123` → returns unchanged.

Sketch:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveCompany, setApiBase } from './api'

describe('resolveCompany', () => {
  const mkResp = (body: string, ok = true) => new Response(body, { status: ok?200:404, headers:{'content-type':'application/json'} })
  beforeEach(() => { vi.restoreAllMocks(); setApiBase('http://localhost:8123') })
  afterEach(() => vi.restoreAllMocks())

  it('returns company:<id> for domain exact', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(mkResp('{"id":"123"}\n'))
    await expect(resolveCompany('white.com')).resolves.toBe('company:123')
  })

  it('returns company:<id> for name contains', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mkResp('\n')) // domain path empty
      .mockResolvedValueOnce(mkResp('{"id":"456"}\n')) // name path
    await expect(resolveCompany('Horton')).resolves.toBe('company:456')
  })

  it('returns null when no match', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(mkResp('\n'))
    await expect(resolveCompany('does-not-exist')).resolves.toBeNull()
  })
})
```

#### B) UI: CompanyContacts "Current only" filter
- File: `grandgraph-demo/renderer/src/ui/CompanyContacts.test.tsx`
- Mocks:
  - Mock `resolveCompany` to return `company:999`
  - Mock `companyContacts` to capture `opts.currentOnly` and return rows
  - Mock `navigator.clipboard.writeText`
- Cases:
  1. Enter query → click Search → rows render with formatted dates (`YYYY-MM`, fallback `—`).
  2. Toggle "Current only" → Search again → `companyContacts` called with `{ currentOnly: true }`.
  3. resolveCompany returns null → shows "No matching company found.".
  4. contacts error → shows toast with status + first 120 chars.

Sketch:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
vi.mock('../lib/api', () => ({
  resolveCompany: vi.fn().mockResolvedValue('company:999'),
  companyContacts: vi.fn().mockResolvedValue([
    { id:'1', name:'A', title:'Engineer', company:'X', start_date:'2020-05-01', end_date:null, seniority:3 },
    { id:'2', name:'B', title:'PM', company:'X', start_date:'2019-01-10', end_date:'2021-07-20', seniority:2 },
  ]),
}))
import CompanyContacts from './CompanyContacts'

it('applies Current only and formats dates', async () => {
  render(<CompanyContacts />)
  fireEvent.change(screen.getByPlaceholderText(/enter company/i), { target:{ value:'white.com' } })
  fireEvent.click(screen.getByText('Search'))
  await screen.findByText('A')
  expect(screen.getByText('2020-05')).toBeInTheDocument()
  expect(screen.getByText('—')).toBeInTheDocument()
  fireEvent.click(screen.getByLabelText(/Current only/i))
  fireEvent.click(screen.getByText('Search'))
  const { companyContacts } = await import('../lib/api')
  expect(companyContacts).toHaveBeenLastCalledWith('company:999', { currentOnly: true })
})
```

### 6. Package Scripts (exact)
Add to `grandgraph-demo/package.json`:
```json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:run": "vitest run"
  }
}
```

### 7. How to run
```bash
cd grandgraph-demo
npm i -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
npm run test
```
```typescript
// renderer/src/lib/api.__probe.test.ts
import { describe, it, expect } from 'vitest';
import { __probe_echo } from './api';

describe('__probe_echo', () => {
  it('should return ok === true', async () => {
    const result = await __probe_echo('test');
    expect(result.ok).toBe(true);
    expect(result.input).toBe('test');
    expect(result.ts).toBeDefined();
  });
});
```

### 8. Coverage Goals
- **Unit Tests**: 80%+ coverage for API functions
- **Component Tests**: 70%+ coverage for UI components
- **Integration Tests**: Key user flows covered

### 7. CI/CD Integration
- Add test step to build pipeline
- Set up coverage reporting
- Configure test failure thresholds

---

**Status**: Not implemented yet
**Priority**: Medium
**Estimated Effort**: 2-3 days for basic setup + 1-2 weeks for comprehensive coverage

