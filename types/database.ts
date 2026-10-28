
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "activity_log": {
                  Row: {
                    "action": string,"actor_email": string | null,"at": string,"cycle_id": string | null,"details": NonNullable<Json>,"entity": string,"entity_id": string | null,"event_id": string | null,"id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_email"?: string | null,"at"?: string,"cycle_id"?: string | null,"details"?: NonNullable<Json>,"entity": string,"entity_id"?: string | null,"event_id"?: string | null,"id"?: never
                  }
                  Update: {
                    "action"?: string,"actor_email"?: string | null,"at"?: string,"cycle_id"?: string | null,"details"?: NonNullable<Json>,"entity"?: string,"entity_id"?: string | null,"event_id"?: string | null,"id"?: never
                  }
                  Relationships: [
                    
                  ]
                },"app_settings": {
                  Row: {
                    "key": string,"updated_at": string,"updated_by": string | null,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"updated_at"?: string,"updated_by"?: string | null,"value": NonNullable<Json>
                  }
                  Update: {
                    "key"?: string,"updated_at"?: string,"updated_by"?: string | null,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"assignments": {
                  Row: {
                    "created_at": string,"created_by": string | null,"drop_reason": string | null,"dropped_at": string | null,"event_id": string,"id": string,"profile_id": string,"role": string,"source": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"drop_reason"?: string | null,"dropped_at"?: string | null,"event_id": string,"id"?: string,"profile_id": string,"role": string,"source"?: string,"status"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"drop_reason"?: string | null,"dropped_at"?: string | null,"event_id"?: string,"id"?: string,"profile_id"?: string,"role"?: string,"source"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assignments_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"event_ideas": {
                  Row: {
                    "created_at": string,"decided_by": string | null,"decision_note": string | null,"event_id": string | null,"helpers_needed": number,"id": string,"pitch": string,"proposed_date": string,"proposer_id": string,"status": string,"title": string,"updated_at": string,"wants_to_oc": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"decided_by"?: string | null,"decision_note"?: string | null,"event_id"?: string | null,"helpers_needed"?: number,"id"?: string,"pitch"?: string,"proposed_date": string,"proposer_id"?: string,"status"?: string,"title": string,"updated_at"?: string,"wants_to_oc"?: boolean
                  }
                  Update: {
                    "created_at"?: string,"decided_by"?: string | null,"decision_note"?: string | null,"event_id"?: string | null,"helpers_needed"?: number,"id"?: string,"pitch"?: string,"proposed_date"?: string,"proposer_id"?: string,"status"?: string,"title"?: string,"updated_at"?: string,"wants_to_oc"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_ideas_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_ideas_proposer_id_fkey"
      columns: ["proposer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"event_series": {
                  Row: {
                    "created_at": string,"id": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"title": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"title"?: string
                  }
                  Relationships: [
                    
                  ]
                },"events": {
                  Row: {
                    "capacity": number | null,"chat_space_name": string | null,"chat_space_url": string | null,"created_at": string,"created_by": string | null,"cycle_id": string | null,"ends_at": string | null,"helpers_needed": number,"id": string,"location": string | null,"price_cents": number | null,"proposed_by": string | null,"series_id": string | null,"starts_at": string,"status": Database["public"]['Enums']["event_status"],"title": string,"type": Database["public"]['Enums']["event_type"],"updated_at": string,"visibility": string
                  }
                  ComputedFields: never
                  Insert: {
                    "capacity"?: number | null,"chat_space_name"?: string | null,"chat_space_url"?: string | null,"created_at"?: string,"created_by"?: string | null,"cycle_id"?: string | null,"ends_at"?: string | null,"helpers_needed"?: number,"id"?: string,"location"?: string | null,"price_cents"?: number | null,"proposed_by"?: string | null,"series_id"?: string | null,"starts_at": string,"status"?: Database["public"]['Enums']["event_status"],"title": string,"type"?: Database["public"]['Enums']["event_type"],"updated_at"?: string,"visibility"?: string
                  }
                  Update: {
                    "capacity"?: number | null,"chat_space_name"?: string | null,"chat_space_url"?: string | null,"created_at"?: string,"created_by"?: string | null,"cycle_id"?: string | null,"ends_at"?: string | null,"helpers_needed"?: number,"id"?: string,"location"?: string | null,"price_cents"?: number | null,"proposed_by"?: string | null,"series_id"?: string | null,"starts_at"?: string,"status"?: Database["public"]['Enums']["event_status"],"title"?: string,"type"?: Database["public"]['Enums']["event_type"],"updated_at"?: string,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_cycle_id_fkey"
      columns: ["cycle_id"]
isOneToOne: false
      referencedRelation: "planning_cycles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_proposed_by_fkey"
      columns: ["proposed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_series_id_fkey"
      columns: ["series_id"]
isOneToOne: false
      referencedRelation: "event_series"
      referencedColumns: ["id"]
    }
                  ]
                },"fake_chat_members": {
                  Row: {
                    "added_at": string,"email": string,"space": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"email": string,"space": string
                  }
                  Update: {
                    "added_at"?: string,"email"?: string,"space"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fake_chat_members_space_fkey"
      columns: ["space"]
isOneToOne: false
      referencedRelation: "fake_chat_spaces"
      referencedColumns: ["name"]
    }
                  ]
                },"fake_chat_messages": {
                  Row: {
                    "created_at": string,"edits": number,"name": string,"space": string,"text": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"edits"?: number,"name": string,"space": string,"text": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"edits"?: number,"name"?: string,"space"?: string,"text"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"fake_chat_spaces": {
                  Row: {
                    "created_at": string,"description": string,"display_name": string,"guidelines": string,"name": string,"request_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string,"display_name": string,"guidelines"?: string,"name": string,"request_id": string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string,"display_name"?: string,"guidelines"?: string,"name"?: string,"request_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"fake_directory_members": {
                  Row: {
                    "group_email": string,"member_email": string
                  }
                  ComputedFields: never
                  Insert: {
                    "group_email": string,"member_email": string
                  }
                  Update: {
                    "group_email"?: string,"member_email"?: string
                  }
                  Relationships: [
                    
                  ]
                },"fake_drive_files": {
                  Row: {
                    "created_at": string,"file_name": string,"folder": string,"id": string,"mime_type": string,"size": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"file_name": string,"folder": string,"id": string,"mime_type": string,"size": number
                  }
                  Update: {
                    "created_at"?: string,"file_name"?: string,"folder"?: string,"id"?: string,"mime_type"?: string,"size"?: number
                  }
                  Relationships: [
                    
                  ]
                },"jobs": {
                  Row: {
                    "attempts": number,"created_at": string,"event_id": string | null,"id": number,"idempotency_key": string,"kind": string,"last_error": string | null,"locked_at": string | null,"locked_by": string | null,"max_attempts": number,"payload": NonNullable<Json>,"rerun": boolean,"result": Json | null,"run_after": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"event_id"?: string | null,"id"?: never,"idempotency_key": string,"kind": string,"last_error"?: string | null,"locked_at"?: string | null,"locked_by"?: string | null,"max_attempts"?: number,"payload"?: NonNullable<Json>,"rerun"?: boolean,"result"?: Json | null,"run_after"?: string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"event_id"?: string | null,"id"?: never,"idempotency_key"?: string,"kind"?: string,"last_error"?: string | null,"locked_at"?: string | null,"locked_by"?: string | null,"max_attempts"?: number,"payload"?: NonNullable<Json>,"rerun"?: boolean,"result"?: Json | null,"run_after"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "jobs_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"organiser_acknowledgements": {
                  Row: {
                    "accepted_at": string,"email": string,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string,"email": string,"version": string
                  }
                  Update: {
                    "accepted_at"?: string,"email"?: string,"version"?: string
                  }
                  Relationships: [
                    
                  ]
                },"planning_cycles": {
                  Row: {
                    "allocated_at": string | null,"confirmed_at": string | null,"confirmed_by": string | null,"created_at": string,"created_by": string | null,"description_deadline": string | null,"form_closes_at": string | null,"id": string,"month": string,"status": Database["public"]['Enums']["cycle_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allocated_at"?: string | null,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"description_deadline"?: string | null,"form_closes_at"?: string | null,"id"?: string,"month": string,"status"?: Database["public"]['Enums']["cycle_status"],"updated_at"?: string
                  }
                  Update: {
                    "allocated_at"?: string | null,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"description_deadline"?: string | null,"form_closes_at"?: string | null,"id"?: string,"month"?: string,"status"?: Database["public"]['Enums']["cycle_status"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"email": string,"full_name": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"full_name"?: string,"id": string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"full_name"?: string,"id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"role_members": {
                  Row: {
                    "email": string,"role": Database["public"]['Enums']["app_role"],"source": string,"synced_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "email": string,"role": Database["public"]['Enums']["app_role"],"source"?: string,"synced_at"?: string
                  }
                  Update: {
                    "email"?: string,"role"?: Database["public"]['Enums']["app_role"],"source"?: string,"synced_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"volunteer_choices": {
                  Row: {
                    "chosen_at": string,"event_id": string,"helper_rank": number | null,"oc_rank": number | null,"response_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "chosen_at"?: string,"event_id": string,"helper_rank"?: number | null,"oc_rank"?: number | null,"response_id": string
                  }
                  Update: {
                    "chosen_at"?: string,"event_id"?: string,"helper_rank"?: number | null,"oc_rank"?: number | null,"response_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "volunteer_choices_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "volunteer_choices_response_id_fkey"
      columns: ["response_id"]
isOneToOne: false
      referencedRelation: "volunteer_responses"
      referencedColumns: ["id"]
    }
                  ]
                },"volunteer_responses": {
                  Row: {
                    "cycle_id": string,"id": string,"note": string,"profile_id": string,"submitted_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cycle_id": string,"id"?: string,"note"?: string,"profile_id": string,"submitted_at"?: string,"updated_at"?: string
                  }
                  Update: {
                    "cycle_id"?: string,"id"?: string,"note"?: string,"profile_id"?: string,"submitted_at"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "volunteer_responses_cycle_id_fkey"
      columns: ["cycle_id"]
isOneToOne: false
      referencedRelation: "planning_cycles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "volunteer_responses_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_idea":
{ Args: { "cycle": string,"event_type": Database["public"]['Enums']["event_type"],"helpers"?: number,"idea": string,"starts": string }; Returns: string
                           },
"acknowledge_confidentiality":
{ Args: { "accepted_version": string }; Returns: undefined
                           },
"auth_email":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"can_read_event":
{ Args: { "event": string }; Returns: boolean
                           },
"claim_jobs":
{ Args: { "max_jobs"?: number,"worker": string }; Returns: {
              "attempts": number,
"created_at": string,
"event_id": string | null,
"id": number,
"idempotency_key": string,
"kind": string,
"last_error": string | null,
"locked_at": string | null,
"locked_by": string | null,
"max_attempts": number,
"payload": NonNullable<Json>,
"rerun": boolean,
"result": Json | null,
"run_after": string,
"status": string,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"close_volunteer_form":
{ Args: { "cycle": string }; Returns: undefined
                           },
"complete_job":
{ Args: { "job_id": number,"job_result"?: Json }; Returns: undefined
                           },
"confidentiality_version":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"confirm_allocation":
{ Args: { "cycle": string }; Returns: undefined
                           },
"cycle_signups":
{ Args: { "cycle": string }; Returns: {
              "chosen_at": string,"email": string,"event_id": string,"full_name": string,"helper_rank": number,"oc_rank": number,"profile_id": string,"submitted_at": string
            }[]
                           },
"delete_expired_acknowledgements":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"delete_expired_activity":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"enqueue_job":
{ Args: { "coalescing"?: boolean,"job_event"?: string,"job_kind": string,"job_payload": Json,"key": string }; Returns: number
                           },
"event_on_calendar":
{ Args: { "event": string }; Returns: boolean
                           },
"fail_job":
{ Args: { "error": string,"job_id": number }; Returns: undefined
                           },
"has_role":
{ Args: { "wanted": Database["public"]['Enums']["app_role"] }; Returns: boolean
                           },
"is_event_oc":
{ Args: { "event": string }; Returns: boolean
                           },
"is_event_staff":
{ Args: { "event": string }; Returns: boolean
                           },
"is_executive":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_team":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_workspace_account":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_workspace_member":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"my_context":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"my_roles":
{ Args: Record<PropertyKey, never>; Returns: (Database["public"]['Enums']["app_role"])[]
                           },
"open_slots":
{ Args: Record<PropertyKey, never>; Returns: {
              "event_id": string,"open_helpers": number,"open_oc": boolean
            }[]
                           },
"open_volunteer_form":
{ Args: { "closes_at": string,"cycle": string }; Returns: undefined
                           },
"purge_auth_ip_addresses":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"replace_group_role":
{ Args: { "emails": (string)[],"member_role": Database["public"]['Enums']["app_role"] }; Returns: number
                           },
"retry_job":
{ Args: { "job_id": number }; Returns: undefined
                           },
"roster_published":
{ Args: { "event": string }; Returns: boolean
                           },
"save_allocation":
{ Args: { "cycle": string,"rows": Json }; Returns: number
                           },
"set_group_role":
{ Args: { "member": boolean,"member_email": string,"member_role": Database["public"]['Enums']["app_role"] }; Returns: undefined
                           },
"submit_volunteer_form":
{ Args: { "choices": Json,"cycle": string,"note"?: string }; Returns: string
                           },
"test_close_due_forms":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"test_cron_jobs":
{ Args: Record<PropertyKey, never>; Returns: {
              "command": string,"jobname": string,"schedule": string
            }[]
                           },
"test_invoke_job_runner":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"workspace_domain":
{ Args: Record<PropertyKey, never>; Returns: string
                           }
          }
          Enums: {
            "app_role": "events"|"comms"|"finance"|"treasurer"|"executive"|"admin","cycle_status": "planning"|"form_open"|"form_closed"|"allocated"|"confirmed","event_status": "draft"|"scheduled"|"understaffed"|"confirmed"|"cancelled"|"dropped"|"completed","event_type": "standard"|"special"|"day_trip"|"weekend_trip"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "app_role": ["events", "comms", "finance", "treasurer", "executive", "admin"],"cycle_status": ["planning", "form_open", "form_closed", "allocated", "confirmed"],"event_status": ["draft", "scheduled", "understaffed", "confirmed", "cancelled", "dropped", "completed"],"event_type": ["standard", "special", "day_trip", "weekend_trip"]
          }
        }
} as const
