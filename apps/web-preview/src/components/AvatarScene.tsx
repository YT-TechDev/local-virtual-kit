import{DummyAvatar as D}from'./DummyAvatar'
import{SceneLights as L}from'./SceneLights'
import{usePreviewTime as t}from'../hooks/usePreviewTime'
import{usePreviewMotionFrame as f}from'../hooks/usePreviewMotionFrame'
import{mapMotionFrameToAvatar as m}from'../motion/mapMotionFrameToAvatar'
type S='dummy'|'native'
export function AvatarScene(p:{source:S}){return <><L/><D motion={m(f(p.source,t()))}/></>}
