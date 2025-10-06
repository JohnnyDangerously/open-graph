import React from "react";

type PeopleItem = {
  index: number;
  name: string;
  title?: string | null;
  id?: string | number;
};

export default function TabPeople({
  labels,
  metaNodes,
  onMask,
  onFocusIndex,
  onSetMaskMode,
}: {
  labels: string[];
  metaNodes: Array<Record<string, any>>;
  onMask: (mask: boolean[] | null) => void;
  onFocusIndex: (i: number) => void;
  onSetMaskMode?: (m: 'hide'|'dim') => void;
}) {
  const [query, setQuery] = React.useState("");
  const [mode, setMode] = React.useState<"hide" | "dim">("hide");

  const items = React.useMemo<PeopleItem[]>(() => {
    const n = Math.max(labels?.length || 0, metaNodes?.length || 0);
    const out: PeopleItem[] = [];
    for (let i = 0; i < n; i++) {
      const meta = (metaNodes?.[i] || {}) as any;
      const label = labels?.[i] || meta?.full_name || meta?.name || String(meta?.id ?? `#${i}`);
      out.push({ index: i, name: String(label), title: meta?.title || meta?.job_title || meta?.headline || null, id: meta?.id });
    }
    return out;
  }, [labels, metaNodes]);

  const isPeopleNode = React.useCallback((meta: any): boolean => {
    try {
      if (!meta || typeof meta !== "object") return false;
      if (typeof meta?.person_id !== "undefined") return true;
      if (typeof meta?.linkedin === "string" || typeof meta?.linkedin_id !== "undefined") return true;
      if (typeof meta?.full_name === "string" || typeof meta?.name === "string") return true;
      if (meta?.group === 1) return true; // bridges middle group tends to be people
      if (/person/i.test(String(meta?.id || ""))) return true;
    } catch {}
    return false;
  }, []);

  const filtered = React.useMemo(() => {
    const q = query.trim();
    const n = items.length;
    if (!q) return items.filter((_, i) => isPeopleNode(metaNodes?.[i] || {}));
    let test: (s: string) => boolean;
    const rx = /^\/(.*)\/(i?m?g?u?y?)$/;
    const m = rx.exec(q);
    if (m) {
      try {
        const r = new RegExp(m[1], m[2] || undefined);
        test = (s: string) => r.test(s);
      } catch {
        const qq = q.toLowerCase();
        test = (s: string) => s.toLowerCase().includes(qq);
      }
    } else {
      const qq = q.toLowerCase();
      test = (s: string) => s.toLowerCase().includes(qq);
    }
    const out: PeopleItem[] = [];
    for (let i = 0; i < n; i++) {
      const meta = (metaNodes?.[i] || {}) as any;
      if (!isPeopleNode(meta)) continue;
      const hay = [items[i]?.name || "", meta?.title || meta?.job_title || meta?.headline || ""].join(" \u2022 ");
      if (test(hay)) out.push(items[i]);
    }
    return out;
  }, [query, items, metaNodes, isPeopleNode]);

  const applyMask = React.useCallback(() => {
    const n = items.length;
    if (n === 0) return onMask(null);
    // Build boolean mask: true only for filtered indices
    const set = new Set(filtered.map((f) => f.index));
    const mask = new Array<boolean>(n).fill(false);
    for (let i = 0; i < n; i++) {
      const meta = (metaNodes?.[i] || {}) as any;
      // only keep people indices and matching filter
      if (isPeopleNode(meta) && set.has(i)) mask[i] = true;
    }
    // adopt desired mask mode if provided
    try { (onSetMaskMode as any)?.(mode) } catch {}
    onMask(mask);
  }, [filtered, items, metaNodes, isPeopleNode, onMask, mode, onSetMaskMode]);

  const clearMask = React.useCallback(() => {
    onMask(null);
  }, [onMask]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      applyMask();
    }
  };

  const onItemClick = (i: number) => {
    onFocusIndex(i);
  };

  const onItemDoubleClick = (i: number) => {
    try {
      const meta = (metaNodes?.[i] || {}) as any;
      let raw: string | null = null;
      if (typeof meta?.id !== "undefined") raw = String(meta.id);
      else if (typeof meta?.person_id !== "undefined") raw = String(meta.person_id);
      else if (typeof meta?.linkedin_id !== "undefined") raw = String(meta.linkedin_id);
      else if (typeof meta?.handle === "string") raw = meta.handle;
      if (!raw) return;
      let canonical = raw;
      if (/^(company|person):\d+$/i.test(raw)) canonical = raw.toLowerCase();
      else if (/^\d+$/.test(raw)) canonical = `person:${raw}`;
      if (canonical) window.dispatchEvent(new CustomEvent("crux_insert", { detail: { text: canonical } }));
    } catch {}
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Search people… (text or /regex/i)"
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid var(--dt-border)",
            background: "var(--dt-bg)",
            color: "var(--dt-text)",
            fontSize: 13,
          }}
        />
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as any)}
          title="Mask mode"
          style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--dt-border)", background: "var(--dt-fill-med)", color: "var(--dt-text)", fontSize: 12 }}
        >
          <option value="hide">Hide</option>
          <option value="dim">Dim</option>
        </select>
        <button
          onClick={applyMask}
          title="Apply mask (Enter)"
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--dt-border)", background: "var(--dt-fill-med)", color: "var(--dt-text)", fontSize: 12 }}
        >
          Apply
        </button>
        <button
          onClick={clearMask}
          title="Clear mask"
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--dt-border)", background: "var(--dt-fill-med)", color: "var(--dt-text)", fontSize: 12 }}
        >
          Reset
        </button>
      </div>

      <div style={{ color: "var(--dt-text-dim)", fontSize: 12 }}>
        {filtered.length} of {items.length} people
      </div>

      <div style={{ display: "grid", gap: 4 }}>
        {filtered.slice(0, 800).map((it) => (
          <div
            key={it.index}
            onClick={() => onItemClick(it.index)}
            onDoubleClick={() => onItemDoubleClick(it.index)}
            style={{
              padding: "6px 8px",
              borderRadius: 6,
              background: "var(--dt-fill-weak)",
              border: "1px solid var(--dt-border)",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--dt-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</div>
            {it.title && (
              <div style={{ fontSize: 10.5, color: "var(--dt-text-dim)", opacity: 0.78, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

