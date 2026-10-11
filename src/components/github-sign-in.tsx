import { Github } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/toaster'
import { friendlyError } from '@/lib/errors'
import { loadConfig, makeCloudClient } from '@/lib/cloud-config'
import { isTauri, openInBrowser } from '@/lib/tauri'

export interface SignInState {
  /** A session exists — the source of truth (email may be hidden). */
  signedIn: boolean
  email: string | null
}

/**
 * Shared GitHub OAuth flow (system browser + pasted code, the same pattern
 * `gh`/`gcloud` CLIs use): opens the sign-in link in the user's real
 * browser, then exchanges a pasted `code` for a session. Used by both
 * Settings and the onboarding wizard.
 *
 * Signed-in state is the session, not the email: GitHub users with private
 * emails have no visible address, and gating on email made successful
 * sign-ins look like nothing happened.
 */
export function useGitHubSignIn(onSignedIn: (state: SignInState) => void): {
  signIn: () => Promise<void>
  confirmCode: (code: string) => Promise<void>
  cancel: () => void
  signingIn: boolean
  authUrl: string | null
} {
  const toast = useToast()
  const [signingIn, setSigningIn] = React.useState(false)
  const [authUrl, setAuthUrl] = React.useState<string | null>(null)
  const onSignedInRef = React.useRef(onSignedIn)
  onSignedInRef.current = onSignedIn

  const finish = React.useCallback(
    async (email: string | null, signedIn: boolean) => {
      onSignedInRef.current({ email, signedIn })
    },
    [],
  )

  const signIn = React.useCallback(async () => {
    if (!isTauri()) {
      toast('Sign-in needs the desktop app — run `npm run tauri dev`.', 'error')
      return
    }
    setSigningIn(true)
    try {
      const client = makeCloudClient(await loadConfig())
      const url = await client.oAuthUrl()
      setAuthUrl(url)
      await openInBrowser(url)
      toast('Browser opened — approve on GitHub, then paste the code here.')
    } catch (err) {
      setAuthUrl(null)
      setSigningIn(false)
      toast(friendlyError(err, 'Sign-in failed.'), 'error')
    }
  }, [toast])

  /** Accept a bare code or a full callback URL paste. */
  function extractCode(input: string): string {
    const m = input.match(/[?&#]code=([^&#\s]+)/)
    return (m !== null ? m[1] : input).trim()
  }

  const confirmCode = React.useCallback(
    async (raw: string) => {
      const code = extractCode(raw)
      if (code === '') return
      try {
        const client = makeCloudClient(await loadConfig())
        await client.exchangeCodeForSession(code)
        const email = await client.sessionEmail()
        setAuthUrl(null)
        setSigningIn(false)
        await finish(email, true)
        toast(email !== null ? `Signed in as ${email}.` : 'Signed in with GitHub.')
      } catch (err) {
        toast(friendlyError(err, 'That code didn’t work — it may have expired. Get a fresh link and try again.'), 'error')
      }
    },
    [toast, finish],
  )

  const cancel = React.useCallback(() => {
    setAuthUrl(null)
    setSigningIn(false)
  }, [])

  return { signIn, confirmCode, cancel, signingIn, authUrl }
}

export function GitHubSignInButton({ onSignedIn }: { onSignedIn: (state: SignInState) => void }): React.JSX.Element {
  const toast = useToast()
  const { signIn, confirmCode, cancel, signingIn, authUrl } = useGitHubSignIn(onSignedIn)
  const [code, setCode] = React.useState('')

  async function copyLink(): Promise<void> {
    if (authUrl === null) return
    try {
      await navigator.clipboard.writeText(authUrl)
      toast('Sign-in link copied — open it in your browser.')
    } catch {
      toast('Copy failed — the link is unavailable.', 'error')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {!signingIn && (
        <div>
          <Button type="button" onClick={() => void signIn()} disabled={!isTauri()}>
            <Github aria-hidden /> Sign in with GitHub
          </Button>
        </div>
      )}
      {signingIn && authUrl !== null && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <p className="text-sm">
            Approve in your browser — it lands on an <code>env-manager.local</code> error page (expected).
            Copy the <code>code</code> from that page’s address bar and paste it here.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Code from browser address bar"
              placeholder="paste code (or full address) here"
              autoComplete="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const c = code
                  setCode('')
                  void confirmCode(c)
                }
              }}
              className="min-w-0 flex-1 font-mono"
            />
            <Button
              type="button"
              variant="secondary"
              disabled={code.trim() === ''}
              onClick={() => {
                const c = code
                setCode('')
                void confirmCode(c)
              }}
            >
              Confirm
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => void copyLink()}>
              Copy sign-in link again
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
