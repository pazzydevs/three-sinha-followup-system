# Security Policy

## Baseline

This project follows an OWASP ASVS Level 2 oriented development baseline for a business web application. The goal is to keep authentication, authorization, input validation, secret handling, browser security headers, and webhook delivery consistent as the system evolves.

## Current Controls

- Authentication is handled by Supabase Auth.
- Authorization is enforced through Supabase RLS and server-side admin role checks.
- Admin API routes require a valid Supabase bearer token, admin profile role, same-origin requests, JSON content type, request size limits, and per-action rate limits.
- n8n webhook URLs are validated server-side, limited to HTTPS n8n webhook paths, and restricted to configured hosts.
- Scheduled report delivery supports `CRON_SECRET`; Vercel sends it as a bearer token when configured.
- Security headers are configured globally in `next.config.ts`.
- API responses that handle sensitive operations use `Cache-Control: no-store`.

## Future Changes

- Keep all secrets in Vercel or Supabase configuration, never in source control.
- Add new privileged operations as server API routes protected by `requireAdmin`.
- Add validation for every new external input before database writes or outbound requests.
- Keep Supabase RLS policies aligned with any schema changes.
- Run `npm run lint`, `npm run build`, and `npm audit --audit-level=moderate` before deployment.
