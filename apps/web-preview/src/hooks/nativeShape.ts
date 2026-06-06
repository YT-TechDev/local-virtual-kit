export type R=Record<string,unknown>
export const o=(v:unknown):v is R=>!!v&&typeof v==='object'
export const n=(v:R)=>v.schemaVersion===1&&v.source==='native'&&typeof v.timestampMs==='number'&&o(v.tracking)&&o(v.face)&&o(v.eyes)&&o(v.mouth)
