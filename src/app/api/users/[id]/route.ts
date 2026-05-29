import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const { username, email, password } = await req.json()
    const clients = await getAdminClients(req)

    if (clients.error) return clients.error

    const cleanUsername = String(username || '').trim().toLowerCase()
    const cleanEmail = String(email || '').trim().toLowerCase()
    const cleanPassword = String(password || '')

    if (!cleanUsername || !cleanEmail) {
      return NextResponse.json({ error: 'Username and email are required.' }, { status: 400 })
    }

    if (cleanPassword && cleanPassword.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
    }

    const updatePayload: {
      email: string
      email_confirm: boolean
      user_metadata: { username: string }
      password?: string
    } = {
      email: cleanEmail,
      email_confirm: true,
      user_metadata: { username: cleanUsername },
    }

    if (cleanPassword) {
      updatePayload.password = cleanPassword
    }

    const { error: authError } = await clients.supabaseAdmin.auth.admin.updateUserById(id, updatePayload)
    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    const { error: profileError } = await clients.supabaseAdmin
      .from('profiles')
      .update({ username: cleanUsername, email: cleanEmail })
      .eq('id', id)

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const clients = await getAdminClients(req)

    if (clients.error) return clients.error

    const { error } = await clients.supabaseAdmin.auth.admin.deleteUser(id)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function getAdminClients(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !anonKey) {
    return { error: NextResponse.json({ error: 'Supabase public environment variables are missing.' }, { status: 500 }) }
  }

  if (!serviceKey) {
    return { error: NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required to manage users.' }, { status: 500 }) }
  }

  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (!token) {
    return { error: NextResponse.json({ error: 'Missing admin session.' }, { status: 401 }) }
  }

  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: { user }, error: userError } = await supabaseUser.auth.getUser(token)
  if (userError || !user) {
    return { error: NextResponse.json({ error: 'Invalid admin session.' }, { status: 401 }) }
  }

  const { data: profile, error: profileError } = await supabaseUser
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError || profile?.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Only admins can manage users.' }, { status: 403 }) }
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  return { supabaseAdmin }
}
