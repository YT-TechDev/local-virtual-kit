import{useEffect,useState}from'react'
import type{MotionFrame as F}from'@lvk/motion-protocol'
import{r}from'./nativeMotion'
import{c}from'./nativeSocket'
export function useNativeMotionFrame(on:boolean):F|null{const[f,s]=useState<F|null>(null);useEffect(()=>{if(!on){s(null);r();return}const w=c(s);return()=>w.close()},[on]);return f}
