import React from 'react'
import { useSlate } from '../../hooks/use-slate'

// import { log } from '../../utils/log'
import { VirtualCursor } from './virtual-cursor'

export const CursorWithInput: React.FC<{
  isEditorFocused: boolean
}> = props => {
  const { isEditorFocused } = props
  // const editor = useSlate()

  return <VirtualCursor twinkling cursorHidden={!isEditorFocused} />
}
