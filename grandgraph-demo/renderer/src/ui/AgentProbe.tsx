import React, { useEffect, useState } from 'react'
import { __probe_echo } from '../lib/api'

export default function AgentProbe(){
  const [loading, setLoading] = useState(false)
  
  useEffect(() => {
    console.log("🚀 AgentProbe component mounted!")
  }, [])
  
  const handleProbeClick = async () => {
    console.clear() // Clear the debug spam
    console.log("🔍 PROBE BUTTON CLICKED!")
    try {
      setLoading(true)
      const result = await __probe_echo("hello")
      console.log("✅ PROBE RESULT:", result)
      alert(`Probe successful! Check console for details.`)
    } catch (error) {
      console.error("❌ PROBE ERROR:", error)
      alert(`Probe failed: ${error}`)
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <div style={{
      padding:8,
      border:'1px solid #00ff00',
      background:'rgba(0,255,0,0.06)',
      display:'flex',
      flexDirection:'column',
      gap:8,
      position:'absolute',
      left:12,
      bottom:96,
      zIndex:12,
      width:300,
      maxHeight:160,
      overflow:'auto',
      borderRadius:8,
      boxShadow:'0 8px 24px rgba(0,0,0,0.35)'
    }}>
      <div style={{display:'flex', gap:6, alignItems:'center', justifyContent:'space-between'}}>
        <span style={{color:'#00ff00', fontWeight:'bold', fontSize:12}}>Agent is alive ✅</span>
        <button 
          onClick={handleProbeClick}
          style={{
            padding:'6px 10px',
            background: loading? '#6d6' : '#00ff00',
            color:'black',
            border:'none',
            borderRadius:4,
            cursor:'pointer',
            fontSize:'12px',
            fontWeight:'bold',
            position:'relative',
            zIndex:13
          }}
        >
          {loading? 'TESTING…' : 'PROBE TEST'}
        </button>
      </div>
    </div>
  )
}
