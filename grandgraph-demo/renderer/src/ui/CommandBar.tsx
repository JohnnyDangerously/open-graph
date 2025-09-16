import React, { useRef } from "react";

export default function CommandBar({ onRun, placeholder }: { onRun: (cmd: string)=>void, placeholder?: string }){
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ position:"absolute", top:10, left:10, right:220, zIndex:20 }}>
      <input
        ref={inputRef}
        placeholder={placeholder || "show <person_id>  •  clear  •  tip: paste LinkedIn URL"}
        onKeyDown={(e)=>{
          if (e.key === "Enter") {
            const v = (e.target as HTMLInputElement).value.trim();
            if (v) onRun(v);
            (e.target as HTMLInputElement).value = "";
          }
        }}
        style={{
          width:"100%", padding:"12px 14px", borderRadius:14,
          background:"rgba(10,10,20,0.7)", border:"1px solid rgba(255,255,255,0.12)", color:"#fff",
          boxShadow:"0 6px 24px rgba(0,0,0,0.35)", outline:"none"
        }}
      />
    </div>
  );
}


