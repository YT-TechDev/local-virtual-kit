import{DummyAvatar as D}from'./DummyAvatar'
import{usePreviewTime as t}from'../hooks/usePreviewTime'
import{usePreviewMotionFrame as f}from'../hooks/usePreviewMotionFrame'
import{mapMotionFrameToAvatar as m}from'../motion/mapMotionFrameToAvatar'
export function AvatarScene({source}:{source:'dummy'|'native'}){return <D motion={m(f(source,t()))}/>}
