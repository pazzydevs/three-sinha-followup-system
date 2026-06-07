/* eslint-disable @typescript-eslint/no-require-imports */
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dkxcvbfsmjfsdypavemi.supabase.co'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const seedUsers = [
  { username: 'pasindu', password: 'admin890', role: 'admin', previousUsername: 'admin' },
  { username: 'user1', password: 'user1', role: 'user' },
]

if (!serviceKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required to create or update auth users.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function upsertUser({ username, password, role, previousUsername }) {
  const email = `${username}@three-sinha.com`
  const previousEmail = previousUsername ? `${previousUsername}@three-sinha.com` : null
  const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers()

  if (listError) throw listError

  const existing =
    existingUsers.users.find((user) => user.email === email) ||
    (previousEmail ? existingUsers.users.find((user) => user.email === previousEmail) : null)
  let userId = existing?.id

  if (existing) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      email,
      password,
      email_confirm: true,
      user_metadata: { username },
    })
    if (error) throw error
    console.log(`Updated auth user ${email}`)
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username },
    })
    if (error) throw error
    userId = data.user.id
    console.log(`Created auth user ${email}`)
  }

  let { error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: userId, username, email, role }, { onConflict: 'id' })

  if (profileError?.code === 'PGRST204') {
    const fallback = await supabase
      .from('profiles')
      .upsert({ id: userId, username, role }, { onConflict: 'id' })

    profileError = fallback.error
  }

  if (profileError) throw profileError
  console.log(`Profile ready for ${username} (${role})`)
}

async function main() {
  for (const user of seedUsers) {
    await upsertUser(user)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
