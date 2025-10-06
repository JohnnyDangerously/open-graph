import React from "react";

export default function CompareLists({ labels, metaNodes, groups, onFocusIndex }:{ labels:string[], metaNodes:Array<Record<string,any>>, groups:{ left:number[], right:number[], overlap:number[], lists?: { mutualF1:number[], aF1_bF2:number[], bF1_aF2:number[], aOnly:number[], bOnly:number[] } }, onFocusIndex:(i:number)=>void }){
  if (!groups || (!groups.left?.length && !groups.right?.length && !groups.overlap?.length)) {
    return <div style={{ fontSize:12, color:'var(--dt-text-dim)', padding:'8px 0' }}>No compare results.</div>
  }
  // Build derived sets from available compareIndexGroups if present on tile
  // We expect ring segregation encoded in positions, but we will approximate using membership of groups.
  const [open, setOpen] = React.useState<{[k:string]:boolean}>({ shared:true, a1b2:true, a2b1:true, aOnly:true, bOnly:true })

  // Helper: render a collapsible section
  const Section = ({ id, title, ids }:{ id:string, title:string, ids:number[] }) => (
    <div style={{ marginBottom:10 }}>
      <button onClick={()=> setOpen(o=> ({ ...o, [id]: !o[id] }))} style={{ width:'100%', textAlign:'left', padding:'6px 8px', border:'1px solid var(--dt-border)', background:'var(--dt-fill-weak)', color:'var(--dt-text)', borderRadius:8 }}>
        {title} <span style={{ float:'right', opacity:0.7 }}>{ids.length}</span>
      </button>
      {open[id] && (
        <div style={{ maxHeight:220, overflow:'auto', border:'1px solid var(--dt-border)', borderTop:'none', borderRadius:'0 0 8px 8px' }}>
          {ids.slice(0,800).map(i=> (
            <div key={`${id}-${i}`} onClick={()=> onFocusIndex(i)} style={{ padding:'6px 8px', cursor:'pointer', borderBottom:'1px solid var(--dt-border)', background:'var(--dt-bg)' }}>
              <div style={{ fontSize:12, color:'var(--dt-text)' }}>{labels?.[i] || (metaNodes?.[i] as any)?.full_name || (metaNodes?.[i] as any)?.name || `#${i}`}</div>
              <div style={{ fontSize:11, color:'var(--dt-text-dim)' }}>{(metaNodes?.[i] as any)?.title || ''}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // Derive approximations: we don’t have ring-level ids here, so we show 3 logical partitions and two exclusives derived from compareIndexGroups populations created at placement-time.
  const left = groups.left || []
  const right = groups.right || []
  const overlap = groups.overlap || []
  const shared = groups.lists?.mutualF1 ?? overlap
  const a1b2 = groups.lists?.aF1_bF2 ?? []
  const a2b1 = groups.lists?.bF1_aF2 ?? []
  const aOnly = groups.lists?.aOnly ?? left.filter(i=> !shared.includes(i))
  const bOnly = groups.lists?.bOnly ?? right.filter(i=> !shared.includes(i))

  return (
    <div style={{ display:'grid', gap:10 }}>
      <Section id="shared" title="A ∩ B • Shared overlaps" ids={shared} />
      <Section id="a1b2" title="A 1° ∩ B 2°" ids={a1b2} />
      <Section id="a2b1" title="A 2° ∩ B 1°" ids={a2b1} />
      <Section id="aOnly" title="A exclusive" ids={aOnly} />
      <Section id="bOnly" title="B exclusive" ids={bOnly} />
    </div>
  )
}


