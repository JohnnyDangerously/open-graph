import React, { useRef } from "react";

export default function CommandBar({ onRun, placeholder }: { onRun: (cmd: string)=>void, placeholder?: string }){
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ position:"absolute", bottom:10, left:"50%", transform:"translateX(-50%)", width:"calc(100% - 4in)", zIndex:20 }}>
      <input
        ref={inputRef}
        list="cmd-suggestions"
        placeholder={placeholder || "show person:<name> • show company:<name> • compare: <idA> + <idB> • clear"}
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
      <datalist id="cmd-suggestions">
        <option value="show person:Andrew Rogers" />
        <option value="show person:https://linkedin.com/in/andrew-rogers-10" />
        <option value="show person:Jordan Lee" />
        <option value="show person:https://linkedin.com/in/jordan-lee-abc123" />
        <option value="show person:Emily Chen" />
        <option value="show person:https://linkedin.com/in/emily-chen-xyz789" />
        <option value="show person:Michael Patel" />
        <option value="show person:https://linkedin.com/in/michael-patel-456def" />
        <option value="show company:Apple Inc." />
        <option value="show company:apple.com" />
        <option value="show company:Google LLC" />
        <option value="show company:google.com" />
        <option value="compare Andrew Rogers + Emily Chen" />
        <option value="Jordan Lee + Michael Patel" />
        <option value="clear" />
      </datalist>
    </div>
  );
}


