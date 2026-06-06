import { Canvas, useFrame } from '@react-three/fiber'
import { useState } from 'react'
import { DummyAvatar } from './DummyAvatar'
import { useDummyMotionFrame } from '../hooks/useDummyMotionFrame'
import { mapMotionFrameToAvatar } from '../motion/mapMotionFrameToAvatar'

function Scene(){const[,t]=useState(0);useFrame(({clock})=>t(clock.elapsedTime));const a=mapMotionFrameToAvatar(useDummyMotionFrame());return <><ambientLight/><pointLight position={[3,3,3]}/><DummyAvatar a={a}/></>}

export function AvatarPreview(){return <div className="preview"><Canvas camera={{position:[0,0,5]}}><Scene/></Canvas></div>}
