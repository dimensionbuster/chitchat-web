import type { ElectronApi } from '@/types/window'

/**
 * 현재 실행 환경이 Electron인지 확인합니다.
 * @returns Electron 환경이면 true, 웹 브라우저면 false
 */
export function isElectron(): boolean {
  // window.electronApi가 존재하면 Electron 환경
  // preload.ts에서 contextBridge.exposeInMainWorld로 노출됨
  return typeof window !== 'undefined' && !!window.electronApi
}

/**
 * Electron API에 안전하게 접근합니다.
 * @returns Electron API 객체 또는 undefined
 */
export function getElectronApi(): ElectronApi | undefined {
  if (!isElectron()) return undefined
  return window.electronApi
}
