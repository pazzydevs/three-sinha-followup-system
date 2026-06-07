/* eslint-disable @typescript-eslint/no-require-imports */
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dkxcvbfsmjfsdypavemi.supabase.co'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_j391WK7vIwyCAjqa25_sxw_aY2hVs2C'

async function checkLogin(username, password) {
  const supabase = createClient(supabaseUrl, supabaseKey)
  const email = `${username}@three-sinha.com`
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    console.log(`FAIL ${username}: ${error?.message || 'No user returned'}`)
    return false
  }

  const profileResult = await supabase
    .from('profiles')
    .select('username, role')
    .eq('id', data.user.id)
    .maybeSingle()

  if (profileResult.error) {
    console.log(`FAIL ${username}: profile query error - ${profileResult.error.message}`)
    await supabase.auth.signOut()
    return false
  }

  console.log(`OK ${username}: login works, profile=${JSON.stringify(profileResult.data)}`)
  await supabase.auth.signOut()
  return true
}

async function main() {
  console.log('Three Sinha database check')
  console.log('--------------------------')

  const publicClient = createClient(supabaseUrl, supabaseKey)
  const { error: profilesError } = await publicClient.from('profiles').select('id').limit(1)
  const { error: jobsError } = await publicClient.from('jobs').select('id').limit(1)

  if (profilesError?.code === '42P01' || jobsError?.code === '42P01') {
    console.log('FAIL tables are missing. Run supabase/setup.sql in the Supabase SQL editor.')
    return
  }

  if (profilesError?.code === '42P17' || jobsError?.code === '42P17') {
    console.log('FAIL RLS recursion detected. Re-run supabase/setup.sql to replace recursive policies.')
  } else {
    console.log('OK tables are reachable through the REST API.')
  }

  await checkLogin('pasindu', 'admin890')
  await checkLogin('user1', 'user1')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
