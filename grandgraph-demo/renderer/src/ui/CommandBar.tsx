import React, { useRef } from "react";

export default function CommandBar({ onRun, placeholder }: { onRun: (cmd: string)=>void, placeholder?: string }){
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ position:"absolute", bottom:10, left:"50%", transform:"translateX(-50%)", width:"calc(100% - 4in)", zIndex:20 }}>
      <div style={{ position:'relative' }}>
        <input
          ref={inputRef}
          list="cmd-suggestions"
          placeholder={placeholder || "show person:<name> • compare <a> + <b> • suggest best compare • clear"}
          onKeyDown={(e)=>{
            if (e.key === "Enter") {
              const v = (e.target as HTMLInputElement).value.trim();
              if (v) onRun(v);
              (e.target as HTMLInputElement).value = "";
            }
          }}
          style={{
            width:"100%", padding:"12px 14px", paddingRight:170, borderRadius:14,
            background:"rgba(10,10,20,0.7)", border:"1px solid rgba(255,255,255,0.12)", color:"#fff",
            boxShadow:"0 6px 24px rgba(0,0,0,0.35)", outline:"none"
          }}
        />
        <div style={{ position:'absolute', right:8, top:6, display:'flex', gap:8 }}>
          <button
            onClick={()=>{ const v = 'bridges Apple + Microsoft'; onRun(v); try{ if(inputRef.current) inputRef.current.value=''; }catch{} }}
            title="Run a Bridges demo between Apple and Microsoft"
            style={{ padding:'8px 10px', borderRadius:10, background:'rgba(255,255,255,0.10)', color:'#fff', border:'1px solid rgba(255,255,255,0.18)', cursor:'pointer' }}
          >Bridges demo</button>
          <button
            onClick={()=>{ const v = 'compare Alice + Bob'; onRun(v); try{ if(inputRef.current) inputRef.current.value=''; }catch{} }}
            title="Run a Compare demo"
            style={{ padding:'8px 10px', borderRadius:10, background:'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.16)', cursor:'pointer' }}
          >Compare demo</button>
          <button
            onClick={()=>{ const v = 'suggest best compare'; onRun(v); try{ if(inputRef.current) inputRef.current.value=''; }catch{} }}
            title="Find and load a high-contrast pair"
            style={{ padding:'8px 10px', borderRadius:10, background:'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.16)', cursor:'pointer' }}
          >Best pair</button>
        </div>
      </div>
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
        <option value="bridges Apple + Microsoft" />
        <option value="compare Andrew Rogers + Emily Chen" />
        <option value="Jordan Lee + Michael Patel" />
        <option value="suggest best compare" />
        <option value="clear" />
      </datalist>
    </div>
  );
}


