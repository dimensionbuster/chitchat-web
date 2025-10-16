export function observeYjsArray(messages: unknown, onChange: () => void) {
  // quick guard for objects with Yjs-like observe API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!messages || (messages as any).observe == null || typeof (messages as any).observe !== 'function') return () => {}
  const observer = () => onChange()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(messages as any).observe(observer)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return () => (messages as any).unobserve(observer)
}
