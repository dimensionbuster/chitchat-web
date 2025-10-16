import type { ChatMessage } from '@/types/types'
import { Array } from 'yjs'
export function observeYjsArray(messages: Array<ChatMessage>, onChange: () => void) {
  if (!messages || messages.observe == null || typeof messages.observe !== 'function')
    return () => {
      console.warn('Invalid Yjs array provided to observeYjsArray')
      return
    }
  const observer = async () => await onChange()
  messages.observe(observer)
  return () => messages.unobserve(observer)
}
