import{useEffect,useState}from'react'
import type{MotionFrame as F}from'@lvk/motion-protocol'
import{p,r}from'./nativeMotion'
const U='ws://127.0.0.1:45731/motion'
export function useNativeMotionFrame(on:boolean):F|null{const[f,s]=useState<F|null>(null);useEffect(()=>{if(!on){s(null);r();return}const w=new WebSocket(U),x=()=>s(null);w.onclose