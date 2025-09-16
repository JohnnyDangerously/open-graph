import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import LoginScene from "./graph/LoginScene";

function Root(){
  const [connected, setConnected] = useState(false)
  const [blend, setBlend] = useState(false)
  // one-shot gate to avoid double login in dev/StrictMode or remounts
  const already = typeof window !== 'undefined' && sessionStorage.getItem('logged_in') === '1'
  const showLogin = !connected && !already
  return (
    <div style={{ position:'fixed', inset:0 }}>
      {showLogin && <LoginScene onDone={()=>{ try{ sessionStorage.setItem('logged_in','1') }catch{}; setConnected(true) }} onConnect={()=>{ try{ sessionStorage.setItem('logged_in','1') }catch{}; setConnected(true) }} />}
      <div style={{ position:'absolute', inset:0, opacity: (!showLogin || connected) ? 1 : (blend ? 1 : 0), transition:'opacity 200ms linear' }}>
        <App />
      </div>
    </div>
  )
}

const root = createRoot(document.getElementById("root")!);
root.render(<Root />);


