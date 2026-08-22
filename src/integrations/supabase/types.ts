export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_analysis_jobs: {
        Row: {
          attempts: number
          claimed_at: string | null
          contact_id: string
          conversation_id: string | null
          created_at: string
          finished_at: string | null
          id: string
          last_error: string | null
          reason: string
          requested_at: string
          status: Database["public"]["Enums"]["ai_job_status"]
          user_id: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          contact_id: string
          conversation_id?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          reason?: string
          requested_at?: string
          status?: Database["public"]["Enums"]["ai_job_status"]
          user_id: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          contact_id?: string
          conversation_id?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          reason?: string
          requested_at?: string
          status?: Database["public"]["Enums"]["ai_job_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_analysis_jobs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_analysis_jobs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_events: {
        Row: {
          contact_id: string | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          estimated_cost_usd: number | null
          id: string
          input_tokens: number | null
          model: string
          output_tokens: number | null
          prompt_version: string
          purpose: string
          status: string
          total_tokens: number | null
          user_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          model: string
          output_tokens?: number | null
          prompt_version: string
          purpose?: string
          status?: string
          total_tokens?: number | null
          user_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          model?: string
          output_tokens?: number | null
          prompt_version?: string
          purpose?: string
          status?: string
          total_tokens?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_archived: boolean
          name: string
          notes: string | null
          phone: string | null
          source: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          is_archived?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_archived?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      conversation_insights: {
        Row: {
          confidence: number
          contact_id: string
          content: string
          conversation_id: string | null
          created_at: string
          dedupe_key: string | null
          id: string
          insight_type: string
          metadata: Json
          opportunity_id: string | null
          source: Database["public"]["Enums"]["memory_source"]
          source_message_id: string | null
          status: Database["public"]["Enums"]["insight_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence?: number
          contact_id: string
          content: string
          conversation_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          insight_type: string
          metadata?: Json
          opportunity_id?: string | null
          source?: Database["public"]["Enums"]["memory_source"]
          source_message_id?: string | null
          status?: Database["public"]["Enums"]["insight_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence?: number
          contact_id?: string
          content?: string
          conversation_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          insight_type?: string
          metadata?: Json
          opportunity_id?: string | null
          source?: Database["public"]["Enums"]["memory_source"]
          source_message_id?: string | null
          status?: Database["public"]["Enums"]["insight_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_insights_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_insights_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_insights_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_insights_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          contact_id: string | null
          created_at: string
          display_name: string | null
          external_chat_id: string
          id: string
          is_archived: boolean
          last_message_at: string | null
          last_message_preview: string | null
          metadata: Json
          phone_number: string | null
          unread_count: number
          updated_at: string
          user_id: string
          whatsapp_connection_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          display_name?: string | null
          external_chat_id: string
          id?: string
          is_archived?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          metadata?: Json
          phone_number?: string | null
          unread_count?: number
          updated_at?: string
          user_id: string
          whatsapp_connection_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          display_name?: string | null
          external_chat_id?: string
          id?: string
          is_archived?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          metadata?: Json
          phone_number?: string | null
          unread_count?: number
          updated_at?: string
          user_id?: string
          whatsapp_connection_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_whatsapp_connection_id_fkey"
            columns: ["whatsapp_connection_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_memory: {
        Row: {
          analysis_status: string
          competitors: Json
          confidence: number
          contact_id: string
          created_at: string
          current_summary: string | null
          customer_commitments: Json
          customer_intent: string
          decision_factors: Json
          do_not_contact: boolean
          field_sources: Json
          id: string
          important_dates: Json
          interest_level: string
          last_analyzed_at: string | null
          last_analyzed_message_id: string | null
          last_error: string | null
          main_objections: Json
          model: string | null
          next_step_detected: string | null
          opportunity_id: string | null
          pending_information: Json
          products_or_services: Json
          prompt_version: string | null
          relevant_values: Json
          seller_commitments: Json
          sentiment: string
          updated_at: string
          user_id: string
        }
        Insert: {
          analysis_status?: string
          competitors?: Json
          confidence?: number
          contact_id: string
          created_at?: string
          current_summary?: string | null
          customer_commitments?: Json
          customer_intent?: string
          decision_factors?: Json
          do_not_contact?: boolean
          field_sources?: Json
          id?: string
          important_dates?: Json
          interest_level?: string
          last_analyzed_at?: string | null
          last_analyzed_message_id?: string | null
          last_error?: string | null
          main_objections?: Json
          model?: string | null
          next_step_detected?: string | null
          opportunity_id?: string | null
          pending_information?: Json
          products_or_services?: Json
          prompt_version?: string | null
          relevant_values?: Json
          seller_commitments?: Json
          sentiment?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          analysis_status?: string
          competitors?: Json
          confidence?: number
          contact_id?: string
          created_at?: string
          current_summary?: string | null
          customer_commitments?: Json
          customer_intent?: string
          decision_factors?: Json
          do_not_contact?: boolean
          field_sources?: Json
          id?: string
          important_dates?: Json
          interest_level?: string
          last_analyzed_at?: string | null
          last_analyzed_message_id?: string | null
          last_error?: string | null
          main_objections?: Json
          model?: string | null
          next_step_detected?: string | null
          opportunity_id?: string | null
          pending_information?: Json
          products_or_services?: Json
          prompt_version?: string | null
          relevant_values?: Json
          seller_commitments?: Json
          sentiment?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_memory_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_memory_last_analyzed_message_id_fkey"
            columns: ["last_analyzed_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_memory_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_flow_steps: {
        Row: {
          action_type: Database["public"]["Enums"]["followup_action_type"]
          content: string | null
          created_at: string
          delay_unit: Database["public"]["Enums"]["followup_delay_unit"]
          delay_value: number
          flow_id: string
          id: string
          media_filename: string | null
          media_mime_type: string | null
          media_reference: string | null
          position: number
          preferred_time_end: string | null
          preferred_time_start: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          action_type?: Database["public"]["Enums"]["followup_action_type"]
          content?: string | null
          created_at?: string
          delay_unit?: Database["public"]["Enums"]["followup_delay_unit"]
          delay_value?: number
          flow_id: string
          id?: string
          media_filename?: string | null
          media_mime_type?: string | null
          media_reference?: string | null
          position: number
          preferred_time_end?: string | null
          preferred_time_start?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          action_type?: Database["public"]["Enums"]["followup_action_type"]
          content?: string | null
          created_at?: string
          delay_unit?: Database["public"]["Enums"]["followup_delay_unit"]
          delay_value?: number
          flow_id?: string
          id?: string
          media_filename?: string | null
          media_mime_type?: string | null
          media_reference?: string | null
          position?: number
          preferred_time_end?: string | null
          preferred_time_start?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "followup_flow_steps_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "followup_flows"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_flows: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          stop_on_reply: boolean
          updated_at: string
          user_id: string
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          stop_on_reply?: boolean
          updated_at?: string
          user_id: string
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          stop_on_reply?: boolean
          updated_at?: string
          user_id?: string
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: []
      }
      followup_runs: {
        Row: {
          completed_at: string | null
          contact_id: string
          conversation_id: string
          created_at: string
          current_step_id: string | null
          flow_id: string
          id: string
          opportunity_id: string | null
          paused_at: string | null
          started_at: string
          status: Database["public"]["Enums"]["followup_run_status"]
          stop_reason: string | null
          stopped_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          contact_id: string
          conversation_id: string
          created_at?: string
          current_step_id?: string | null
          flow_id: string
          id?: string
          opportunity_id?: string | null
          paused_at?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["followup_run_status"]
          stop_reason?: string | null
          stopped_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          contact_id?: string
          conversation_id?: string
          created_at?: string
          current_step_id?: string | null
          flow_id?: string
          id?: string
          opportunity_id?: string | null
          paused_at?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["followup_run_status"]
          stop_reason?: string | null
          stopped_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "followup_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_runs_current_step_id_fkey"
            columns: ["current_step_id"]
            isOneToOne: false
            referencedRelation: "followup_flow_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_runs_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "followup_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_runs_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          contact_id: string | null
          conversation_id: string
          created_at: string
          delivered_at: string | null
          direction: Database["public"]["Enums"]["message_direction"]
          external_message_id: string | null
          id: string
          media_duration: number | null
          media_filename: string | null
          media_mime_type: string | null
          media_url: string | null
          message_type: Database["public"]["Enums"]["message_type"]
          metadata: Json
          read_at: string | null
          recipient_phone: string | null
          sender_phone: string | null
          sent_at: string
          status: Database["public"]["Enums"]["message_status"]
          text_content: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          contact_id?: string | null
          conversation_id: string
          created_at?: string
          delivered_at?: string | null
          direction: Database["public"]["Enums"]["message_direction"]
          external_message_id?: string | null
          id?: string
          media_duration?: number | null
          media_filename?: string | null
          media_mime_type?: string | null
          media_url?: string | null
          message_type?: Database["public"]["Enums"]["message_type"]
          metadata?: Json
          read_at?: string | null
          recipient_phone?: string | null
          sender_phone?: string | null
          sent_at?: string
          status?: Database["public"]["Enums"]["message_status"]
          text_content?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          contact_id?: string | null
          conversation_id?: string
          created_at?: string
          delivered_at?: string | null
          direction?: Database["public"]["Enums"]["message_direction"]
          external_message_id?: string | null
          id?: string
          media_duration?: number | null
          media_filename?: string | null
          media_mime_type?: string | null
          media_url?: string | null
          message_type?: Database["public"]["Enums"]["message_type"]
          metadata?: Json
          read_at?: string | null
          recipient_phone?: string | null
          sender_phone?: string | null
          sent_at?: string
          status?: Database["public"]["Enums"]["message_status"]
          text_content?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          contact_id: string
          created_at: string
          estimated_value: number | null
          id: string
          next_action_at: string | null
          next_action_description: string | null
          notes: string | null
          pipeline_stage_id: string
          status: Database["public"]["Enums"]["opportunity_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          estimated_value?: number | null
          id?: string
          next_action_at?: string | null
          next_action_description?: string | null
          notes?: string | null
          pipeline_stage_id: string
          status?: Database["public"]["Enums"]["opportunity_status"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          estimated_value?: number | null
          id?: string
          next_action_at?: string | null
          next_action_description?: string | null
          notes?: string | null
          pipeline_stage_id?: string
          status?: Database["public"]["Enums"]["opportunity_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_pipeline_stage_id_fkey"
            columns: ["pipeline_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          position?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      scheduled_actions: {
        Row: {
          action_type: Database["public"]["Enums"]["followup_action_type"]
          attempts: number
          cancel_on_reply: boolean
          contact_id: string | null
          content: string | null
          conversation_id: string
          created_at: string
          executed_at: string | null
          external_message_id: string | null
          flow_run_id: string | null
          flow_step_id: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          media_filename: string | null
          media_mime_type: string | null
          media_reference: string | null
          message_id: string | null
          opportunity_id: string | null
          scheduled_for: string
          status: Database["public"]["Enums"]["scheduled_action_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          action_type?: Database["public"]["Enums"]["followup_action_type"]
          attempts?: number
          cancel_on_reply?: boolean
          contact_id?: string | null
          content?: string | null
          conversation_id: string
          created_at?: string
          executed_at?: string | null
          external_message_id?: string | null
          flow_run_id?: string | null
          flow_step_id?: string | null
          id?: string
          idempotency_key: string
          last_error?: string | null
          media_filename?: string | null
          media_mime_type?: string | null
          media_reference?: string | null
          message_id?: string | null
          opportunity_id?: string | null
          scheduled_for: string
          status?: Database["public"]["Enums"]["scheduled_action_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          action_type?: Database["public"]["Enums"]["followup_action_type"]
          attempts?: number
          cancel_on_reply?: boolean
          contact_id?: string | null
          content?: string | null
          conversation_id?: string
          created_at?: string
          executed_at?: string | null
          external_message_id?: string | null
          flow_run_id?: string | null
          flow_step_id?: string | null
          id?: string
          idempotency_key?: string
          last_error?: string | null
          media_filename?: string | null
          media_mime_type?: string | null
          media_reference?: string | null
          message_id?: string | null
          opportunity_id?: string | null
          scheduled_for?: string
          status?: Database["public"]["Enums"]["scheduled_action_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_actions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_actions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_actions_flow_run_id_fkey"
            columns: ["flow_run_id"]
            isOneToOne: false
            referencedRelation: "followup_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_actions_flow_step_id_fkey"
            columns: ["flow_step_id"]
            isOneToOne: false
            referencedRelation: "followup_flow_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_actions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_actions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      timeline_events: {
        Row: {
          contact_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          opportunity_id: string | null
          user_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          opportunity_id?: string | null
          user_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          opportunity_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timeline_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeline_events_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          created_at: string
          send_window_end: string
          send_window_start: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          send_window_end?: string
          send_window_start?: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          send_window_end?: string
          send_window_start?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_connections: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          instance_identifier: string | null
          last_connected_at: string | null
          last_error: string | null
          last_event_at: string | null
          last_sync_status: string | null
          last_synced_at: string | null
          metadata: Json
          phone_number: string | null
          provider: string
          status: Database["public"]["Enums"]["whatsapp_connection_status"]
          updated_at: string
          user_id: string
          webhook_secret: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          instance_identifier?: string | null
          last_connected_at?: string | null
          last_error?: string | null
          last_event_at?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          metadata?: Json
          phone_number?: string | null
          provider?: string
          status?: Database["public"]["Enums"]["whatsapp_connection_status"]
          updated_at?: string
          user_id: string
          webhook_secret?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          instance_identifier?: string | null
          last_connected_at?: string | null
          last_error?: string | null
          last_event_at?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          metadata?: Json
          phone_number?: string | null
          provider?: string
          status?: Database["public"]["Enums"]["whatsapp_connection_status"]
          updated_at?: string
          user_id?: string
          webhook_secret?: string
        }
        Relationships: []
      }
      whatsapp_credentials: {
        Row: {
          base_url: string
          connection_id: string
          created_at: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          base_url: string
          connection_id: string
          created_at?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          base_url?: string
          connection_id?: string
          created_at?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_credentials_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_connections"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      ai_job_status: "pending" | "processing" | "done" | "failed"
      followup_action_type: "text_message" | "audio" | "image" | "document"
      followup_delay_unit: "minutes" | "hours" | "days"
      followup_run_status:
        | "active"
        | "paused"
        | "stopped"
        | "completed"
        | "cancelled"
        | "failed"
      insight_status: "open" | "accepted" | "dismissed"
      memory_source: "ai" | "human" | "system"
      message_direction: "inbound" | "outbound"
      message_status:
        | "pending"
        | "sent"
        | "delivered"
        | "read"
        | "failed"
        | "received"
      message_type:
        | "text"
        | "audio"
        | "image"
        | "document"
        | "video"
        | "unsupported"
      opportunity_status: "open" | "won" | "lost" | "archived"
      scheduled_action_status:
        | "scheduled"
        | "processing"
        | "sent"
        | "cancelled"
        | "failed"
        | "skipped"
      whatsapp_connection_status:
        | "not_configured"
        | "disconnected"
        | "connecting"
        | "connected"
        | "error"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ai_job_status: ["pending", "processing", "done", "failed"],
      followup_action_type: ["text_message", "audio", "image", "document"],
      followup_delay_unit: ["minutes", "hours", "days"],
      followup_run_status: [
        "active",
        "paused",
        "stopped",
        "completed",
        "cancelled",
        "failed",
      ],
      insight_status: ["open", "accepted", "dismissed"],
      memory_source: ["ai", "human", "system"],
      message_direction: ["inbound", "outbound"],
      message_status: [
        "pending",
        "sent",
        "delivered",
        "read",
        "failed",
        "received",
      ],
      message_type: [
        "text",
        "audio",
        "image",
        "document",
        "video",
        "unsupported",
      ],
      opportunity_status: ["open", "won", "lost", "archived"],
      scheduled_action_status: [
        "scheduled",
        "processing",
        "sent",
        "cancelled",
        "failed",
        "skipped",
      ],
      whatsapp_connection_status: [
        "not_configured",
        "disconnected",
        "connecting",
        "connected",
        "error",
      ],
    },
  },
} as const
