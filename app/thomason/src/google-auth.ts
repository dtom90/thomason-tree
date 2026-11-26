import { supabase } from './lib/supabase'

/**
 * Per-file Drive scope: only folders/files this app creates or the user opens via Google Picker.
 * Safer than full `drive`; family folder access comes from a one-time picker confirm.
 */
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

export async function signInWithGoogleDrive(redirectTo = window.location.origin): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      scopes: GOOGLE_DRIVE_SCOPE,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  })
  if (error) throw error
}

/** Google OAuth access token from the current session (requires Drive scope on sign-in). */
export async function getGoogleProviderToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not signed in')
  const token = session.provider_token
  if (!token) {
    throw new Error(
      'Google Drive access is missing. Sign out and sign in again to grant Drive permission.',
    )
  }
  return token
}
