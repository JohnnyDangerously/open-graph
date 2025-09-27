import React, { useEffect, useMemo, useRef, useState } from "react";
import type { EvaluationResult, HistoryEntry, Suggestion, Token, FilterToken } from "../crux/types";
import { parseExpression } from "../crux/parser";
import { evaluate } from "../crux/evaluator";
import { getSuggestions } from "../crux/suggestions";

import "./CommandBar.css";

type CommandBarProps = {
  onRun: (expression: string, evaluation: EvaluationResult | null) => void | Promise<void>;
  placeholder?: string;
  focus?: string | null;
  selectedIndex?: number | null;
  onSettings?: () => void;
  rendererMode?: 'canvas' | 'cosmograph';
  onRendererChange?: (mode: 'canvas' | 'cosmograph') => void;
  enableNlq?: boolean;
  onNlq?: (question: string) => void;
  history?: HistoryEntry[];
  onPreview?: (evaluation: EvaluationResult | null) => void;
};

const DEBOUNCE_MS = 180;

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const chipType = (token: Token): string => {
  if (token.type === "entity" || token.type === "macro-ref") return "entity";
  if (token.type === "operator" || token.type === "set-op") return "operator";
  if (token.type === "filter") return "filter";
  if (token.type === "view") return "view";
  if (token.type === "pipe" || token.type === "action") return "pipe";
  if (token.type === "explain") return "explain";
  if (token.type === "macro-def") return "macro";
  return "literal";
};

export default function CommandBar(props: CommandBarProps) {
  const emptyHistoryRef = useRef<HistoryEntry[]>([]);
  const {
    onRun,
    placeholder,
    focus,
    selectedIndex,
    onSettings,
    rendererMode,
    onRendererChange,
    enableNlq,
    onNlq,
    onPreview,
  } = props;
  const history = props.history ?? emptyHistoryRef.current;

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [nlqOpen, setNlqOpen] = useState(false);
  const [nlqText, setNlqText] = useState("");
  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const lastEvaluatedRef = useRef<string>("");

  const expression = useMemo(() => parseExpression(value), [value]);
  const activeToken = useMemo(() => {
    const s = selectionStart;
    return expression.tokens.find((tok) => s >= tok.start && s <= tok.end);
  }, [expression, selectionStart]);

  useEffect(() => {
    const sugg = getSuggestions(expression, selectionStart, history);
    setSuggestions(sugg);
    setActiveSuggestion(0);
  }, [expression, selectionStart, history]);

  // Listen for global inserts (e.g., graph node double-click)
  useEffect(() => {
    const onInsert = (e: Event) => {
      try {
        const detail = (e as CustomEvent)?.detail as { text?: string } | undefined
        const text = (detail && typeof detail.text === 'string') ? detail.text : ''
        if (!text) return
        // Insert entity token at caret, pad appropriately
        insertAtRange(text, selectionStart, selectionEnd, true)
      } catch {}
    }
    window.addEventListener('crux_insert', onInsert as EventListener)
    return () => window.removeEventListener('crux_insert', onInsert as EventListener)
  }, [selectionStart, selectionEnd])

  useEffect(() => {
    const current = value.trim();
    if (!current) {
      if (evaluation !== null) setEvaluation(null);
      if (evaluating) setEvaluating(false);
      onPreview?.(null);
      return;
    }
    // Skip if we've already evaluated this exact string
    if (current === lastEvaluatedRef.current) return;
    setEvaluating(true);
    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      try {
        const result = await evaluate(current, { history, signal: controller.signal });
        if (!controller.signal.aborted) {
          lastEvaluatedRef.current = current;
          setEvaluation(result);
          setEvaluating(false);
          onPreview?.(result);
        }
      } catch (error: any) {
        if (error?.name === "AbortError") return;
        setEvaluating(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [value, history]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValue(next);
    setSelectionStart(e.target.selectionStart ?? next.length);
    setSelectionEnd(e.target.selectionEnd ?? e.target.selectionStart ?? next.length);
  };

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    setSelectionStart(target.selectionStart ?? 0);
    setSelectionEnd(target.selectionEnd ?? target.selectionStart ?? 0);
  };

  // Intelligent suggestion visibility: only when input is focused, user has typed something,
  // and caret is inside a token that we can complete. Hide when preview is open.
  const showSuggestions = useMemo(() => {
    if (!inputFocused) return false;
    return suggestions.length > 0;
  }, [inputFocused, suggestions]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "ArrowDown") {
      if (suggestions.length) {
        e.preventDefault();
        setActiveSuggestion((idx) => (idx + 1) % suggestions.length);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      if (suggestions.length) {
        e.preventDefault();
        setActiveSuggestion((idx) => (idx - 1 + suggestions.length) % suggestions.length);
      }
      return;
    }
    if (e.key === "Tab") {
      if (suggestions.length) {
        e.preventDefault();
        applySuggestion(suggestions[activeSuggestion] ?? suggestions[0]);
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      runExpression();
      return;
    }
    if (e.key === "Escape") {
      if (suggestions.length) {
        e.preventDefault();
        setSuggestions([]);
      }
    }
  };

  const applySuggestion = (suggestion: Suggestion) => {
    const activeToken = expression.tokens.find((tok) => selectionStart >= tok.start && selectionStart <= tok.end);
    let replaceStart = selectionStart;
    let replaceEnd = selectionEnd;
    if (activeToken) {
      if (activeToken.type === "filter") {
        const filterToken = activeToken as FilterToken;
        const colonIx = activeToken.raw.indexOf(":");
        if (suggestion.type === "filter") {
          replaceStart = activeToken.start;
          replaceEnd = activeToken.start + (colonIx > -1 ? colonIx + 1 : filterToken.key?.length ?? 0);
        } else {
          replaceStart = colonIx > -1 ? activeToken.start + colonIx + 1 : activeToken.end;
          replaceEnd = activeToken.end;
        }
      } else {
        replaceStart = activeToken.start;
        replaceEnd = activeToken.end;
      }
    }
    insertAtRange(suggestion.value, replaceStart, replaceEnd, shouldPadAfter(suggestion));
  };

  const shouldPadAfter = (suggestion: Suggestion) => {
    if (suggestion.type === "operator" || suggestion.type === "entity" || suggestion.type === "history" || suggestion.type === "view") return true;
    return false;
  };

  const insertAtRange = (textToInsert: string, start: number, end: number, pad = false) => {
    const before = value.slice(0, start);
    const after = value.slice(end);
    const needsSpace = pad && !/\s$/.test(before);
    const nextValue = `${before}${needsSpace ? " " : ""}${textToInsert}${pad && after && !/^\s/.test(after) ? " " : ""}${after}`;
    const cursor = (before.length + (needsSpace ? 1 : 0) + textToInsert.length + (pad ? 1 : 0));
    setValue(nextValue);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = cursor;
      }
    });
  };

  const runExpression = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    let result = evaluation;
    if (!result || result.expression.text !== trimmed) {
      try {
        result = await evaluate(trimmed, { history });
        setEvaluation(result);
      } catch (error: any) {
        // swallow evaluation errors; onRun will surface via err state upstream
      }
    }
    await onRun(trimmed, result ?? null);
    // Hide suggestions after executing by removing focus from the input
    try { inputRef.current?.blur(); } catch {}
    setInputFocused(false);
    setWarningsOpen(false);
    setTimeout(() => {
      setValue("");
      setEvaluation(null);
      onPreview?.(null);
      setSelectionStart(0);
      setSelectionEnd(0);
      setSuggestions([]);
    }, 10);
  };

  const ghostCounts = useMemo(() => {
    if (!evaluation?.viewModel) return null;
    if (evaluation.viewModel.view === "graph" && Array.isArray((evaluation.viewModel as any).bridges)) {
      return `${(evaluation.viewModel as any).bridges.length} bridges`;
    }
    if (evaluation.viewModel.view === "flows") {
      return `${(evaluation.viewModel as any).pairs.length} flows`;
    }
    if (evaluation.viewModel.view === "list") {
      if ((evaluation.viewModel as any).filters) return `${Object.keys((evaluation.viewModel as any).filters).length} filters`;
      return `list ready`;
    }
    return null;
  }, [evaluation]);

  return (
    <div className={classNames("crux-shell", showSuggestions && "has-suggestions")}>
      <div className="crux-topline">
        <div className="crux-focus-card">
          <div className="crux-focus-title">Focus</div>
          <div className="crux-focus-body">{focus ?? "(none)"}</div>
          {typeof selectedIndex === "number" && selectedIndex >= 0 && (
            <div className="crux-focus-foot">Selected #{selectedIndex}</div>
          )}
        </div>
        <div className="crux-top-buttons">
          {enableNlq && onNlq && (
            <>
              <button className="crux-top-button" onClick={()=> setNlqOpen(o=>!o)} title="Natural Language Query (Alpha)" aria-label="Natural Language Query">✨ NLQ</button>
              {nlqOpen && (
                <div className="crux-layout-inline" style={{ marginLeft: 4 }}>
                  <input
                    value={nlqText}
                    onChange={(e)=> setNlqText(e.target.value)}
                    onKeyDown={(e)=>{ if (e.key==='Enter') { e.preventDefault(); if (nlqText.trim()) onNlq(nlqText.trim()) } }}
                    placeholder="Ask a question (use person:<id> / company:<id>)"
                    style={{ background:'transparent', border:'none', color:'var(--dt-text)', outline:'none', fontSize:12, width:260 }}
                  />
                  <button className="crux-top-button" onClick={()=>{ if (nlqText.trim()) onNlq(nlqText.trim()) }}>Run</button>
                </div>
              )}
            </>
          )}
          {onRendererChange && (
            <div className="crux-segment" title="Switch render engine">
              <button
                className={classNames(rendererMode === 'canvas' && 'is-active')}
                onClick={() => onRendererChange('canvas')}
              >
                Canvas
              </button>
              <button
                className={classNames(rendererMode === 'cosmograph' && 'is-active')}
                onClick={() => onRendererChange('cosmograph')}
              >
                Cosmograph
              </button>
            </div>
          )}
          {onSettings && (
            <button className="crux-top-button" onClick={onSettings} title="Settings" aria-label="Settings">⚙︎</button>
          )}
        </div>
      </div>

      <div className="crux-input-wrap">
        <div className="crux-chip-row">
          {expression.tokens.map((token) => (
            <span key={token.id} className={classNames("crux-chip", `crux-chip-${chipType(token)}`)}>
              {prettyLabel(token)}
            </span>
          ))}
        </div>
        <textarea
          ref={inputRef}
          value={value}
          placeholder={placeholder || "person:<id> role:\"(engineer|software|sre)\" | person:<id> -> company:<id> role:\"(vp|director|chief|head)\" k:3 | bridges company:<id> + company:<id> | compare A + B"}
          onChange={handleChange}
          onFocus={()=> setInputFocused(true)}
          onBlur={()=> setInputFocused(false)}
          onSelect={handleSelect}
          onKeyDown={handleKeyDown}
          className={classNames("crux-input", evaluating && "crux-input-loading")}
          rows={1}
        />
        {ghostCounts && <div className="crux-ghost-count">{ghostCounts}</div>}
        {showSuggestions && (
          <div className="crux-suggestions">
            {suggestions.map((sugg, idx) => (
              <button
                key={sugg.id}
                className={classNames("crux-suggestion", idx === activeSuggestion && "is-active")}
                onMouseDown={(e) => { e.preventDefault(); applySuggestion(sugg); }}
              >
                <span className="crux-suggestion-value">{sugg.value}</span>
                <span className="crux-suggestion-desc">{sugg.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {evaluation && (
        <PreviewCard
          evaluation={evaluation}
          onToggleWarnings={() => setWarningsOpen((open) => !open)}
          warningsOpen={warningsOpen}
        />
      )}
    </div>
  );
}

function prettyLabel(token: Token): string {
  if (token.type === "filter") return `${token.key}:${token.valueRaw}`;
  if (token.type === "operator") return token.raw;
  if (token.type === "set-op") return token.raw;
  return token.raw;
}

type PreviewProps = {
  evaluation: EvaluationResult | null;
  warningsOpen: boolean;
  onToggleWarnings: () => void;
};

function PreviewCard({ evaluation, warningsOpen, onToggleWarnings }: PreviewProps) {
  if (!evaluation || !evaluation.viewModel) {
    return (
      <div className="crux-preview crux-preview-empty">
        Start typing to preview bridges, flows, or cohorts instantly.
      </div>
    );
  }
  const { viewModel, warnings } = evaluation;
  return (
    <div className="crux-preview">
      <div className="crux-preview-header">
        <span className="crux-preview-title">{viewModel.view.toUpperCase()} preview</span>
        <span className="crux-preview-meta">{(evaluation.durationMs ?? 0).toFixed(0)} ms</span>
      </div>
      <div className="crux-preview-body">
        {renderViewModel(viewModel)}
      </div>
      {warnings.length > 0 && (
        <div className="crux-preview-warnings">
          <button onClick={onToggleWarnings} className="crux-warning-toggle">
            {warningsOpen ? "Hide warnings" : `${warnings.length} warning${warnings.length > 1 ? "s" : ""}`}
          </button>
          {warningsOpen && (
            <ul>
              {warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function renderViewModel(viewModel: EvaluationResult["viewModel"]) {
  if (!viewModel) return null;
  if (viewModel.view === "graph") {
    const bridges = (viewModel as any).bridges || [];
    return (
      <div className="crux-card-grid">
        {bridges.slice(0, 6).map((bridge: any) => (
          <div key={bridge.id || bridge.name} className="crux-card">
            <div className="crux-card-title">{bridge.name}</div>
            <div className="crux-card-sub">score {bridge.score.toFixed?.(1) ?? bridge.score}</div>
            <div className="crux-card-meta">L:{bridge.stats?.left ?? "-"} • R:{bridge.stats?.right ?? "-"}</div>
          </div>
        ))}
      </div>
    );
  }
  if (viewModel.view === "flows") {
    const vm = viewModel as any;
    const pairs = vm.pairs || [];
    return (
      <div className="crux-card-grid">
        {pairs.slice(0, 6).map((pair: any) => (
          <div key={`${pair.from}-${pair.to}`} className="crux-card">
            <div className="crux-card-title">{pair.from} → {pair.to}</div>
            <div className="crux-card-sub">{pair.count.toLocaleString()} movers</div>
            {pair.delta != null && <div className="crux-card-meta">avg dwell {Math.round(pair.delta)} days</div>}
          </div>
        ))}
      </div>
    );
  }
  if (viewModel.view === "list") {
    const vm = viewModel as any;
    if (vm.filters) {
      return (
        <div className="crux-list">
          {Object.entries(vm.filters).map(([key, val]) => (
            <div key={key} className="crux-list-row">
              <span>{key}</span>
              <span>{val}</span>
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="crux-list">
        <div className="crux-list-row">
          <span>Overlap</span>
          <span>{vm.overlap}</span>
        </div>
        <div className="crux-list-row">
          <span>Unique A</span>
          <span>{vm.uniqueA}</span>
        </div>
        <div className="crux-list-row">
          <span>Unique B</span>
          <span>{vm.uniqueB}</span>
        </div>
      </div>
    );
  }
  return null;
}
