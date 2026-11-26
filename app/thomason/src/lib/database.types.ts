export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type PersonRow = {
  id: string
  first_name: string
  last_name: string
  birthday: string
  gender: 'M' | 'F'
  user_id: string | null
  can_edit: boolean
  avatar_drive_file_id: string | null
  avatar_region_id: string | null
  updated_at: string
}

export type PersonInviteRow = {
  id: string
  person_id: string
  email: string | null
  grant_can_edit: boolean
  created_at: string
  expires_at: string
  redeemed_at: string | null
}

export type RelationshipRow = {
  id: string
  person_id: string
  related_person_id: string
  type: 'parent' | 'spouse'
}

export type RelationshipInsert = {
  person_id: string
  related_person_id: string
  type: 'parent' | 'spouse'
}

export type PhotoRegionRow = {
  id: string
  drive_file_id: string
  user_id: string
  person_id: string | null
  x: number
  y: number
  w: number
  h: number
  label: string | null
  created_at: string
  updated_at: string
}

export type PhotoCommentRow = {
  id: string
  drive_file_id: string
  region_id: string | null
  user_id: string
  body: string
  created_at: string
  updated_at: string
}

export type Database = {
  public: {
    Tables: {
      people: {
        Row: PersonRow
        Insert: {
          id: string
          first_name?: string
          last_name?: string
          birthday?: string
          gender: 'M' | 'F'
          user_id?: string | null
          can_edit?: boolean
          avatar_drive_file_id?: string | null
          avatar_region_id?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          first_name?: string
          last_name?: string
          birthday?: string
          gender?: 'M' | 'F'
          user_id?: string | null
          can_edit?: boolean
          avatar_drive_file_id?: string | null
          avatar_region_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      relationships: {
        Row: RelationshipRow
        Insert: RelationshipInsert & { id?: string }
        Update: Partial<RelationshipInsert> & { id?: string }
        Relationships: []
      }
      person_invites: {
        Row: PersonInviteRow & {
          token_hash: string
          created_by: string
          redeemed_by: string | null
        }
        Insert: {
          id?: string
          person_id: string
          token_hash: string
          grant_can_edit?: boolean
          created_by: string
          email?: string | null
          created_at?: string
          expires_at?: string
          redeemed_at?: string | null
          redeemed_by?: string | null
        }
        Update: {
          email?: string | null
          grant_can_edit?: boolean
          redeemed_at?: string | null
          redeemed_by?: string | null
        }
        Relationships: []
      }
      photo_regions: {
        Row: PhotoRegionRow
        Insert: {
          id?: string
          drive_file_id: string
          user_id: string
          person_id?: string | null
          x: number
          y: number
          w: number
          h: number
          label?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          drive_file_id?: string
          user_id?: string
          person_id?: string | null
          x?: number
          y?: number
          w?: number
          h?: number
          label?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      photo_comments: {
        Row: PhotoCommentRow
        Insert: {
          id?: string
          drive_file_id: string
          region_id?: string | null
          user_id: string
          body: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          drive_file_id?: string
          region_id?: string | null
          user_id?: string
          body?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      can_edit_tree: {
        Args: Record<string, never>
        Returns: boolean
      }
      unlink_my_person: {
        Args: Record<string, never>
        Returns: undefined
      }
      link_my_person: {
        Args: { target_person_id: string }
        Returns: undefined
      }
      create_person_invite: {
        Args: {
          target_person_id: string
          grant_can_edit?: boolean
          invite_email?: string | null
        }
        Returns: string
      }
      redeem_person_invite: {
        Args: { invite_token: string }
        Returns: undefined
      }
      list_editor_notification_emails: {
        Args: Record<string, never>
        Returns: { email: string }[]
      }
      my_person_display_name: {
        Args: Record<string, never>
        Returns: string | null
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
