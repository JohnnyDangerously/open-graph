import type {
  Expression,
  Token,
  ParseError,
  EntityToken,
  OperatorToken,
  FilterToken,
  SetOpToken,
  ViewToken,
  PipeToken,
  ExplainToken,
  MacroDefToken,
  MacroRefToken,
} from './types';

const whitespace = /\s/;
const simpleOperators = new Map<string, OperatorToken['op']>([
  ['^', '^'],
  ['bridge', 'bridge'],
  ['><', '><'],
  ['compare', 'compare'],
  ['*', '*'],
  ['migration', 'migration'],
  ['>', '>'],
  ['filter', 'filter'],
  ['<', '<'],
  ['center', 'center'],
  ['#', '#'],
  ['membership', 'membership'],
  ['Δ', 'Δ'],
  ['delta', 'delta'],
  ['↗', 'reach'],
  ['reach', 'reach'],
  ['~', 'similar'],
  ['similar', 'similar'],
  ['>>', '>>'],
  ['reweight', 'reweight'],
  ['groupby', 'groupby'],
  ['bucket', 'bucket'],
]);

const setOps = new Map<string, SetOpToken['op']>([
  ['+', '+'],
  ['&', '&'],
  ['∩', '&'],
  ['-', '-'],
  ['union', 'union'],
  ['intersect', 'intersect'],
  ['exclude', 'exclude'],
]);

const viewAliases: Record<string, ViewToken['view']> = {
  '@view:graph': 'graph',
  '@view:flows': 'flows',
  '@view:list': 'list',
  '@view:auto': 'auto',
  '@view:sankey': 'sankey',
  '@view:bubbles': 'bubbles',
  '@view:paths': 'paths',
};

let tokenCounter = 0;
const tokenId = () => `tok-${Date.now().toString(36)}-${(tokenCounter++).toString(36)}`;

export function parseExpression(text: string): Expression {
  tokenCounter = 0;
  const tokens: Token[] = [];
  const errors: ParseError[] = [];
  const len = text.length;
  let idx = 0;

  const skipWhitespace = () => {
    while (idx < len && whitespace.test(text[idx])) idx++;
  };

  const peek = (offset = 0) => text[idx + offset] ?? '';

  const consumeWhile = (fn: (ch: string, offset: number) => boolean) => {
    const startIdx = idx;
    while (idx < len && fn(text[idx], idx - startIdx)) idx++;
    return text.slice(startIdx, idx);
  };

  const consumeUntil = (delims: string[]) => {
    const startIdx = idx;
    while (idx < len) {
      const ch = text[idx];
      if (delims.includes(ch)) break;
      idx++;
    }
    return text.slice(startIdx, idx);
  };

  const makeBaseToken = (raw: string, start: number, end: number) => ({
    id: tokenId(),
    type: 'literal' as const,
    raw,
    value: raw,
    start,
    end,
  });

  const pushToken = (tok: Token) => {
    tokens.push(tok);
  };

  while (idx < len) {
    skipWhitespace();
    if (idx >= len) break;
    const start = idx;
    const ch = peek();
    const rest = text.slice(idx);

    // Comments (line)
    if (rest.startsWith('//')) {
      idx = len;
      break;
    }

    // Macro definition: def name(param, param) := expr
    if (/^def\b/i.test(rest)) {
      idx += 3;
      skipWhitespace();
      const nameMatch = /^[A-Za-z_][A-Za-z0-9_:-]*/.exec(text.slice(idx));
      if (!nameMatch) {
        errors.push({ message: 'Expected macro name after def', start: idx, end: idx + 1, severity: 'error' });
        break;
      }
      const name = nameMatch[0];
      idx += name.length;
      skipWhitespace();
      let params: string[] = [];
      if (peek() === '(') {
        idx++;
        const paramsStart = idx;
        const paramParts: string[] = [];
        let current = '';
        let depth = 1;
        while (idx < len && depth > 0) {
          const c = peek();
          if (c === '(') depth++;
          else if (c === ')') {
            depth--;
            if (depth === 0) {
              if (current.trim()) paramParts.push(current.trim());
              idx++;
              break;
            }
          }
          if (depth > 0) {
            if (c === ',') {
              paramParts.push(current.trim());
              current = '';
            } else {
              current += c;
            }
            idx++;
          }
        }
        params = paramParts.filter(Boolean);
      }
      skipWhitespace();
      if (rest.slice(idx - start).trim().includes(':=')) {
        const assignIdx = text.indexOf(':=', idx);
        if (assignIdx !== -1) {
          const tok: MacroDefToken = {
            id: tokenId(),
            type: 'macro-def',
            raw: text.slice(start, assignIdx + 2),
            value: name,
            name,
            params,
            start,
            end: assignIdx + 2,
          };
          pushToken(tok);
          idx = assignIdx + 2;
          continue;
        }
      }
      const tok: MacroDefToken = {
        id: tokenId(),
        type: 'macro-def',
        raw: text.slice(start, idx),
        value: name,
        name,
        params,
        start,
        end: idx,
      };
      pushToken(tok);
      continue;
    }

    // Parenthesized group
    if (ch === '(') {
      idx++;
      const groupStart = idx;
      let depth = 1;
      while (idx < len && depth > 0) {
        const c = peek();
        if (c === '(') depth++;
        else if (c === ')') depth--;
        idx++;
      }
      const groupContent = depth === 0 ? text.slice(groupStart, idx - 1) : text.slice(groupStart);
      if (depth !== 0) {
        errors.push({ message: 'Unclosed group', start: groupStart, end: len, severity: 'error' });
      }
      const tok: EntityToken = {
        id: tokenId(),
        type: 'entity',
        entityKind: 'group',
        raw: text.slice(start, idx),
        value: groupContent.trim(),
        start,
        end: idx,
      };
      pushToken(tok);
      continue;
    }

    // Quoted literal
    if (ch === '"' || ch === '\'') {
      const quote = ch;
      idx++;
      let value = '';
      let closed = false;
      while (idx < len) {
        const c = peek();
        if (c === quote) {
          idx++;
          closed = true;
          break;
        }
        if (c === '\\') {
          const nextChar = text[idx + 1] ?? '';
          value += nextChar;
          idx += 2;
        } else {
          value += c;
          idx++;
        }
      }
      if (!closed) {
        errors.push({ message: 'Unterminated quote', start, end: idx, severity: 'error' });
      }
      const tok: EntityToken = {
        id: tokenId(),
        type: 'entity',
        entityKind: 'raw',
        raw: text.slice(start, idx),
        value,
        start,
        end: idx,
      };
      pushToken(tok);
      continue;
    }

    // Explain tokens ? or ∵
    if (ch === '?' || ch === '∵') {
      idx++;
      const tok: ExplainToken = {
        id: tokenId(),
        type: 'explain',
        raw: ch,
        value: ch,
        start,
        end: idx,
        mode: ch,
      };
      pushToken(tok);
      continue;
    }

    // Pipes | action
    if (ch === '|') {
      idx++;
      skipWhitespace();
      const action = consumeWhile((c) => !whitespace.test(c) && c !== ':' && c !== '"' && c !== '\'');
      let argument = '';
      if (peek() === ':') {
        idx++;
        skipWhitespace();
        if (peek() === '"' || peek() === '\'') {
          const quote = peek();
          idx++;
          while (idx < len) {
            const c = peek();
            if (c === quote) {
              idx++;
              break;
            }
            if (c === '\\') {
              argument += text[idx + 1] ?? '';
              idx += 2;
            } else {
              argument += c;
              idx++;
            }
          }
        } else {
          argument = consumeUntil(['|', '?']).trim();
        }
      }
      const tok: PipeToken = {
        id: tokenId(),
        type: 'pipe',
        raw: text.slice(start, idx),
        value: action,
        action,
        argument: argument || undefined,
        start,
        end: idx,
      };
      pushToken(tok);
      continue;
    }

    // View tokens @view:*
    if (rest.startsWith('@view:')) {
      const viewRaw = consumeWhile((c) => !whitespace.test(c));
      const lower = viewRaw.toLowerCase();
      const view = viewAliases[lower] ?? 'auto';
      const tok: ViewToken = {
        id: tokenId(),
        type: 'view',
        raw: viewRaw,
        value: viewRaw,
        view,
        start,
        end: idx,
      };
      pushToken(tok);
      continue;
    }

    // Macro reference name(args)
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(rest)) {
      const nameMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
      if (nameMatch) {
        const name = nameMatch[0];
        idx += name.length;
        skipWhitespace();
        if (peek() === '(') {
          idx++;
          const args: string[] = [];
          let current = '';
          let depth = 1;
          while (idx < len && depth > 0) {
            const c = peek();
            if (c === '(') depth++;
            else if (c === ')') {
              depth--;
              if (depth === 0) {
                if (current.trim()) args.push(current.trim());
                idx++;
                break;
              }
            }
            if (depth > 0) {
              if (c === ',' && depth === 1) {
                args.push(current.trim());
                current = '';
              } else {
                current += c;
              }
              idx++;
            }
          }
          const tok: MacroRefToken = {
            id: tokenId(),
            type: 'macro-ref',
            raw: text.slice(start, idx),
            value: name,
            name,
            args,
            start,
            end: idx,
          };
          pushToken(tok);
          continue;
        }
        idx = start; // reset if not actual macro call
      }
    }

    // Operator multi-character (priority)
    if (rest.startsWith('>>')) {
      idx += 2;
      const tok: OperatorToken = {
        id: tokenId(),
        type: 'operator',
        raw: '>>',
        value: '>>',
        op: '>>',
        start,
        end: idx,
      };
      pushToken(tok);
      continue;
    }
    if (rest.startsWith('><')) {
      idx += 2;
      const tok: OperatorToken = {
        id: tokenId(),
        type: 'operator',
        raw: '><',
        value: '><',
        op: '><',
        start,
        end: idx,
      };
      pushToken(tok);
      continue;
    }
    if (rest.startsWith('^k=')) {
      idx += 3;
      const num = consumeWhile((c) => /[0-9]/.test(c));
      const tok: OperatorToken = {
        id: tokenId(),
        type: 'operator',
        raw: `^k=${num}`,
        value: `^k=${num}`,
        op: '^',
        start,
        end: idx,
        hint: `k=${num}`,
      };
      pushToken(tok);
      continue;
    }
    if (rest.startsWith('^') && /\^\d+/.test(rest)) {
      idx++;
      const num = consumeWhile((c) => /[0-9]/.test(c));
      const tok: OperatorToken = {
        id: tokenId(),
        type: 'operator',
        raw: `^${num}`,
        value: `^${num}`,
        op: '^',
        start,
        end: idx,
        hint: num ? `hops<=${num}` : undefined,
      };
      pushToken(tok);
      continue;
    }

    // Set operators
    for (const [key, op] of setOps.entries()) {
      if (rest.startsWith(key)) {
        idx += key.length;
        const tok: SetOpToken = {
          id: tokenId(),
          type: 'set-op',
          raw: key,
          value: key,
          op,
          start,
          end: idx,
        };
        pushToken(tok);
        continue;
      }
    }

    // Single-char operators
    if (simpleOperators.has(ch)) {
      idx++;
      const opVal = simpleOperators.get(ch)!;
      const tok: OperatorToken = {
        id: tokenId(),
        type: 'operator',
        raw: ch,
        value: ch,
        op: opVal,
        start,
        end: idx,
      };
      pushToken(tok);
      continue;
    }

    // Keyword operators (bridge, compare, etc.)
    for (const [kw, op] of simpleOperators.entries()) {
      if (kw.length > 1 && rest.toLowerCase().startsWith(kw)) {
        const next = text[idx + kw.length] ?? ' ';
        if (next === ' ' || next === '\n' || next === '\t') {
          idx += kw.length;
          const tok: OperatorToken = {
            id: tokenId(),
            type: 'operator',
            raw: kw,
            value: kw,
            op,
            start,
            end: idx,
          };
          pushToken(tok);
          continue;
        }
      }
    }

    // Filters key:value or key{json}
    const filterMatch = /^([A-Za-z_][A-Za-z0-9_.-]*)(:|\{)/.exec(rest);
    if (filterMatch) {
      const key = filterMatch[1];
      const sep = filterMatch[2];
      idx += key.length + sep.length;
      let valueRaw = '';
      if (sep === ':') {
        if (peek() === '"' || peek() === '\'') {
          const quote = peek();
          idx++;
          while (idx < len) {
            const c = peek();
            if (c === quote) {
              idx++;
              break;
            }
            if (c === '\\') {
              valueRaw += text[idx + 1] ?? '';
              idx += 2;
            } else {
              valueRaw += c;
              idx++;
            }
          }
        } else {
          valueRaw = consumeWhile((c) => !whitespace.test(c) && c !== '|' && c !== '?');
        }
      } else {
        // Brace payload score{...}
        let depth = 1;
        while (idx < len && depth > 0) {
          const c = peek();
          if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            idx++;
            if (depth === 0) break;
            continue;
          }
          if (depth > 0) {
            valueRaw += c;
            idx++;
          }
        }
      }
      const tok: FilterToken = {
        id: tokenId(),
        type: 'filter',
        raw: text.slice(start, idx),
        value: `${key}:${valueRaw}`,
        key,
        valueRaw,
        valueParts: valueRaw.split(/[;,\s]+/).filter(Boolean),
        start,
        end: idx,
      };
      pushToken(tok);
      continue;
    }

    // Entity tokens starting with @ or #
    if (ch === '@' || ch === '#') {
      idx++;
      const handle = consumeWhile((c) => !whitespace.test(c) && c !== '^' && c !== '>' && c !== '<' && c !== '|' && c !== '+' && c !== '&' && c !== '-');
      const kind = ch === '@' ? 'person' : 'list';
      const tok: EntityToken = {
        id: tokenId(),
        type: 'entity',
        entityKind: kind,
        raw: text.slice(start, idx),
        value: `${ch}${handle}`,
        start,
        end: idx,
      };
      pushToken(tok);
      continue;
    }

    // Default entity chunk until whitespace or operator delim
    const entityChunk = consumeWhile((c) => {
      if (whitespace.test(c)) return false;
      if (c === '^' || c === '>' || c === '<' || c === '|' || c === '+' || c === '&' || c === '-' || c === '?' || c === '∵') return false;
      return true;
    });
    if (entityChunk) {
      const lowered = entityChunk.toLowerCase();
      const entityKind: EntityToken['entityKind'] = lowered.includes('.com') || lowered.includes('.') ? 'company' : 'raw';
      const tok: EntityToken = {
        id: tokenId(),
        type: 'entity',
        entityKind,
        raw: entityChunk,
        value: entityChunk,
        start,
        end: idx,
      };
      pushToken(tok);
      continue;
    }

    // Fallback to literal to avoid infinite loop
    idx++;
    pushToken({ ...makeBaseToken(ch, start, idx) });
  }

  return { text, tokens, errors };
}

export function parseAndNormalize(text: string) {
  const exp = parseExpression(text);
  return exp;
}
