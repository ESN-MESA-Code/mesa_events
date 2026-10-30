
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
                },"assignment_drop_reasons": {
                  Row: {
                    "assignment_id": string,"created_at": string,"event_id": string,"reason": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assignment_id": string,"created_at"?: string,"event_id": string,"reason": string
                  }
                  Update: {
                    "assignment_id"?: string,"created_at"?: string,"event_id"?: string,"reason"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assignment_drop_reasons_assignment_id_fkey"
      columns: ["assignment_id"]
isOneToOne: true
      referencedRelation: "assignments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignment_drop_reasons_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"assignments": {
                  Row: {
                    "created_at": string,"created_by": string | null,"dropped_at": string | null,"event_id": string,"id": string,"profile_id": string,"role": string,"source": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"dropped_at"?: string | null,"event_id": string,"id"?: string,"profile_id": string,"role": string,"source"?: string,"status"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"dropped_at"?: string | null,"event_id"?: string,"id"?: string,"profile_id"?: string,"role"?: string,"source"?: string,"status"?: string
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
                },"attendance_lists": {
                  Row: {
                    "created_at": string,"event_id": string,"headcount": number | null,"public_token": string,"risk_notice": string | null,"signed_off_at": string | null,"signed_off_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"headcount"?: number | null,"public_token"?: string,"risk_notice"?: string | null,"signed_off_at"?: string | null,"signed_off_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"headcount"?: number | null,"public_token"?: string,"risk_notice"?: string | null,"signed_off_at"?: string | null,"signed_off_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "attendance_lists_event_id_fkey"
      columns: ["event_id"]
isOneToOne: true
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"calendar_feeds": {
                  Row: {
                    "created_at": string,"last_used_at": string | null,"profile_id": string,"token_hash": string,"token_prefix": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"last_used_at"?: string | null,"profile_id": string,"token_hash": string,"token_prefix": string
                  }
                  Update: {
                    "created_at"?: string,"last_used_at"?: string | null,"profile_id"?: string,"token_hash"?: string,"token_prefix"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "calendar_feeds_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"cash_reports": {
                  Row: {
                    "card_price_external_cents": number | null,"card_price_internal_cents": number | null,"checked_at": string | null,"checked_by": string | null,"closed_at": string | null,"closed_by": string | null,"closing_cents": number | null,"closing_counted_at": string | null,"closing_counted_by": string | null,"closing_counts": NonNullable<Json>,"created_at": string,"created_by": string | null,"esncards_external": number,"esncards_internal": number,"event_id": string | null,"id": string,"internal_event_id": string | null,"note": string,"opening_cents": number | null,"opening_counted_at": string | null,"opening_counted_by": string | null,"opening_counts": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "card_price_external_cents"?: number | null,"card_price_internal_cents"?: number | null,"checked_at"?: string | null,"checked_by"?: string | null,"closed_at"?: string | null,"closed_by"?: string | null,"closing_cents"?: number | null,"closing_counted_at"?: string | null,"closing_counted_by"?: string | null,"closing_counts"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"esncards_external"?: number,"esncards_internal"?: number,"event_id"?: string | null,"id"?: string,"internal_event_id"?: string | null,"note"?: string,"opening_cents"?: number | null,"opening_counted_at"?: string | null,"opening_counted_by"?: string | null,"opening_counts"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "card_price_external_cents"?: number | null,"card_price_internal_cents"?: number | null,"checked_at"?: string | null,"checked_by"?: string | null,"closed_at"?: string | null,"closed_by"?: string | null,"closing_cents"?: number | null,"closing_counted_at"?: string | null,"closing_counted_by"?: string | null,"closing_counts"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"esncards_external"?: number,"esncards_internal"?: number,"event_id"?: string | null,"id"?: string,"internal_event_id"?: string | null,"note"?: string,"opening_cents"?: number | null,"opening_counted_at"?: string | null,"opening_counted_by"?: string | null,"opening_counts"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cash_reports_event_id_fkey"
      columns: ["event_id"]
isOneToOne: true
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cash_reports_internal_event_id_fkey"
      columns: ["internal_event_id"]
isOneToOne: true
      referencedRelation: "internal_events"
      referencedColumns: ["id"]
    }
                  ]
                },"description_versions": {
                  Row: {
                    "created_at": string,"created_by": string | null,"event_id": string,"fields": NonNullable<Json>,"id": number,"kind": string,"text": string | null,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"event_id": string,"fields": NonNullable<Json>,"id"?: never,"kind": string,"text"?: string | null,"version": number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"event_id"?: string,"fields"?: NonNullable<Json>,"id"?: never,"kind"?: string,"text"?: string | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "description_versions_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"descriptions": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"approved_fields": Json | null,"approved_text": string | null,"event_id": string,"fields": NonNullable<Json>,"publish_requested_at": string | null,"published_at": string | null,"published_by": string | null,"published_message_name": string | null,"published_text": string | null,"status": string,"submitted_at": string | null,"submitted_by": string | null,"updated_at": string,"updated_by": string | null,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"approved_fields"?: Json | null,"approved_text"?: string | null,"event_id": string,"fields"?: NonNullable<Json>,"publish_requested_at"?: string | null,"published_at"?: string | null,"published_by"?: string | null,"published_message_name"?: string | null,"published_text"?: string | null,"status"?: string,"submitted_at"?: string | null,"submitted_by"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"approved_fields"?: Json | null,"approved_text"?: string | null,"event_id"?: string,"fields"?: NonNullable<Json>,"publish_requested_at"?: string | null,"published_at"?: string | null,"published_by"?: string | null,"published_message_name"?: string | null,"published_text"?: string | null,"status"?: string,"submitted_at"?: string | null,"submitted_by"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "descriptions_event_id_fkey"
      columns: ["event_id"]
isOneToOne: true
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"esn_access_tokens": {
                  Row: {
                    "created_at": string,"expires_at": string,"id": string,"label": string,"last_used_at": string | null,"profile_id": string,"revoked_at": string | null,"token_hash": string,"token_prefix": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expires_at": string,"id"?: string,"label": string,"last_used_at"?: string | null,"profile_id": string,"revoked_at"?: string | null,"token_hash": string,"token_prefix": string
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string,"id"?: string,"label"?: string,"last_used_at"?: string | null,"profile_id"?: string,"revoked_at"?: string | null,"token_hash"?: string,"token_prefix"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "esn_access_tokens_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"esn_uploads": {
                  Row: {
                    "activity_url": string,"event_id": string,"uploaded_at": string,"uploaded_by": string,"via": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_url": string,"event_id": string,"uploaded_at"?: string,"uploaded_by": string,"via": string
                  }
                  Update: {
                    "activity_url"?: string,"event_id"?: string,"uploaded_at"?: string,"uploaded_by"?: string,"via"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "esn_uploads_event_id_fkey"
      columns: ["event_id"]
isOneToOne: true
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"event_chat_members": {
                  Row: {
                    "added_at": string,"email": string,"event_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"email": string,"event_id": string
                  }
                  Update: {
                    "added_at"?: string,"email"?: string,"event_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_chat_members_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"event_ideas": {
                  Row: {
                    "created_at": string,"decided_by": string | null,"decision_note": string | null,"event_id": string | null,"helpers_needed": number,"id": string,"pitch": string,"proposed_date": string,"proposer_id": string,"status": string,"title": string,"type_suggestion": Database["public"]['Enums']["event_type"] | null,"updated_at": string,"wants_to_oc": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"decided_by"?: string | null,"decision_note"?: string | null,"event_id"?: string | null,"helpers_needed"?: number,"id"?: string,"pitch"?: string,"proposed_date": string,"proposer_id"?: string,"status"?: string,"title": string,"type_suggestion"?: Database["public"]['Enums']["event_type"] | null,"updated_at"?: string,"wants_to_oc"?: boolean
                  }
                  Update: {
                    "created_at"?: string,"decided_by"?: string | null,"decision_note"?: string | null,"event_id"?: string | null,"helpers_needed"?: number,"id"?: string,"pitch"?: string,"proposed_date"?: string,"proposer_id"?: string,"status"?: string,"title"?: string,"type_suggestion"?: Database["public"]['Enums']["event_type"] | null,"updated_at"?: string,"wants_to_oc"?: boolean
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
                },"event_photo_folders": {
                  Row: {
                    "count_error": string | null,"counted_at": string | null,"created_at": string,"event_id": string,"folder_id": string | null,"folder_path": string | null,"folder_url": string | null,"marked_uploaded_at": string | null,"marked_uploaded_by": string | null,"photo_count": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "count_error"?: string | null,"counted_at"?: string | null,"created_at"?: string,"event_id": string,"folder_id"?: string | null,"folder_path"?: string | null,"folder_url"?: string | null,"marked_uploaded_at"?: string | null,"marked_uploaded_by"?: string | null,"photo_count"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "count_error"?: string | null,"counted_at"?: string | null,"created_at"?: string,"event_id"?: string,"folder_id"?: string | null,"folder_path"?: string | null,"folder_url"?: string | null,"marked_uploaded_at"?: string | null,"marked_uploaded_by"?: string | null,"photo_count"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_photo_folders_event_id_fkey"
      columns: ["event_id"]
isOneToOne: true
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"event_reports": {
                  Row: {
                    "access_needs": boolean,"access_note": string,"could_be_better": string,"created_at": string,"created_by": string | null,"event_id": string,"goals_reached": boolean,"intl_participants": number,"local_participants": number,"organizers": number,"updated_at": string,"updated_by": string | null,"went_well": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_needs"?: boolean,"access_note"?: string,"could_be_better"?: string,"created_at"?: string,"created_by"?: string | null,"event_id": string,"goals_reached"?: boolean,"intl_participants": number,"local_participants"?: number,"organizers": number,"updated_at"?: string,"updated_by"?: string | null,"went_well": string
                  }
                  Update: {
                    "access_needs"?: boolean,"access_note"?: string,"could_be_better"?: string,"created_at"?: string,"created_by"?: string | null,"event_id"?: string,"goals_reached"?: boolean,"intl_participants"?: number,"local_participants"?: number,"organizers"?: number,"updated_at"?: string,"updated_by"?: string | null,"went_well"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_reports_event_id_fkey"
      columns: ["event_id"]
isOneToOne: true
      referencedRelation: "events"
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
                },"event_stats": {
                  Row: {
                    "answer": string,"event_id": string,"question": string,"total": number
                  }
                  ComputedFields: never
                  Insert: {
                    "answer": string,"event_id": string,"question": string,"total"?: number
                  }
                  Update: {
                    "answer"?: string,"event_id"?: string,"question"?: string,"total"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_stats_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "attendance_lists"
      referencedColumns: ["event_id"]
    }
                  ]
                },"events": {
                  Row: {
                    "address_city": string | null,"address_country": string,"address_postal_code": string | null,"address_street": string | null,"archive_ref": string | null,"cancel_reason": string | null,"cancellation_noted_at": string | null,"cancellation_noted_by": string | null,"cancelled_at": string | null,"cancelled_by": string | null,"capacity": number | null,"chat_space_name": string | null,"chat_space_requested_at": string | null,"chat_space_url": string | null,"created_at": string,"created_by": string | null,"cycle_id": string | null,"ends_at": string | null,"helpers_needed": number,"id": string,"location": string | null,"price_cents": number | null,"proposed_by": string | null,"series_id": string | null,"source": string,"starts_at": string,"status": Database["public"]['Enums']["event_status"],"title": string,"type": Database["public"]['Enums']["event_type"],"understaffed_decided_at": string | null,"understaffed_decided_by": string | null,"understaffed_decision": string | null,"updated_at": string,"visibility": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address_city"?: string | null,"address_country"?: string,"address_postal_code"?: string | null,"address_street"?: string | null,"archive_ref"?: string | null,"cancel_reason"?: string | null,"cancellation_noted_at"?: string | null,"cancellation_noted_by"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"capacity"?: number | null,"chat_space_name"?: string | null,"chat_space_requested_at"?: string | null,"chat_space_url"?: string | null,"created_at"?: string,"created_by"?: string | null,"cycle_id"?: string | null,"ends_at"?: string | null,"helpers_needed"?: number,"id"?: string,"location"?: string | null,"price_cents"?: number | null,"proposed_by"?: string | null,"series_id"?: string | null,"source"?: string,"starts_at": string,"status"?: Database["public"]['Enums']["event_status"],"title": string,"type"?: Database["public"]['Enums']["event_type"],"understaffed_decided_at"?: string | null,"understaffed_decided_by"?: string | null,"understaffed_decision"?: string | null,"updated_at"?: string,"visibility"?: string
                  }
                  Update: {
                    "address_city"?: string | null,"address_country"?: string,"address_postal_code"?: string | null,"address_street"?: string | null,"archive_ref"?: string | null,"cancel_reason"?: string | null,"cancellation_noted_at"?: string | null,"cancellation_noted_by"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"capacity"?: number | null,"chat_space_name"?: string | null,"chat_space_requested_at"?: string | null,"chat_space_url"?: string | null,"created_at"?: string,"created_by"?: string | null,"cycle_id"?: string | null,"ends_at"?: string | null,"helpers_needed"?: number,"id"?: string,"location"?: string | null,"price_cents"?: number | null,"proposed_by"?: string | null,"series_id"?: string | null,"source"?: string,"starts_at"?: string,"status"?: Database["public"]['Enums']["event_status"],"title"?: string,"type"?: Database["public"]['Enums']["event_type"],"understaffed_decided_at"?: string | null,"understaffed_decided_by"?: string | null,"understaffed_decision"?: string | null,"updated_at"?: string,"visibility"?: string
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
                    "created_at": string,"file_name": string,"folder_id": string,"id": string,"mime_type": string,"size": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"file_name": string,"folder_id": string,"id": string,"mime_type"?: string,"size"?: number
                  }
                  Update: {
                    "created_at"?: string,"file_name"?: string,"folder_id"?: string,"id"?: string,"mime_type"?: string,"size"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "fake_drive_files_folder_id_fkey"
      columns: ["folder_id"]
isOneToOne: false
      referencedRelation: "fake_drive_folders"
      referencedColumns: ["id"]
    }
                  ]
                },"fake_drive_folders": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"parent_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id": string,"name": string,"parent_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"parent_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"fake_telegram_messages": {
                  Row: {
                    "chat_id": string,"created_at": string,"deleted": boolean,"edits": number,"id": number,"kind": string,"message_id": number,"photo": string | null,"text": string,"thread_id": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "chat_id": string,"created_at"?: string,"deleted"?: boolean,"edits"?: number,"id"?: never,"kind": string,"message_id": number,"photo"?: string | null,"text"?: string,"thread_id"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "chat_id"?: string,"created_at"?: string,"deleted"?: boolean,"edits"?: number,"id"?: never,"kind"?: string,"message_id"?: number,"photo"?: string | null,"text"?: string,"thread_id"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"finance_categories": {
                  Row: {
                    "active": boolean,"created_at": string,"direction": string,"id": string,"name": string,"sort": number
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"direction": string,"id"?: string,"name": string,"sort"?: number
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"direction"?: string,"id"?: string,"name"?: string,"sort"?: number
                  }
                  Relationships: [
                    
                  ]
                },"finance_entries": {
                  Row: {
                    "amount_cents": number,"beleg_received": boolean,"beleg_ref": string,"booked_on": string,"cash_report_id": string | null,"category_id": string,"counterparty": string,"created_at": string,"created_by": string | null,"description": string,"direction": string,"event_id": string | null,"id": string,"internal_event_id": string | null,"note": string,"payment_method": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"beleg_received"?: boolean,"beleg_ref"?: string,"booked_on": string,"cash_report_id"?: string | null,"category_id": string,"counterparty"?: string,"created_at"?: string,"created_by"?: string | null,"description": string,"direction": string,"event_id"?: string | null,"id"?: string,"internal_event_id"?: string | null,"note"?: string,"payment_method"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"beleg_received"?: boolean,"beleg_ref"?: string,"booked_on"?: string,"cash_report_id"?: string | null,"category_id"?: string,"counterparty"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string,"direction"?: string,"event_id"?: string | null,"id"?: string,"internal_event_id"?: string | null,"note"?: string,"payment_method"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "finance_entries_cash_report_id_fkey"
      columns: ["cash_report_id"]
isOneToOne: true
      referencedRelation: "cash_reports"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_entries_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "finance_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_entries_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_entries_internal_event_id_fkey"
      columns: ["internal_event_id"]
isOneToOne: false
      referencedRelation: "internal_events"
      referencedColumns: ["id"]
    }
                  ]
                },"internal_event_people": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"internal_event_id": string,"profile_id": string,"role": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"internal_event_id": string,"profile_id": string,"role": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"internal_event_id"?: string,"profile_id"?: string,"role"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "internal_event_people_internal_event_id_fkey"
      columns: ["internal_event_id"]
isOneToOne: false
      referencedRelation: "internal_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "internal_event_people_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"internal_events": {
                  Row: {
                    "capacity": number | null,"created_at": string,"created_by": string | null,"ends_at": string | null,"helpers_needed": number,"id": string,"kind": Database["public"]['Enums']["internal_kind"],"location": string,"note": string,"presentation_url": string | null,"series_id": string | null,"starts_at": string,"status": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "capacity"?: number | null,"created_at"?: string,"created_by"?: string | null,"ends_at"?: string | null,"helpers_needed"?: number,"id"?: string,"kind": Database["public"]['Enums']["internal_kind"],"location"?: string,"note"?: string,"presentation_url"?: string | null,"series_id"?: string | null,"starts_at": string,"status"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "capacity"?: number | null,"created_at"?: string,"created_by"?: string | null,"ends_at"?: string | null,"helpers_needed"?: number,"id"?: string,"kind"?: Database["public"]['Enums']["internal_kind"],"location"?: string,"note"?: string,"presentation_url"?: string | null,"series_id"?: string | null,"starts_at"?: string,"status"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"internal_kind_settings": {
                  Row: {
                    "default_minutes": number,"default_start": string,"default_title": string,"description": string,"helpers_needed": number,"kind": Database["public"]['Enums']["internal_kind"],"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "default_minutes": number,"default_start": string,"default_title": string,"description"?: string,"helpers_needed"?: number,"kind": Database["public"]['Enums']["internal_kind"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "default_minutes"?: number,"default_start"?: string,"default_title"?: string,"description"?: string,"helpers_needed"?: number,"kind"?: Database["public"]['Enums']["internal_kind"],"updated_at"?: string,"updated_by"?: string | null
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
                },"participants": {
                  Row: {
                    "created_at": string,"entry_method": string,"event_id": string,"first_name": string,"id": string,"last_name": string,"notice_version": string,"recorded_by": string | null,"terms_version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"entry_method"?: string,"event_id": string,"first_name": string,"id"?: string,"last_name": string,"notice_version": string,"recorded_by"?: string | null,"terms_version": string
                  }
                  Update: {
                    "created_at"?: string,"entry_method"?: string,"event_id"?: string,"first_name"?: string,"id"?: string,"last_name"?: string,"notice_version"?: string,"recorded_by"?: string | null,"terms_version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "participants_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "attendance_lists"
      referencedColumns: ["event_id"]
    }
                  ]
                },"payout_batches": {
                  Row: {
                    "created_at": string,"id": string,"month": string,"paid_at": string | null,"paid_by": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"month": string,"paid_at"?: string | null,"paid_by"?: string | null,"status"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"month"?: string,"paid_at"?: string | null,"paid_by"?: string | null,"status"?: string
                  }
                  Relationships: [
                    
                  ]
                },"payout_details": {
                  Row: {
                    "account_holder": string | null,"iban": string | null,"paypal_email": string | null,"reimbursement_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_holder"?: string | null,"iban"?: string | null,"paypal_email"?: string | null,"reimbursement_id": string
                  }
                  Update: {
                    "account_holder"?: string | null,"iban"?: string | null,"paypal_email"?: string | null,"reimbursement_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payout_details_reimbursement_id_fkey"
      columns: ["reimbursement_id"]
isOneToOne: true
      referencedRelation: "reimbursements"
      referencedColumns: ["id"]
    }
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
                },"preapprovals": {
                  Row: {
                    "created_at": string,"decided_at": string | null,"decided_by": string | null,"description": string,"estimated_cents": number,"event_id": string,"id": string,"note": string,"requester_id": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"description": string,"estimated_cents": number,"event_id": string,"id"?: string,"note"?: string,"requester_id": string,"status"?: string
                  }
                  Update: {
                    "created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"description"?: string,"estimated_cents"?: number,"event_id"?: string,"id"?: string,"note"?: string,"requester_id"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "preapprovals_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "preapprovals_requester_id_fkey"
      columns: ["requester_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profile_payout_details": {
                  Row: {
                    "account_holder": string | null,"iban": string | null,"paypal_email": string | null,"profile_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_holder"?: string | null,"iban"?: string | null,"paypal_email"?: string | null,"profile_id": string,"updated_at"?: string
                  }
                  Update: {
                    "account_holder"?: string | null,"iban"?: string | null,"paypal_email"?: string | null,"profile_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profile_payout_details_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
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
                },"publication_channels": {
                  Row: {
                    "enabled": boolean,"key": string,"kind": string,"name": string,"position": number,"required": boolean,"schedulable": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "enabled"?: boolean,"key": string,"kind": string,"name": string,"position"?: number,"required"?: boolean,"schedulable"?: boolean
                  }
                  Update: {
                    "enabled"?: boolean,"key"?: string,"kind"?: string,"name"?: string,"position"?: number,"required"?: boolean,"schedulable"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"publication_post_events": {
                  Row: {
                    "event_id": string,"position": number,"post_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "event_id": string,"position"?: number,"post_id": string
                  }
                  Update: {
                    "event_id"?: string,"position"?: number,"post_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "publication_post_events_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "publication_post_events_post_id_fkey"
      columns: ["post_id"]
isOneToOne: false
      referencedRelation: "publication_posts"
      referencedColumns: ["id"]
    }
                  ]
                },"publication_posts": {
                  Row: {
                    "channel": string,"confirmed_at": string | null,"confirmed_by": string | null,"created_at": string,"created_by": string | null,"id": string,"last_error": string | null,"link": string | null,"note": string,"picture": string | null,"published_at": string | null,"published_by": string | null,"scheduled_for": string,"skip_reason": string | null,"status": string,"telegram": Json | null,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "channel": string,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"last_error"?: string | null,"link"?: string | null,"note"?: string,"picture"?: string | null,"published_at"?: string | null,"published_by"?: string | null,"scheduled_for": string,"skip_reason"?: string | null,"status"?: string,"telegram"?: Json | null,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "channel"?: string,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"last_error"?: string | null,"link"?: string | null,"note"?: string,"picture"?: string | null,"published_at"?: string | null,"published_by"?: string | null,"scheduled_for"?: string,"skip_reason"?: string | null,"status"?: string,"telegram"?: Json | null,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "publication_posts_channel_fkey"
      columns: ["channel"]
isOneToOne: false
      referencedRelation: "publication_channels"
      referencedColumns: ["key"]
    }
                  ]
                },"receipts": {
                  Row: {
                    "amount_cents": number,"beleg_received_at": string | null,"beleg_received_by": string | null,"claimant_id": string,"created_at": string,"days": number | null,"description": string,"event_id": string,"expense_kind": string,"id": string,"purchased_on": string,"vendor": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"beleg_received_at"?: string | null,"beleg_received_by"?: string | null,"claimant_id": string,"created_at"?: string,"days"?: number | null,"description"?: string,"event_id": string,"expense_kind": string,"id"?: string,"purchased_on": string,"vendor": string
                  }
                  Update: {
                    "amount_cents"?: number,"beleg_received_at"?: string | null,"beleg_received_by"?: string | null,"claimant_id"?: string,"created_at"?: string,"days"?: number | null,"description"?: string,"event_id"?: string,"expense_kind"?: string,"id"?: string,"purchased_on"?: string,"vendor"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "receipts_claimant_id_fkey"
      columns: ["claimant_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "receipts_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"reimbursement_policies": {
                  Row: {
                    "created_at": string,"created_by": string | null,"effective_from": string,"id": string,"notes": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"effective_from": string,"id"?: string,"notes"?: string,"version": number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"effective_from"?: string,"id"?: string,"notes"?: string,"version"?: number
                  }
                  Relationships: [
                    
                  ]
                },"reimbursement_rules": {
                  Row: {
                    "category": string,"condition_note": string,"event_type": string,"expense_kind": string,"helper_cap_cents": number | null,"helper_rate_bp": number,"id": string,"oc_cap_cents": number | null,"oc_rate_bp": number,"per_day": boolean,"policy_id": string,"requires_preapproval": boolean,"within_trip_budget": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"condition_note"?: string,"event_type": string,"expense_kind": string,"helper_cap_cents"?: number | null,"helper_rate_bp": number,"id"?: string,"oc_cap_cents"?: number | null,"oc_rate_bp": number,"per_day"?: boolean,"policy_id": string,"requires_preapproval"?: boolean,"within_trip_budget"?: boolean
                  }
                  Update: {
                    "category"?: string,"condition_note"?: string,"event_type"?: string,"expense_kind"?: string,"helper_cap_cents"?: number | null,"helper_rate_bp"?: number,"id"?: string,"oc_cap_cents"?: number | null,"oc_rate_bp"?: number,"per_day"?: boolean,"policy_id"?: string,"requires_preapproval"?: boolean,"within_trip_budget"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "reimbursement_rules_policy_id_fkey"
      columns: ["policy_id"]
isOneToOne: false
      referencedRelation: "reimbursement_policies"
      referencedColumns: ["id"]
    }
                  ]
                },"reimbursements": {
                  Row: {
                    "approved_cents": number | null,"batch_id": string | null,"category": string,"checked_at": string | null,"checked_by": string | null,"claimant_id": string,"claimant_role": string,"created_at": string,"early_payout": boolean,"event_id": string,"finance_note": string,"flags": (string)[],"id": string,"paid_at": string | null,"paid_by": string | null,"payout_method": string | null,"policy_id": string,"policy_version": number,"preapproval_id": string | null,"receipt_id": string,"rejected_reason": string | null,"rule_id": string,"status": string,"suggested_cents": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_cents"?: number | null,"batch_id"?: string | null,"category": string,"checked_at"?: string | null,"checked_by"?: string | null,"claimant_id": string,"claimant_role": string,"created_at"?: string,"early_payout"?: boolean,"event_id": string,"finance_note"?: string,"flags"?: (string)[],"id"?: string,"paid_at"?: string | null,"paid_by"?: string | null,"payout_method"?: string | null,"policy_id": string,"policy_version": number,"preapproval_id"?: string | null,"receipt_id": string,"rejected_reason"?: string | null,"rule_id": string,"status"?: string,"suggested_cents": number,"updated_at"?: string
                  }
                  Update: {
                    "approved_cents"?: number | null,"batch_id"?: string | null,"category"?: string,"checked_at"?: string | null,"checked_by"?: string | null,"claimant_id"?: string,"claimant_role"?: string,"created_at"?: string,"early_payout"?: boolean,"event_id"?: string,"finance_note"?: string,"flags"?: (string)[],"id"?: string,"paid_at"?: string | null,"paid_by"?: string | null,"payout_method"?: string | null,"policy_id"?: string,"policy_version"?: number,"preapproval_id"?: string | null,"receipt_id"?: string,"rejected_reason"?: string | null,"rule_id"?: string,"status"?: string,"suggested_cents"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reimbursements_batch_id_fkey"
      columns: ["batch_id"]
isOneToOne: false
      referencedRelation: "payout_batches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reimbursements_claimant_id_fkey"
      columns: ["claimant_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reimbursements_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reimbursements_policy_id_fkey"
      columns: ["policy_id"]
isOneToOne: false
      referencedRelation: "reimbursement_policies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reimbursements_preapproval_id_fkey"
      columns: ["preapproval_id"]
isOneToOne: false
      referencedRelation: "preapprovals"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reimbursements_receipt_id_fkey"
      columns: ["receipt_id"]
isOneToOne: true
      referencedRelation: "receipts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reimbursements_rule_id_fkey"
      columns: ["rule_id"]
isOneToOne: false
      referencedRelation: "reimbursement_rules"
      referencedColumns: ["id"]
    }
                  ]
                },"reviews": {
                  Row: {
                    "comment": string,"created_at": string,"decision": string,"event_id": string,"id": string,"reviewer": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "comment"?: string,"created_at"?: string,"decision": string,"event_id": string,"id"?: string,"reviewer": string,"version": number
                  }
                  Update: {
                    "comment"?: string,"created_at"?: string,"decision"?: string,"event_id"?: string,"id"?: string,"reviewer"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "reviews_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
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
                },"trip_budgets": {
                  Row: {
                    "amount_cents": number,"event_id": string,"note": string,"set_at": string,"set_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"event_id": string,"note"?: string,"set_at"?: string,"set_by"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"event_id"?: string,"note"?: string,"set_at"?: string,"set_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "trip_budgets_event_id_fkey"
      columns: ["event_id"]
isOneToOne: true
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"volunteer_choices": {
                  Row: {
                    "event_id": string,"helper_rank": number | null,"oc_rank": number | null,"response_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "event_id": string,"helper_rank"?: number | null,"oc_rank"?: number | null,"response_id": string
                  }
                  Update: {
                    "event_id"?: string,"helper_rank"?: number | null,"oc_rank"?: number | null,"response_id"?: string
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
"add_to_post":
{ Args: { "event": string,"post": string }; Returns: undefined
                           },
"auth_email":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"book_cash_report":
{ Args: { "category": string,"report": string }; Returns: string
                           },
"bump_esncards":
{ Args: { "card": string,"delta": number,"report": string }; Returns: Json
                           },
"calendar_feed_items":
{ Args: { "token": string }; Returns: {
              "cancelled": boolean,"description": string,"ends_at": string,"kind": string,"location": string,"path": string,"starts_at": string,"title": string,"uid": string,"updated_at": string
            }[]
                           },
"can_edit_description":
{ Args: { "event": string }; Returns: boolean
                           },
"can_read_event":
{ Args: { "event": string }; Returns: boolean
                           },
"can_read_internal_event":
{ Args: { "internal_event": string }; Returns: boolean
                           },
"cancel_event":
{ Args: { "event": string,"reason"?: string }; Returns: undefined
                           },
"cancel_overdue_descriptions":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"chat_space_roster":
{ Args: { "event": string }; Returns: {
              "email": string,"full_name": string,"kind": string
            }[]
                           },
"check_cash_report":
{ Args: { "report": string }; Returns: undefined
                           },
"check_reimbursement":
{ Args: { "approved": number,"claim": string,"note"?: string }; Returns: undefined
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
"claim_slot":
{ Args: { "event": string,"slot_role": string }; Returns: string
                           },
"clear_volunteer_response":
{ Args: { "cycle": string,"profile": string,"reason": string }; Returns: undefined
                           },
"close_cash_report":
{ Args: { "report": string }; Returns: undefined
                           },
"close_volunteer_form":
{ Args: { "cycle": string }; Returns: undefined
                           },
"complete_job":
{ Args: { "job_id": number,"job_result"?: Json }; Returns: undefined
                           },
"complete_past_events":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"confidentiality_version":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"confirm_allocation":
{ Args: { "cycle": string }; Returns: undefined
                           },
"confirm_post":
{ Args: { "post": string }; Returns: undefined
                           },
"create_calendar_feed":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"create_esn_token":
{ Args: { "label": string,"valid_days"?: number }; Returns: string
                           },
"create_post":
{ Args: { "channel": string,"events": (string)[],"scheduled_for": string }; Returns: string
                           },
"cycle_deadline_limits":
{ Args: { "cycle": string }; Returns: {
              "description_latest": string,"form_latest": string
            }[]
                           },
"cycle_hand_in":
{ Args: { "cycles": (string)[] }; Returns: {
              "belege_missing": number,"cycle_id": string,"ends_at": string,"event_id": string,"photos_in": boolean,"receipts": number,"report_in": boolean,"signed_off": boolean,"starts_at": string,"status": Database["public"]['Enums']["event_status"]
            }[]
                           },
"cycle_responses":
{ Args: { "cycle": string }; Returns: {
              "email": string,"events": number,"full_name": string,"note": string,"profile_id": string,"submitted_at": string
            }[]
                           },
"cycle_signups":
{ Args: { "cycle": string }; Returns: {
              "email": string,"event_id": string,"full_name": string,"helper_rank": number,"oc_rank": number,"profile_id": string,"submitted_at": string
            }[]
                           },
"decide_preapproval":
{ Args: { "approve": boolean,"decision_note"?: string,"preapproval": string }; Returns: undefined
                           },
"decide_understaffed":
{ Args: { "decision": string,"event": string }; Returns: undefined
                           },
"delete_expired_acknowledgements":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"delete_expired_activity":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"delete_expired_lists":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"delete_my_payout_details":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"delete_post":
{ Args: { "post": string }; Returns: undefined
                           },
"description_overview":
{ Args: Record<PropertyKey, never>; Returns: {
              "cycle_id": string,"cycle_month": string,"deadline": string,"event_id": string,"late": boolean,"missed": boolean,"published_at": string,"starts_at": string,"status": string,"submitted_at": string,"title": string
            }[]
                           },
"drop_out":
{ Args: { "assignment": string,"reason"?: string }; Returns: undefined
                           },
"edit_post":
{ Args: { "note": string,"picture": string,"post": string }; Returns: undefined
                           },
"enqueue_job":
{ Args: { "coalescing"?: boolean,"job_event"?: string,"job_kind": string,"job_payload": Json,"key": string }; Returns: number
                           },
"ensure_cash_report":
{ Args: { "event"?: string,"internal_event"?: string }; Returns: string
                           },
"esn_api_link":
{ Args: { "event": string,"hash": string,"url": string }; Returns: undefined
                           },
"esn_token_owner":
{ Args: { "hash": string }; Returns: {
              "email": string,"profile_id": string,"token_id": string
            }[]
                           },
"event_accepts_signins":
{ Args: { "event": string }; Returns: boolean
                           },
"event_claims_summary":
{ Args: { "event": string }; Returns: Json
                           },
"event_list_open":
{ Args: { "event": string }; Returns: boolean
                           },
"event_on_calendar":
{ Args: { "event": string }; Returns: boolean
                           },
"event_report_prefill":
{ Args: { "event": string }; Returns: {
              "headcount": number,"local_participants": number,"organizers": number
            }[]
                           },
"event_signin_counts":
{ Args: Record<PropertyKey, never>; Returns: {
              "event_id": string,"signins": number
            }[]
                           },
"event_summary":
{ Args: { "event": string }; Returns: Json
                           },
"fail_job":
{ Args: { "error": string,"job_id": number }; Returns: undefined
                           },
"get_public_event":
{ Args: { "token": string }; Returns: {
              "closed": boolean,"closes_at": string,"event_date": string,"id": string,"opens_at": string,"risk_notice": string,"title": string
            }[]
                           },
"has_role":
{ Args: { "wanted": Database["public"]['Enums']["app_role"] }; Returns: boolean
                           },
"inspiration_events":
{ Args: Record<PropertyKey, never>; Returns: {
              "ends_at": string,"event_id": string,"headcount": number,"helpers_needed": number,"hook": string,"intro": string,"photo_folder_url": string,"price": string,"source": string,"starts_at": string,"title": string,"type": Database["public"]['Enums']["event_type"],"venue": string
            }[]
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
"is_internal_oc":
{ Args: { "internal_event": string }; Returns: boolean
                           },
"is_internal_planner":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_internal_staff":
{ Args: { "internal_event": string }; Returns: boolean
                           },
"is_list_organiser":
{ Args: { "event": string }; Returns: boolean
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
"leaderboard":
{ Args: { "semester": string }; Returns: {
              "full_name": string,"helper_count": number,"newbie": boolean,"oc_count": number,"profile_id": string
            }[]
                           },
"mark_beleg_received":
{ Args: { "claim": string }; Returns: undefined
                           },
"mark_description_published":
{ Args: { "event": string,"message_name": string,"posted_text": string }; Returns: undefined
                           },
"mark_esn_uploaded":
{ Args: { "event": string,"url": string }; Returns: undefined
                           },
"mark_photos_uploaded":
{ Args: { "event": string,"uploaded": boolean }; Returns: undefined
                           },
"mark_post_published":
{ Args: { "link": string,"post": string }; Returns: undefined
                           },
"move_post":
{ Args: { "post": string,"scheduled_for": string }; Returns: undefined
                           },
"my_context":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"my_roles":
{ Args: Record<PropertyKey, never>; Returns: (Database["public"]['Enums']["app_role"])[]
                           },
"note_cancellation":
{ Args: { "event": string }; Returns: undefined
                           },
"open_slots":
{ Args: Record<PropertyKey, never>; Returns: {
              "event_id": string,"open_helpers": number,"open_oc": boolean
            }[]
                           },
"open_volunteer_form":
{ Args: { "closes_at": string,"cycle": string }; Returns: undefined
                           },
"pay_batch":
{ Args: { "batch": string }; Returns: number
                           },
"pay_early":
{ Args: { "claim": string }; Returns: undefined
                           },
"plan_everywhere":
{ Args: { "event": string,"scheduled_for": string }; Returns: string[]
                           },
"policy_for":
{ Args: { "day": string }; Returns: string
                           },
"post_published":
{ Args: { "by_whom": string,"link": string,"post": string,"telegram": Json,"version": number }; Returns: boolean
                           },
"publication_status":
{ Args: { "events": (string)[] }; Returns: {
              "at": string,"by_whom": string,"channel": string,"event_id": string,"link": string,"reason": string,"state": string
            }[]
                           },
"publish_description":
{ Args: { "event": string }; Returns: undefined
                           },
"publish_policy":
{ Args: { "effective_from": string,"notes"?: string,"rules": Json }; Returns: number
                           },
"publish_post_now":
{ Args: { "post": string }; Returns: undefined
                           },
"purge_auth_ip_addresses":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"register_receipt":
{ Args: { "account_holder"?: string,"amount_cents": number,"days"?: number,"description"?: string,"event": string,"iban"?: string,"kind": string,"payout_method"?: string,"paypal_email"?: string,"preapproval"?: string,"purchased_on": string,"vendor": string }; Returns: string
                           },
"reject_reimbursement":
{ Args: { "claim": string,"reason": string }; Returns: undefined
                           },
"remind_oc":
{ Args: { "about": string,"event": string }; Returns: boolean
                           },
"remove_from_post":
{ Args: { "event": string,"post": string }; Returns: undefined
                           },
"reopen_cash_report":
{ Args: { "report": string }; Returns: undefined
                           },
"reopen_event":
{ Args: { "event": string }; Returns: string
                           },
"reorder_post":
{ Args: { "events": (string)[],"post": string }; Returns: undefined
                           },
"replace_group_role":
{ Args: { "emails": (string)[],"member_role": Database["public"]['Enums']["app_role"] }; Returns: number
                           },
"request_chat_space":
{ Args: { "event": string }; Returns: undefined
                           },
"request_photo_count":
{ Args: { "event": string }; Returns: undefined
                           },
"request_preapproval":
{ Args: { "description": string,"estimated": number,"event": string }; Returns: string
                           },
"retry_job":
{ Args: { "job_id": number }; Returns: undefined
                           },
"review_description":
{ Args: { "comment": string,"decision": string,"event": string,"rendered"?: string }; Returns: undefined
                           },
"revoke_calendar_feed":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"revoke_esn_token":
{ Args: { "token": string }; Returns: undefined
                           },
"roster_published":
{ Args: { "event": string }; Returns: boolean
                           },
"save_allocation":
{ Args: { "cycle": string,"rows": Json }; Returns: number
                           },
"save_cash_count":
{ Args: { "counts": Json,"phase": string,"report": string }; Returns: number
                           },
"save_description":
{ Args: { "event": string,"patch": Json }; Returns: {
              "fields": Json,"status": string,"version": number
            }[]
                           },
"save_event_report":
{ Args: { "access_needs"?: boolean,"access_note"?: string,"could_be_better"?: string,"event": string,"goals_reached": boolean,"intl_participants": number,"local_participants": number,"organizers": number,"went_well": string }; Returns: undefined
                           },
"schedule_photo_jobs":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"sees_board_meetings":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"set_cash_note":
{ Args: { "note": string,"report": string }; Returns: undefined
                           },
"set_channel_enabled":
{ Args: { "channel": string,"enabled": boolean }; Returns: undefined
                           },
"set_esncard_prices":
{ Args: { "external_cents": number,"internal_cents": number }; Returns: undefined
                           },
"set_group_role":
{ Args: { "member": boolean,"member_email": string,"member_role": Database["public"]['Enums']["app_role"] }; Returns: undefined
                           },
"set_my_payout_details":
{ Args: { "account_holder"?: string,"iban"?: string,"method": string,"paypal_email"?: string }; Returns: number
                           },
"set_payout_details":
{ Args: { "account_holder"?: string,"claim": string,"iban"?: string,"method": string,"paypal_email"?: string }; Returns: undefined
                           },
"set_trip_budget":
{ Args: { "amount": number,"event": string,"note"?: string }; Returns: undefined
                           },
"sign_in":
{ Args: { "esn_card"?: boolean,"event": string,"exchange_program"?: string,"first_name": string,"kiosk"?: boolean,"last_name": string,"nationality"?: string,"notice_version": string,"terms_version": string,"university"?: string }; Returns: undefined
                           },
"sign_up_internal":
{ Args: { "internal_event": string }; Returns: string
                           },
"signins_close_at":
{ Args: { "event_date": string }; Returns: string
                           },
"signins_open_at":
{ Args: { "event_date": string }; Returns: string
                           },
"skip_post":
{ Args: { "post": string,"reason": string }; Returns: undefined
                           },
"staging_upsert_demo_user":
{ Args: { "user_email": string,"user_id": string,"user_name": string,"user_password": string }; Returns: undefined
                           },
"staging_wipe":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"staging_wipe_plan":
{ Args: Record<PropertyKey, never>; Returns: {
              "action": string,"table_name": string
            }[]
                           },
"submit_description":
{ Args: { "event": string,"rendered": string }; Returns: undefined
                           },
"submit_volunteer_form":
{ Args: { "choices": Json,"cycle": string,"note"?: string }; Returns: string
                           },
"suggest_reimbursement":
{ Args: { "amount_cents": number,"budget_left_cents"?: number,"claim_role": string,"days"?: number,"preapproved"?: boolean,"rule": string }; Returns: {
              "flags": (string)[],"suggested_cents": number
            }[]
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
"unmark_esn_uploaded":
{ Args: { "event": string }; Returns: undefined
                           },
"withdraw_internal":
{ Args: { "internal_event": string }; Returns: undefined
                           },
"withdraw_receipt":
{ Args: { "claim": string }; Returns: undefined
                           },
"workspace_domain":
{ Args: Record<PropertyKey, never>; Returns: string
                           }
          }
          Enums: {
            "app_role": "events"|"comms"|"finance"|"treasurer"|"executive"|"admin"|"hr"|"vice_president"|"newbie","cycle_status": "planning"|"form_open"|"form_closed"|"allocated"|"confirmed","event_status": "draft"|"scheduled"|"understaffed"|"confirmed"|"cancelled"|"dropped"|"completed","event_type": "standard"|"special"|"day_trip"|"weekend_trip","internal_kind": "internal"|"stammtisch"|"tuesday_talk"|"board_meeting"|"office_hour"
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
            "app_role": ["events", "comms", "finance", "treasurer", "executive", "admin", "hr", "vice_president", "newbie"],"cycle_status": ["planning", "form_open", "form_closed", "allocated", "confirmed"],"event_status": ["draft", "scheduled", "understaffed", "confirmed", "cancelled", "dropped", "completed"],"event_type": ["standard", "special", "day_trip", "weekend_trip"],"internal_kind": ["internal", "stammtisch", "tuesday_talk", "board_meeting", "office_hour"]
          }
        }
} as const
