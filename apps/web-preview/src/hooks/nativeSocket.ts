import type{MotionFrame as F}from'@lvk/motion-protocol'
import{p}from'./nativeMotion'
const U='ws://127.0.0.1:45731/motion'
export const c=(s:(f:F|null)=>void)=>{const w=new WebSocket(U);w.onmessage=e=>{const x=p(String(e.data));if(x)s(x)};w.onclose=()=>s(null);w.onerror=()=>s(null);return w}
