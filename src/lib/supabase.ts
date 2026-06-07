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
      edit_requests: {
        Row: {
          id: string
          job_id: string
          user_id: string
          requested_column: string
          message: string
          status: 'pending' | 'approved' | 'rejected' | 'completed'
          admin_response: string | null
          approved_by: string | null
          approved_at: string | null
          completed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          job_id: string
          user_id: string
          requested_column: string
          message: string
          status?: 'pending' | 'approved' | 'rejected' | 'completed'
          admin_response?: string | null
          approved_by?: string | null
          approved_at?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          requested_column?: string
          message?: string
          status?: 'pending' | 'approved' | 'rejected' | 'completed'
          admin_response?: string | null
          approved_by?: string | null
          approved_at?: string | null
          completed_at?: string | null
          updated_at?: string
        }
      }
      user_notifications: {
        Row: {
          id: string
          user_id: string
          title: string
          message: string
          type: string
          related_request_id: string | null
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          message: string
          type?: string
          related_request_id?: string | null
          read_at?: string | null
          created_at?: string
        }
        Update: {
          title?: string
          message?: string
          type?: string
          related_request_id?: string | null
          read_at?: string | null
        }
      }
      call_events: {
        Row: {
          id: string
          client_event_id: string
          device_id: string
          agent_name: string | null
          source: 'cellular' | 'whatsapp' | 'whatsapp_business' | 'other'
          direction: 'incoming' | 'outgoing' | 'missed' | 'unknown'
          status: 'ringing' | 'active' | 'ended' | 'missed' | 'declined' | 'captured' | 'unknown'
          contact_name: string | null
          phone_number: string | null
          app_package: string | null
          started_at: string | null
          ended_at: string | null
          duration_seconds: number | null
          captured_at: string
          notification_title: string | null
          notification_text: string | null
          notes: string | null
          raw_payload: unknown
          created_at: string
        }
        Insert: {
          id?: string
          client_event_id: string
          device_id: string
          agent_name?: string | null
          source?: 'cellular' | 'whatsapp' | 'whatsapp_business' | 'other'
          direction?: 'incoming' | 'outgoing' | 'missed' | 'unknown'
          status?: 'ringing' | 'active' | 'ended' | 'missed' | 'declined' | 'captured' | 'unknown'
          contact_name?: string | null
          phone_number?: string | null
          app_package?: string | null
          started_at?: string | null
          ended_at?: string | null
          duration_seconds?: number | null
          captured_at?: string
          notification_title?: string | null
          notification_text?: string | null
          notes?: string | null
          raw_payload?: unknown
          created_at?: string
        }
        Update: {
          agent_name?: string | null
          source?: 'cellular' | 'whatsapp' | 'whatsapp_business' | 'other'
          direction?: 'incoming' | 'outgoing' | 'missed' | 'unknown'
          status?: 'ringing' | 'active' | 'ended' | 'missed' | 'declined' | 'captured' | 'unknown'
          contact_name?: string | null
          phone_number?: string | null
          app_package?: string | null
          started_at?: string | null
          ended_at?: string | null
          duration_seconds?: number | null
          captured_at?: string
          notification_title?: string | null
          notification_text?: string | null
          notes?: string | null
          raw_payload?: unknown
        }
      }
    }
  }
}
