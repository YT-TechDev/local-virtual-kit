import type{MotionFrame as F}from'@lvk/motion-protocol'
import{n,o}from'./nativeShape'
let t=-1/0
export const r=()=>t=-1/0
export function p(s:string):F|null{try{const v=JSON.parse(s);if(!o(v)||!n(v)||v.timestampMs<=t)return null;t=v.timestampMs;return v as F}catch{return null}}
