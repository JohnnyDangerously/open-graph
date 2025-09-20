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
- [ ] `resolveCompany` with LOCAL_FAKE_DB flag
- [ ] `companyContacts` with fake data
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

5. Write the first test: `api.__probe.test.ts`

### 5. Example Test Implementation
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

### 6. Coverage Goals
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
