import React, { useState, useMemo, ReactNode } from "react";

export type DrawerTab = {
  id: string;
  label: string;
  render: () => ReactNode;
  badge?: number | string;
  disabled?: boolean;
};

type SideDrawerProps = {
  open?: boolean;
  width?: number;
  onToggle: () => void;
  activeTab: string;
  onTabChange: (id: string) => void;
  tabs: DrawerTab[];
  resizable?: boolean;
  onResize?: (w: number) => void;
};

export default function SideDrawer(props: SideDrawerProps) {
  const {
    open = true,
    width = 420,
    onToggle,
    activeTab,
    onTabChange,
    tabs,
    resizable = true,
    onResize,
  } = props;

  const [isOpen, setIsOpen] = useState(open);
  const [internalWidth, setInternalWidth] = useState(width);
  const tabMap = useMemo(() => new Map(tabs.map((t) => [t.id, t])), [tabs]);
  const active = tabMap.get(activeTab) || tabs[0];

  const handleToggle = () => {
    setIsOpen((v) => !v);
    onToggle();
  };

  // Keep internal width in sync when prop changes (rare)
  React.useEffect(() => { setInternalWidth(width) }, [width])

  // Drag-to-resize
  const dragRef = React.useRef<{ startX: number; startW: number } | null>(null)
  const onDragStart = (e: React.MouseEvent) => {
    if (!resizable) return
    dragRef.current = { startX: e.clientX, startW: internalWidth }
    window.addEventListener('mousemove', onDragMove as any)
    window.addEventListener('mouseup', onDragEnd as any, { once: true })
    e.preventDefault()
  }
  const onDragMove = (e: MouseEvent) => {
    const d = dragRef.current
    if (!d) return
    const delta = d.startX - e.clientX // dragging left increases width
    const next = Math.max(280, Math.min(760, Math.round(d.startW + delta)))
    setInternalWidth(next)
    onResize?.(next)
  }
  const onDragEnd = () => {
    dragRef.current = null
    window.removeEventListener('mousemove', onDragMove as any)
  }

  return (
    <div
      className="no-drag"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        height: "100%",
        width: isOpen ? internalWidth : 32,
        transition: "width 160ms ease",
        zIndex: 80,
        pointerEvents: 'auto',
      }}
    >
      <div
        className="no-drag"
        onClick={handleToggle}
        title={isOpen ? "Collapse" : "Expand"}
        style={{
          position: "absolute",
          left: isOpen ? -36 : 0,
          top: 56,
          width: 32,
          height: 32,
          borderRadius: 8,
          background: "var(--dt-fill-med)",
          color: "var(--dt-text)",
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          border: "1px solid var(--dt-border)",
          boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
          zIndex: 120,
        }}
      >
        {isOpen ? "❯" : "❮"}
      </div>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: internalWidth,
            background: "var(--dt-bg-elev-1)",
            borderLeft: "1px solid var(--dt-border)",
            color: "var(--dt-text)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {resizable && (
            <div
              onMouseDown={onDragStart}
              title="Resize"
              className="no-drag"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: 4,
                cursor: 'ew-resize',
                // subtle visual affordance on hover
                background: 'transparent',
                zIndex: 2,
              }}
            />
          )}
          <div
            className="no-drag"
            style={{
              display: "flex",
              gap: 4,
              padding: "4px 8px 0 12px",
              borderBottom: "1px solid var(--dt-border)",
              position: "sticky",
              top: 0,
              background: "var(--dt-bg-elev-1)",
              zIndex: 5,
              // ensure underline has space
              alignItems: 'flex-end',
            }}
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                disabled={t.disabled}
                onClick={() => onTabChange(t.id)}
                style={{
                  padding: "5px 8px 7px 8px",
                  borderRadius: 0,
                  border: 'none',
                  background: 'transparent',
                  color: active?.id === t.id ? 'var(--dt-accent, #8ab4f8)' : 'var(--dt-text)',
                  fontSize: 11,
                  opacity: t.disabled ? 0.55 : 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: t.disabled ? "not-allowed" : "pointer",
                  borderBottom: active?.id === t.id ? '2px solid var(--dt-accent, #8ab4f8)' : '2px solid transparent',
                  lineHeight: 1.6,
                  userSelect: 'none',
                }}
              >
                <span>{t.label}</span>
                {t.badge != null && (
                  <span
                    style={{
                      padding: "0 6px",
                      borderRadius: 8,
                      background: "var(--dt-bg-elev-2, #2b2d31)",
                      border: "1px solid var(--dt-border)",
                      fontSize: 9.5,
                      lineHeight: "13px",
                    }}
                  >
                    {String(t.badge)}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div
            style={{
              position: "relative",
              flex: 1,
              overflow: "auto",
              padding: "8px 8px 10px 8px",
            }}
          >
            {active?.render()}
          </div>
        </div>
      )}
    </div>
  );
}
