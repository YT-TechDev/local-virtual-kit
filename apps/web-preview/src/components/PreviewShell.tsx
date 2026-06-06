import type{ReactNode}from'react'
type P={mode:'default'|'obs';children:ReactNode}
export function PreviewShell(p:P){return <main className={`preview-shell preview-shell--${p.mode}`}><section className={`preview-panel preview-panel--${p.mode}`}>{p.children}</section></main>}
