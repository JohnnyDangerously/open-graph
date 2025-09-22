export type TokenType =
  | 'entity'
  | 'operator'
  | 'filter'
  | 'set-op'
  | 'view'
  | 'pipe'
  | 'action'
  | 'explain'
  | 'macro-def'
  | 'macro-ref'
  | 'assignment'
  | 'group'
  | 'delimiter'
  | 'literal';

export interface BaseToken {
  id: string;
  type: TokenType;
  raw: string;
  value: string;
  start: number;
  end: number;
  label?: string;
  hint?: string;
  meta?: Record<string, unknown>;
}

export interface EntityToken extends BaseToken {
  type: 'entity';
  entityKind: 'company' | 'person' | 'list' | 'macro' | 'alias' | 'raw' | 'view' | 'group';
  canonical?: string | null;
}

export interface OperatorToken extends BaseToken {
  type: 'operator';
  op:
    | '^'
    | 'bridge'
    | '><'
    | 'compare'
    | '*'
    | 'migration'
    | '>'
    | 'filter'
    | '<'
    | 'center'
    | '#'
    | 'membership'
    | 'Δ'
    | 'delta'
    | '↗'
    | 'reach'
    | '~'
    | 'similar'
    | '>>'
    | 'reweight'
    | '|'
    | 'pipe'
    | ':'
    | 'groupby'
    | 'bucket';
}

export interface FilterToken extends BaseToken {
  type: 'filter';
  key: string;
  valueRaw: string;
  valueParts: string[];
}

export interface SetOpToken extends BaseToken {
  type: 'set-op';
  op: '+' | '&' | '-' | 'union' | 'intersect' | 'exclude';
}

export interface ViewToken extends BaseToken {
  type: 'view';
  view: View;
}

export interface PipeToken extends BaseToken {
  type: 'pipe';
  action: string;
  argument?: string;
}

export interface ExplainToken extends BaseToken {
  type: 'explain';
  mode: '?' | '∵';
}

export interface MacroDefToken extends BaseToken {
  type: 'macro-def';
  name: string;
  params: string[];
}

export interface MacroRefToken extends BaseToken {
  type: 'macro-ref';
  name: string;
  args: string[];
}

export type Token =
  | EntityToken
  | OperatorToken
  | FilterToken
  | SetOpToken
  | ViewToken
  | PipeToken
  | ExplainToken
  | MacroDefToken
  | MacroRefToken
  | BaseToken;

export interface ParseError {
  message: string;
  start: number;
  end: number;
  severity?: 'info' | 'warn' | 'error';
}

export interface Expression {
  text: string;
  tokens: Token[];
  errors: ParseError[];
}

export type View =
  | 'graph'
  | 'flows'
  | 'list'
  | 'paths'
  | 'sankey'
  | 'bubbles'
  | 'auto';

export type ViewModel =
  | BridgeVM
  | CompareVM
  | MigrationVM
  | FilterVM
  | PathsVM
  | CohortVM
  | ScoreExplainerVM
  | null;

export interface BridgeVM {
  view: 'graph';
  left: string;
  right: string;
  bridges: Array<{ name: string; score: number; id?: string; stats?: Record<string, number> }>;
  tile?: any;
  raw?: any;
}

export interface CompareVM {
  view: 'list';
  left: string;
  right: string;
  overlap: number;
  uniqueA: number;
  uniqueB: number;
  metrics?: Record<string, number>;
  tiles?: { left: any; right: any };
}

export interface MigrationVM {
  view: 'flows';
  total: number;
  pairs: Array<{ from: string; to: string; count: number; delta?: number }>;
  rows?: Array<Record<string, any>>;
}

export interface FilterVM {
  view: 'list';
  filters: Record<string, string>;
}

export interface PathsVM {
  view: 'paths';
  paths: Array<{ nodes: string[]; weight?: number; hops?: number }>;
}

export interface CohortVM {
  view: 'bubbles' | 'list';
  groupBy: string;
  metric: string;
  cohorts: Array<{ key: string; value: number; label?: string }>;
}

export interface ScoreExplainerVM {
  view: 'list';
  weights: Record<string, number>;
  outcome?: string;
  notes?: string[];
}

export interface EvaluationResult {
  expression: Expression;
  viewModel: ViewModel;
  inferredView: View;
  warnings: string[];
  executed?: boolean;
  durationMs?: number;
}

export interface Suggestion {
  id: string;
  type: 'entity' | 'operator' | 'filter' | 'view' | 'history' | 'macro' | 'action' | 'hint';
  value: string;
  label: string;
  description?: string;
  preview?: string;
  score?: number;
}

export interface SuggestionRequest {
  prefix: string;
  cursor: number;
  text: string;
  context: Expression;
  token?: Token;
}

export interface HistoryEntry {
  id: string;
  expression: string;
  rendered: string;
  at: number;
  view?: View;
  viewModel?: ViewModel;
}

export interface GhostCount {
  tokenId: string;
  count: number;
  label: string;
}

export interface EvaluateOptions {
  history?: HistoryEntry[];
  preferView?: View;
  signal?: AbortSignal;
}
