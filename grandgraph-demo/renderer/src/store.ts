type Store = { cacheFirst: boolean, setCacheFirst: (b:boolean)=>void }

// ultra-light store without deps
class SimpleStore {
  state: Store
  listeners: Array<()=>void> = []
  constructor(){ this.state = { cacheFirst: true, setCacheFirst: (b)=>{ this.state.cacheFirst = b; this.emit() } } }
  getState(){ return this.state }
  subscribe(fn: ()=>void){ this.listeners.push(fn); return ()=>{ this.listeners = this.listeners.filter(f=>f!==fn) } }
  emit(){ for (const l of this.listeners) try { l() } catch {} }
}

export const store = new SimpleStore()
export const useStore = { getState: ()=>store.getState(), subscribe: (fn:()=>void)=>store.subscribe(fn) }
