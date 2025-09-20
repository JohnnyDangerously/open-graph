import React, { useEffect, useState } from 'react'
import { __probe_echo, resolveCompany, companyContacts } from '../lib/api'

export default function AgentProbe(){
  const [companyName, setCompanyName] = useState('')
  const [contacts, setContacts] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  
  useEffect(() => {
    console.log("🚀 AgentProbe component mounted!")
  }, [])
  
  const handleProbeClick = async () => {
    console.clear() // Clear the debug spam
    console.log("🔍 PROBE BUTTON CLICKED!")
    try {
      const result = await __probe_echo("hello")
      console.log("✅ PROBE RESULT:", result)
      alert(`Probe successful! Check console for details.`)
    } catch (error) {
      console.error("❌ PROBE ERROR:", error)
      alert(`Probe failed: ${error}`)
    }
  }
  
  const handleCompanySearch = async () => {
    if (!companyName.trim()) return
    
    setLoading(true)
    try {
      console.log("🔍 Searching for company:", companyName)
      
      // First resolve the company
      const company = await resolveCompany(companyName)
      console.log("🏢 Company resolved:", company)
      
      if (company) {
        // Then get contacts for the company
        const companyContactsList = await companyContacts(companyName)
        console.log("👥 Company contacts:", companyContactsList)
        setContacts(companyContactsList)
      } else {
        setContacts([])
        alert(`Company "${companyName}" not found`)
      }
    } catch (error) {
      console.error("❌ Company search error:", error)
      alert(`Search failed: ${error}`)
      setContacts([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      padding:12,
      border:'2px solid #00ff00',
      background:'rgba(0,255,0,0.1)',
      display:'flex',
      flexDirection:'column',
      gap:12,
      position:'relative',
      zIndex:9999,
      margin:'10px',
      minWidth:'400px'
    }}>
      <div style={{display:'flex', gap:8, alignItems:'center'}}>
        <span style={{color:'#00ff00', fontWeight:'bold'}}>Agent is alive ✅</span>
        <button 
          onClick={handleProbeClick}
          onMouseDown={() => console.log("🖱️ BUTTON MOUSE DOWN")}
          style={{
            padding:'8px 16px',
            background:'#00ff00',
            color:'black',
            border:'none',
            borderRadius:4,
            cursor:'pointer',
            fontSize:'14px',
            fontWeight:'bold',
            position:'relative',
            zIndex:10000
          }}
        >
          PROBE TEST
        </button>
      </div>
      
      {/* Company Search Section */}
      <div style={{borderTop:'1px solid #00ff00', paddingTop:12}}>
        <h3 style={{color:'#00ff00', margin:'0 0 8px 0', fontSize:'16px'}}>Company Search</h3>
        <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:12}}>
          <input
            type="text"
            placeholder="Enter company name (try 'TestCo')"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleCompanySearch()}
            style={{
              padding:'8px 12px',
              border:'1px solid #00ff00',
              borderRadius:4,
              background:'rgba(0,0,0,0.3)',
              color:'#00ff00',
              fontSize:'14px',
              flex:1,
              minWidth:0
            }}
          />
          <button
            onClick={handleCompanySearch}
            disabled={loading || !companyName.trim()}
            style={{
              padding:'8px 16px',
              background: loading || !companyName.trim() ? '#666' : '#00ff00',
              color: loading || !companyName.trim() ? '#999' : 'black',
              border:'none',
              borderRadius:4,
              cursor: loading || !companyName.trim() ? 'not-allowed' : 'pointer',
              fontSize:'14px',
              fontWeight:'bold'
            }}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
        
        {/* Results Table */}
        {contacts.length > 0 && (
          <div style={{marginTop:12}}>
            <h4 style={{color:'#00ff00', margin:'0 0 8px 0', fontSize:'14px'}}>Contacts Found:</h4>
            <div style={{
              border:'1px solid #00ff00',
              borderRadius:4,
              background:'rgba(0,0,0,0.2)',
              maxHeight:'200px',
              overflowY:'auto'
            }}>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:'12px'}}>
                <thead>
                  <tr style={{background:'rgba(0,255,0,0.1)'}}>
                    <th style={{padding:'8px', borderBottom:'1px solid #00ff00', color:'#00ff00', textAlign:'left'}}>Name</th>
                    <th style={{padding:'8px', borderBottom:'1px solid #00ff00', color:'#00ff00', textAlign:'left'}}>Title</th>
                    <th style={{padding:'8px', borderBottom:'1px solid #00ff00', color:'#00ff00', textAlign:'left'}}>Company</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact, index) => (
                    <tr key={contact.id} style={{borderBottom:'1px solid rgba(0,255,0,0.2)'}}>
                      <td style={{padding:'8px', color:'#fff'}}>{contact.name}</td>
                      <td style={{padding:'8px', color:'#fff'}}>{contact.title}</td>
                      <td style={{padding:'8px', color:'#fff'}}>{contact.company}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
