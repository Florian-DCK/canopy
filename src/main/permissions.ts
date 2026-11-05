import { shell, systemPreferences } from 'electron'

// macOS : état des autorisations dont Canopy a besoin (écran, micro, accessibilité). Sous Windows : tout est accordé.

export type MacPermission = 'screen' | 'microphone' | 'accessibility'
export type PermissionState = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'
export type MacPermissions = Record<MacPermission, PermissionState>

export function macPermissions(): MacPermissions {
  if (process.platform !== 'darwin') return { screen: 'granted', microphone: 'granted', accessibility: 'granted' }
  return {
    screen: systemPreferences.getMediaAccessStatus('screen'),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied'
  }
}

export async function askMacPermission(kind: MacPermission): Promise<void> {
  if (process.platform !== 'darwin') return
  if (kind === 'microphone') await systemPreferences.askForMediaAccess('microphone')
  else if (kind === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true)
  else await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
}
