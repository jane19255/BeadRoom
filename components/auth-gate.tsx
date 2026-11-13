"use client"

import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import type { Session } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase/client"
import { Spinner } from "@/components/feedback"

/**
 * Shows the login screen until someone signs in, then the app.
 * The app (and all its data loading) only mounts after sign-in, and signing out
 * unmounts it again, so nothing from the last session stays on screen.
 * Real protection is in Supabase: the tables only allow signed-in users (row level security).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => { if (alive) setSession(data.session) })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => { alive = false; data.subscription.unsubscribe() }
  }, [])

  if (session === undefined) {
    return (
      <div className="login-screen" aria-busy="true">
        <Spinner />
      </div>
    )
  }
  if (!session) return <LoginScreen />
  return <>{children}</>
}

function LoginScreen() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) { setError("Enter your email and password."); return }
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) {
      setError(
        /invalid login credentials/i.test(error.message)
          ? "Wrong email or password."
          : /fetch|network/i.test(error.message)
            ? "Can't reach the server. Check your internet connection."
            : error.message,
      )
      setBusy(false)
    }
    // On success AuthGate switches to the app by itself.
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit} noValidate>
        <div className="login-card__brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>BeadRoom</span>
        </div>
        <h1>Sign in</h1>
        <p className="login-card__hint">This is a private bead room. Sign in to see your projects and colours.</p>

        <label className="login-card__field">
          <span>Email</span>
          <input
            type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false}
            value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} autoFocus
          />
        </label>
        <label className="login-card__field">
          <span>Password</span>
          <input
            type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy}
          />
        </label>

        {error && <p className="login-card__error" role="alert">{error}</p>}

        <button className="primary-button login-card__submit" disabled={busy} type="submit">
          {busy ? <><Spinner /> Signing in…</> : "Sign in"}
        </button>
      </form>
    </div>
  )
}
