'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const input = username.trim().toLowerCase()
      const email = input.includes('@') ? input : `${input}@three-sinha.com`

      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })

      if (authError || !data.user) {
        setError('Invalid username or password.')
        setLoading(false)
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single()

      if (profileError || !profile) {
        setError('Your account profile is not ready. Please ask the admin to check Supabase setup.')
        setLoading(false)
        return
      }

      router.push(profile.role === 'admin' ? '/admin' : '/dashboard')
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <main className="login-bg">
      <section className="login-card">
        <div className="login-brand">
          <div className="brand-mark large">TS</div>
          <h1>Three Sinha</h1>
          <p>Job Follow-up & Reporting System</p>
        </div>

        {error && <div className="alert error">{error}</div>}

        <form onSubmit={handleLogin}>
          <div>
            <label className="form-label">Username</label>
            <input
              id="username"
              className="form-input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin or user1"
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label className="form-label">Password</label>
            <div className="password-field">
              <input
                id="password"
                className="form-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
              <button type="button" className="btn-secondary icon-btn" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button className="btn-primary login-submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </section>
    </main>
  )
}
