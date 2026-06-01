import { NextRequest } from 'next/server'
import {
  normalizeUsername,
  readJsonBody,
  requireAdmin,
  secureJson,
  securityError,
  validateEmail,
  validatePassword,
  validateUsername,
} from '@/lib/server-security'

type CreateUserBody = {
  username: unknown
  password: unknown
  email: unknown
}

function isMissingEmailColumn(message: string) {
  return message.includes("'email' column") || message.includes('column "email"')
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody<CreateUserBody>(req)
    if (!body.ok) return body.response

    const admin = await requireAdmin(req, 'create-user')
    if (!admin.ok) return admin.response

    const cleanUsername = normalizeUsername(body.data.username)
    const usernameError = validateUsername(cleanUsername)
    if (usernameError) return securityError(usernameError, 400)

    const { email, error: emailError } = validateEmail(body.data.email)
    if (emailError) return securityError(emailError, 400)

    const { password, error: passwordError } = validatePassword(body.data.password, true)
    if (passwordError) return securityError(passwordError, 400)

    const { data: authData, error: authError } = await admin.supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: cleanUsername },
    })

    if (authError) {
      return securityError(authError.message, 400)
    }

    if (authData.user) {
      const { error: insertProfileError } = await admin.supabaseAdmin
        .from('profiles')
        .upsert({ id: authData.user.id, username: cleanUsername, email, role: 'user' }, { onConflict: 'id' })

      if (insertProfileError) {
        if (!isMissingEmailColumn(insertProfileError.message)) {
          return securityError(insertProfileError.message, 500)
        }

        const { error: fallbackProfileError } = await admin.supabaseAdmin
          .from('profiles')
          .upsert({ id: authData.user.id, username: cleanUsername, role: 'user' }, { onConflict: 'id' })

        if (fallbackProfileError) {
          return securityError(fallbackProfileError.message, 500)
        }
      }
    }

    return secureJson({ success: true })
  } catch {
    return securityError('Internal server error', 500)
  }
}
