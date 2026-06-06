import{useDummyMotionFrame as d}from'./useDummyMotionFrame'
import{useNativeMotionFrame as n}from'./useNativeMotionFrame'
export function usePreviewMotionFrame(s:'dummy'|'native',t:number){const a=d(t),b=n(s==='native');return b??a}
