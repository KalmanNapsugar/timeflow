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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_profile_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata_json: Json | null
          organization_id: string | null
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata_json?: Json | null
          organization_id?: string | null
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata_json?: Json | null
          organization_id?: string | null
        }
        Relationships: []
      }
      booking_locks: {
        Row: {
          created_at: string
          end_at: string
          expires_at: string
          guest_session_id: string | null
          id: string
          organization_id: string
          resource_id: string | null
          service_id: string
          staff_profile_id: string | null
          start_at: string
        }
        Insert: {
          created_at?: string
          end_at: string
          expires_at: string
          guest_session_id?: string | null
          id?: string
          organization_id: string
          resource_id?: string | null
          service_id: string
          staff_profile_id?: string | null
          start_at: string
        }
        Update: {
          created_at?: string
          end_at?: string
          expires_at?: string
          guest_session_id?: string | null
          id?: string
          organization_id?: string
          resource_id?: string | null
          service_id?: string
          staff_profile_id?: string | null
          start_at?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          cancellation_reason: string | null
          created_at: string
          customer_auth_user_id: string | null
          customer_id: string | null
          deposit_amount: number
          end_at: string
          id: string
          location_id: string | null
          organization_id: string
          payment_status: Database["public"]["Enums"]["payment_status"]
          price_total: number
          resource_id: string | null
          service_id: string
          source: string
          staff_profile_id: string | null
          start_at: string
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          created_at?: string
          customer_auth_user_id?: string | null
          customer_id?: string | null
          deposit_amount?: number
          end_at: string
          id?: string
          location_id?: string | null
          organization_id: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          price_total?: number
          resource_id?: string | null
          service_id: string
          source?: string
          staff_profile_id?: string | null
          start_at: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          created_at?: string
          customer_auth_user_id?: string | null
          customer_id?: string | null
          deposit_amount?: number
          end_at?: string
          id?: string
          location_id?: string | null
          organization_id?: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          price_total?: number
          resource_id?: string | null
          service_id?: string
          source?: string
          staff_profile_id?: string | null
          start_at?: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          max_uses: number | null
          organization_id: string
          type: Database["public"]["Enums"]["coupon_type"]
          updated_at: string
          used_count: number
          valid_from: string | null
          valid_until: string | null
          value: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          max_uses?: number | null
          organization_id: string
          type?: Database["public"]["Enums"]["coupon_type"]
          updated_at?: string
          used_count?: number
          valid_from?: string | null
          valid_until?: string | null
          value?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          max_uses?: number | null
          organization_id?: string
          type?: Database["public"]["Enums"]["coupon_type"]
          updated_at?: string
          used_count?: number
          valid_from?: string | null
          valid_until?: string | null
          value?: number
        }
        Relationships: []
      }
      customers: {
        Row: {
          auth_user_id: string | null
          blacklisted: boolean
          created_at: string
          email: string | null
          full_name: string
          gdpr_consent_at: string | null
          id: string
          notes_private: string | null
          organization_id: string
          phone: string | null
          requires_deposit_override: boolean
          tags: string[]
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          blacklisted?: boolean
          created_at?: string
          email?: string | null
          full_name: string
          gdpr_consent_at?: string | null
          id?: string
          notes_private?: string | null
          organization_id: string
          phone?: string | null
          requires_deposit_override?: boolean
          tags?: string[]
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          blacklisted?: boolean
          created_at?: string
          email?: string | null
          full_name?: string
          gdpr_consent_at?: string | null
          id?: string
          notes_private?: string | null
          organization_id?: string
          phone?: string | null
          requires_deposit_override?: boolean
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_answers: {
        Row: {
          answer_text: string | null
          booking_id: string
          created_at: string
          id: string
          question_id: string
        }
        Insert: {
          answer_text?: string | null
          booking_id: string
          created_at?: string
          id?: string
          question_id: string
        }
        Update: {
          answer_text?: string | null
          booking_id?: string
          created_at?: string
          id?: string
          question_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_answers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "intake_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_forms: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          organization_id: string
          service_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          organization_id: string
          service_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          service_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_forms_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_questions: {
        Row: {
          form_id: string
          id: string
          label: string
          options_json: Json | null
          required: boolean
          sort_order: number
          type: string
        }
        Insert: {
          form_id: string
          id?: string
          label: string
          options_json?: Json | null
          required?: boolean
          sort_order?: number
          type?: string
        }
        Update: {
          form_id?: string
          id?: string
          label?: string
          options_json?: Json | null
          required?: boolean
          sort_order?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_questions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "intake_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          active: boolean
          created_at: string
          id: string
          low_stock_threshold: number
          name: string
          organization_id: string
          quantity: number
          sku: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          low_stock_threshold?: number
          name: string
          organization_id: string
          quantity?: number
          sku?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          low_stock_threshold?: number
          name?: string
          organization_id?: string
          quantity?: number
          sku?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          booking_id: string | null
          created_at: string
          created_by: string | null
          delta: number
          id: string
          item_id: string
          organization_id: string
          reason: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          item_id: string
          organization_id: string
          reason?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          item_id?: string
          organization_id?: string
          reason?: string | null
        }
        Relationships: []
      }
      locations: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          opening_hours_json: Json
          organization_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          opening_hours_json?: Json
          organization_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          opening_hours_json?: Json
          organization_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_logs: {
        Row: {
          booking_id: string | null
          channel: string
          customer_id: string | null
          id: string
          organization_id: string
          payload_json: Json | null
          recipient: string | null
          sent_at: string
          status: string
          template_key: string
        }
        Insert: {
          booking_id?: string | null
          channel?: string
          customer_id?: string | null
          id?: string
          organization_id: string
          payload_json?: Json | null
          recipient?: string | null
          sent_at?: string
          status?: string
          template_key: string
        }
        Update: {
          booking_id?: string | null
          channel?: string
          customer_id?: string | null
          id?: string
          organization_id?: string
          payload_json?: Json | null
          recipient?: string | null
          sent_at?: string
          status?: string
          template_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          active: boolean
          body: string
          channel: string
          created_at: string
          id: string
          organization_id: string
          subject: string | null
          template_key: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          body?: string
          channel?: string
          created_at?: string
          id?: string
          organization_id: string
          subject?: string | null
          template_key: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string
          channel?: string
          created_at?: string
          id?: string
          organization_id?: string
          subject?: string | null
          template_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      organization_members: {
        Row: {
          active: boolean
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["org_member_role"]
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["org_member_role"]
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["org_member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          country: string
          cover_url: string | null
          created_at: string
          currency: string
          description: string | null
          id: string
          name: string
          owner_id: string | null
          plan: string
          public_profile_enabled: boolean
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          country?: string
          cover_url?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          name: string
          owner_id?: string | null
          plan?: string
          public_profile_enabled?: boolean
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          country?: string
          cover_url?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          name?: string
          owner_id?: string | null
          plan?: string
          public_profile_enabled?: boolean
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          currency: string
          external_reference: string | null
          id: string
          paid_at: string | null
          provider: string
          status: Database["public"]["Enums"]["payment_status"]
        }
        Insert: {
          amount: number
          booking_id: string
          created_at?: string
          currency?: string
          external_reference?: string | null
          id?: string
          paid_at?: string | null
          provider?: string
          status?: Database["public"]["Enums"]["payment_status"]
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          currency?: string
          external_reference?: string | null
          id?: string
          paid_at?: string | null
          provider?: string
          status?: Database["public"]["Enums"]["payment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          auth_user_id: string
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      resources: {
        Row: {
          active: boolean
          created_at: string
          id: string
          location_id: string | null
          name: string
          organization_id: string
          type: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          location_id?: string | null
          name: string
          organization_id: string
          type?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          location_id?: string | null
          name?: string
          organization_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "resources_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          booking_id: string | null
          comment: string | null
          created_at: string
          customer_auth_user_id: string | null
          customer_id: string | null
          id: string
          organization_id: string
          rating: number
          reply: string | null
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          comment?: string | null
          created_at?: string
          customer_auth_user_id?: string | null
          customer_id?: string | null
          id?: string
          organization_id: string
          rating: number
          reply?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          comment?: string | null
          created_at?: string
          customer_auth_user_id?: string | null
          customer_id?: string | null
          id?: string
          organization_id?: string
          rating?: number
          reply?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          label: string
          roles: Database["public"]["Enums"]["app_role"][]
          route_path: string
          updated_at: string
        }
        Insert: {
          label: string
          roles?: Database["public"]["Enums"]["app_role"][]
          route_path: string
          updated_at?: string
        }
        Update: {
          label?: string
          roles?: Database["public"]["Enums"]["app_role"][]
          route_path?: string
          updated_at?: string
        }
        Relationships: []
      }
      service_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_package_items: {
        Row: {
          id: string
          package_id: string
          quantity: number
          service_id: string
        }
        Insert: {
          id?: string
          package_id: string
          quantity?: number
          service_id: string
        }
        Update: {
          id?: string
          package_id?: string
          quantity?: number
          service_id?: string
        }
        Relationships: []
      }
      service_packages: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string
          price: number
          updated_at: string
          validity_months: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          price?: number
          updated_at?: string
          validity_months?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          price?: number
          updated_at?: string
          validity_months?: number
        }
        Relationships: []
      }
      service_resources: {
        Row: {
          id: string
          required: boolean
          resource_id: string
          service_id: string
        }
        Insert: {
          id?: string
          required?: boolean
          resource_id: string
          service_id: string
        }
        Update: {
          id?: string
          required?: boolean
          resource_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_resources_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_resources_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          active: boolean
          buffer_after_minutes: number
          buffer_before_minutes: number
          cancellation_policy_json: Json
          category_id: string | null
          created_at: string
          deposit_amount: number
          deposit_required: boolean
          description: string | null
          duration_minutes: number
          id: string
          name: string
          organization_id: string
          price: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          cancellation_policy_json?: Json
          category_id?: string | null
          created_at?: string
          deposit_amount?: number
          deposit_required?: boolean
          description?: string | null
          duration_minutes?: number
          id?: string
          name: string
          organization_id: string
          price?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          cancellation_policy_json?: Json
          category_id?: string | null
          created_at?: string
          deposit_amount?: number
          deposit_required?: boolean
          description?: string | null
          duration_minutes?: number
          id?: string
          name?: string
          organization_id?: string
          price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_profiles: {
        Row: {
          active: boolean
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string
          id: string
          organization_id: string
          updated_at: string
          user_id: string | null
          working_hours_json: Json
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name: string
          id?: string
          organization_id: string
          updated_at?: string
          user_id?: string | null
          working_hours_json?: Json
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string
          id?: string
          organization_id?: string
          updated_at?: string
          user_id?: string | null
          working_hours_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "staff_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_services: {
        Row: {
          id: string
          service_id: string
          staff_profile_id: string
        }
        Insert: {
          id?: string
          service_id: string
          staff_profile_id: string
        }
        Update: {
          id?: string
          service_id?: string
          staff_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_services_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vouchers: {
        Row: {
          active: boolean
          balance: number
          code: string
          created_at: string
          currency: string
          customer_id: string | null
          expires_at: string | null
          id: string
          initial_amount: number
          organization_id: string
          recipient_email: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          balance?: number
          code: string
          created_at?: string
          currency?: string
          customer_id?: string | null
          expires_at?: string | null
          id?: string
          initial_amount?: number
          organization_id: string
          recipient_email?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          balance?: number
          code?: string
          created_at?: string
          currency?: string
          customer_id?: string | null
          expires_at?: string | null
          id?: string
          initial_amount?: number
          organization_id?: string
          recipient_email?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_member: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_owner: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "guest" | "staff" | "owner" | "platform_admin"
      booking_status:
        | "draft"
        | "pending_payment"
        | "confirmed"
        | "checked_in"
        | "completed"
        | "cancelled_by_guest"
        | "cancelled_by_provider"
        | "no_show"
      coupon_type: "percent" | "fixed"
      org_member_role: "owner" | "staff"
      payment_status:
        | "none"
        | "pending"
        | "mock_paid"
        | "paid"
        | "refunded"
        | "failed"
      review_status: "pending" | "approved" | "hidden"
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
      app_role: ["guest", "staff", "owner", "platform_admin"],
      booking_status: [
        "draft",
        "pending_payment",
        "confirmed",
        "checked_in",
        "completed",
        "cancelled_by_guest",
        "cancelled_by_provider",
        "no_show",
      ],
      coupon_type: ["percent", "fixed"],
      org_member_role: ["owner", "staff"],
      payment_status: [
        "none",
        "pending",
        "mock_paid",
        "paid",
        "refunded",
        "failed",
      ],
      review_status: ["pending", "approved", "hidden"],
    },
  },
} as const
