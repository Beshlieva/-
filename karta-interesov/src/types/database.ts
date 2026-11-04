export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type RegionKind = 'region' | 'city';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          region_id: number | null;
          age: number | null;
          failed_logins: number;
          locked_until: string | null;
          role: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email?: string;
          display_name?: string | null;
          region_id?: number | null;
          age?: number | null;
          failed_logins?: number;
          locked_until?: string | null;
          role?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          region_id?: number | null;
          age?: number | null;
          failed_logins?: number;
          locked_until?: string | null;
          role?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      regions: {
        Row: {
          id: number;
          code: string;
          name: string;
          kind: RegionKind;
          kato_code: string | null;
          sort_order: number;
        };
        Insert: {
          id?: number;
          code?: string;
          name?: string;
          kind?: RegionKind;
          kato_code?: string | null;
          sort_order?: number;
        };
        Update: {
          id?: number;
          code?: string;
          name?: string;
          kind?: RegionKind;
          kato_code?: string | null;
          sort_order?: number;
        };
      };
      categories: {
        Row: {
          id: number;
          name: string;
          description: string;
          color: string;
          icon: string;
        };
        Insert: {
          id?: number;
          name?: string;
          description?: string;
          color?: string;
          icon?: string;
        };
        Update: {
          id?: number;
          name?: string;
          description?: string;
          color?: string;
          icon?: string;
        };
      };
      questions: {
        Row: {
          id: number;
          category_id: number;
          text: string;
        };
        Insert: {
          id?: number;
          category_id?: number;
          text?: string;
        };
        Update: {
          id?: number;
          category_id?: number;
          text?: string;
        };
      };
      test_attempts: {
        Row: {
          id: number;
          user_id: string;
          client_attempt_id: string;
          test_version: string;
          region_id: number | null;
          status: 'in_progress' | 'completed';
          current_round: number;
          current_question_id: number | null;
          question_opened_at: string | null;
          started_at: string;
          completed_at: string | null;
          answered_count: number | null;
          calculated_at: string | null;
        };
        Insert: {
          id?: number;
          user_id?: string;
          client_attempt_id?: string;
          test_version?: string;
          region_id?: number | null;
          status?: 'in_progress' | 'completed';
          current_round?: number;
          current_question_id?: number | null;
          question_opened_at?: string | null;
          started_at?: string;
          completed_at?: string | null;
          answered_count?: number | null;
          calculated_at?: string | null;
        };
        Update: {
          id?: number;
          user_id?: string;
          client_attempt_id?: string;
          test_version?: string;
          region_id?: number | null;
          status?: 'in_progress' | 'completed';
          current_round?: number;
          current_question_id?: number | null;
          question_opened_at?: string | null;
          started_at?: string;
          completed_at?: string | null;
          answered_count?: number | null;
          calculated_at?: string | null;
        };
      };
      answers: {
        Row: {
          id: number;
          attempt_id: number;
          question_id: number;
          status: 'answered' | 'skipped';
          value: number | null;
          last_round: number;
          skip_count: number;
          shown_at: string;
          resolved_at: string;
        };
        Insert: {
          id?: number;
          attempt_id?: number;
          question_id?: number;
          status?: 'answered' | 'skipped';
          value?: number | null;
          last_round?: number;
          skip_count?: number;
          shown_at?: string;
          resolved_at?: string;
        };
        Update: {
          id?: number;
          attempt_id?: number;
          question_id?: number;
          status?: 'answered' | 'skipped';
          value?: number | null;
          last_round?: number;
          skip_count?: number;
          shown_at?: string;
          resolved_at?: string;
        };
      };
      attempt_results: {
        Row: {
          attempt_id: number;
          category_id: number;
          raw_score: number;
          display_score: number;
          rank_position: number;
        };
        Insert: {
          attempt_id?: number;
          category_id?: number;
          raw_score?: number;
          display_score?: number;
          rank_position?: number;
        };
        Update: {
          attempt_id?: number;
          category_id?: number;
          raw_score?: number;
          display_score?: number;
          rank_position?: number;
        };
      };
      admin_users: {
        Row: {
          id: number;
          username: string;
          password_hash: string;
          is_active: boolean;
          failed_logins: number;
          locked_until: string | null;
          token_hash: string | null;
          token_expires_at: string | null;
          last_login_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          username?: string;
          password_hash?: string;
          is_active?: boolean;
          failed_logins?: number;
          locked_until?: string | null;
          token_hash?: string | null;
          token_expires_at?: string | null;
          last_login_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          username?: string;
          password_hash?: string;
          is_active?: boolean;
          failed_logins?: number;
          locked_until?: string | null;
          token_hash?: string | null;
          token_expires_at?: string | null;
          last_login_at?: string | null;
          created_at?: string;
        };
      };
      admin_audit_logs: {
        Row: {
          id: number;
          admin_user_id: number | null;
          username_attempted: string | null;
          action: string;
          entity_type: string | null;
          entity_id: string | null;
          details: Json | null;
          ip_address: string;
          user_agent: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          admin_user_id?: number | null;
          username_attempted?: string | null;
          action?: string;
          entity_type?: string | null;
          entity_id?: string | null;
          details?: Json | null;
          ip_address?: string;
          user_agent?: string;
          created_at?: string;
        };
        Update: {
          id?: number;
          admin_user_id?: number | null;
          username_attempted?: string | null;
          action?: string;
          entity_type?: string | null;
          entity_id?: string | null;
          details?: Json | null;
          ip_address?: string;
          user_agent?: string;
          created_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
