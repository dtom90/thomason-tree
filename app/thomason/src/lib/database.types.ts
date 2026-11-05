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
  updated_at: string
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
    }
    Views: Record<string, never>
    Functions: {
      can_edit_tree: {
        Args: Record<string, never>
        Returns: boolean
      }
      reset_tree_to_seed: {
        Args: Record<string, never>
        Returns: undefined
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
