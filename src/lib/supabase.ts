import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string
          email: string | null
          role: 'admin' | 'user'
          created_at: string
        }
        Insert: {
          id: string
          username: string
          email?: string | null
          role?: 'admin' | 'user'
          created_at?: string
        }
        Update: {
          username?: string
          email?: string | null
          role?: 'admin' | 'user'
        }
      }
      jobs: {
        Row: {
          id: string
          user_id: string
          date: string
          job_no: string
          cx_name: string
          contact_no: string
          job_amount: number
          amount_received: number
          remaining_amount: number
          received_date: string | null
          first_follow_up: string | null
          second_follow_up: string | null
          status: 'Positive' | 'Negative' | 'Pending'
          action_require: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          date?: string
          job_no: string
          cx_name: string
          contact_no: string
          job_amount: number
          amount_received?: number
          received_date?: string | null
          first_follow_up?: string | null
          second_follow_up?: string | null
          status?: 'Positive' | 'Negative' | 'Pending'
          action_require?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          date?: string
          job_no?: string
          cx_name?: string
          contact_no?: string
          job_amount?: number
          amount_received?: number
          received_date?: string | null
          first_follow_up?: string | null
          second_follow_up?: string | null
          status?: 'Positive' | 'Negative' | 'Pending'
          action_require?: string
          updated_at?: string
        }
      }
    }
  }
}
