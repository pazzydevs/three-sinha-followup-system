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

type RouteContext = {
  params: Promise<{ id: string }>
}

type UpdateUserBody = {
  username: unknown
  email: unknown
  password?: unknown
}

function isMissingEmailColumn(message: string) {
  return message.includes("'email' column") || message.includes('column "email"')
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = await readJsonBody<UpdateUserBody>(req)
    if (!body.ok) return body.response

    const admin = await requireAdmin(req, 'update-user')
    if (!admin.ok) return admin.response

    const cleanUsername = normalizeUsername(body.data.username)
    const usernameError = validateUsername(cleanUsername)
    if (usernameError) return securityError(usernameError, 400)

    const { email, error: emailError } = validateEmail(body.data.email)
    if (emailError) return securityError(emailError, 400)

    const { password, error: passwordError } = validatePassword(body.data.password, false)
    if (passwordError) return securityError(passwordError, 400)

    const updatePayload: {
      email: string
      email_confirm: boolean
      user_metadata: { username: string }
      password?: string
    } = {
      email,
      email_confirm: true,
      user_metadata: { username: cleanUsername },
    }

    if (password) {
      updatePayload.password = password
    }

    const { error: authError } = await admin.supabaseAdmin.auth.admin.updateUserById(id, updatePayload)
    if (authError) {
      return securityError(authError.message, 400)
    }

    const { error: profileError } = await admin.supabaseAdmin
      .from('profiles')
      .update({ username: cleanUsername, email })
      .eq('id', id)

    if (profileError) {
      if (!isMissingEmailColumn(profileError.message)) {
        return securityError(profileError.message, 500)
      }

      const { error: fallbackProfileError } = await admin.supabaseAdmin
        .from('profiles')
        .update({ username: cleanUsername })
        .eq('id', id)

      if (fallbackProfileError) {
        return securityError(fallbackProfileError.message, 500)
      }
    }

    return secureJson({ success: true })
  } catch {
    return securityError('Internal server error', 500)
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const admin = await requireAdmin(req, 'delete-user')
    if (!admin.ok) return admin.response

    if (id === admin.userId) {
      return securityError('Admins cannot delete their own account.', 400)
    }

    const { error } = await admin.supabaseAdmin.auth.admin.deleteUser(id)
    if (error) {
      return securityError(error.message, 400)
    }

    return secureJson({ success: true })
  } catch {
    return securityError('Internal server error', 500)
  }
}
