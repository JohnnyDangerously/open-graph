import React from "react";

export type NodeListItem = {
  index: number;
  group: number;
  flag?: number;
  name?: string;
  title?: string | null;
  avatarUrl?: string;
};

export default function NodeList({
  items,
  onSelect,
  onDoubleSelect,
  selectedIndex,
}: {
  items: NodeListItem[];
  onSelect: (i: number) => void;
  onDoubleSelect?: (i: number) => void;
  selectedIndex?: number | null;
}) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {items.slice(0, 600).map((it) => {
        const isSel = typeof selectedIndex === "number" && selectedIndex === it.index;
        return (
          <div
            key={it.index}
            onClick={() => onSelect(it.index)}
            onDoubleClick={() => onDoubleSelect?.(it.index)}
            style={{
              padding: "6px 8px",
              borderRadius: 6,
              background: isSel ? "var(--dt-fill-strong)" : "var(--dt-fill-weak)",
              border: isSel
                ? "1px solid var(--dt-border-strong)"
                : "1px solid var(--dt-border)",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {it.avatarUrl ? (
                <img
                  src={it.avatarUrl}
                  alt={it.name || `#${it.index}`}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    objectFit: "cover",
                    flex: "0 0 auto",
                    background: "var(--dt-fill-med)",
                    border: "1px solid var(--dt-border)",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    display: "grid",
                    placeItems: "center",
                    background: "var(--dt-fill-weak)",
                    border: "1px solid var(--dt-border)",
                    color: "var(--dt-text)",
                    fontSize: 10.5,
                  }}
                >
                  {(it.name || "")[0]?.toUpperCase() || "#"}
                </div>
              )}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: "var(--dt-text)",
                  }}
                >
                  {it.name || `#${it.index}`}
                </div>
                {it.title && (
                  <div
                    style={{
                      fontSize: 10.5,
                      opacity: 0.78,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      color: "var(--dt-text-dim)",
                    }}
                  >
                    {it.title}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
