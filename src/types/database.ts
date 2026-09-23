// Dihasilkan dari skema Supabase lewat generate_typescript_types -- JANGAN diedit manual, generate ulang setiap kali menambah migration.

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
      audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          id: string
          new_data: Json | null
          old_data: Json | null
          row_id: string
          table_name: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          row_id: string
          table_name: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          row_id?: string
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_lines: {
        Row: {
          batch_id: string
          created_at: string
          id: string
          receiving_lot_id: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          id?: string
          receiving_lot_id: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          id?: string
          receiving_lot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "batch_lines_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_lines_receiving_lot_id_fkey"
            columns: ["receiving_lot_id"]
            isOneToOne: false
            referencedRelation: "receiving_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      batches: {
        Row: {
          business_date: string
          created_at: string
          id: string
          site_id: string
          tank_id: string
        }
        Insert: {
          business_date: string
          created_at?: string
          id?: string
          site_id: string
          tank_id: string
        }
        Update: {
          business_date?: string
          created_at?: string
          id?: string
          site_id?: string
          tank_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "batches_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_tank_id_fkey"
            columns: ["tank_id"]
            isOneToOne: false
            referencedRelation: "tanks"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_ledger: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string
          event_at: string
          id: string
          pic_user_id: string
          ref_id: string | null
          ref_type: string | null
          reversal_of: string | null
          site_id: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          created_by: string
          event_at: string
          id?: string
          pic_user_id: string
          ref_id?: string | null
          ref_type?: string | null
          reversal_of?: string | null
          site_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string
          event_at?: string
          id?: string
          pic_user_id?: string
          ref_id?: string | null
          ref_type?: string | null
          reversal_of?: string | null
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_ledger_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_ledger_pic_user_id_fkey"
            columns: ["pic_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_ledger_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "cash_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_ledger_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "v_cash_ledger_with_track"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_ledger_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_reconciliations: {
        Row: {
          adjustment_ledger_id: string | null
          approval_reason: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string
          id: string
          notes: string | null
          period_end_date: string
          physical_amount: number
          pic_user_id: string
          site_id: string
          status: string
          system_balance: number
          variance: number
        }
        Insert: {
          adjustment_ledger_id?: string | null
          approval_reason?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          period_end_date: string
          physical_amount: number
          pic_user_id: string
          site_id: string
          status?: string
          system_balance: number
          variance: number
        }
        Update: {
          adjustment_ledger_id?: string | null
          approval_reason?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          period_end_date?: string
          physical_amount?: number
          pic_user_id?: string
          site_id?: string
          status?: string
          system_balance?: number
          variance?: number
        }
        Relationships: [
          {
            foreignKeyName: "cash_reconciliations_adjustment_ledger_id_fkey"
            columns: ["adjustment_ledger_id"]
            isOneToOne: false
            referencedRelation: "cash_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_reconciliations_adjustment_ledger_id_fkey"
            columns: ["adjustment_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_cash_ledger_with_track"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_reconciliations_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_reconciliations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_reconciliations_pic_user_id_fkey"
            columns: ["pic_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_reconciliations_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      company_cash_ledger: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string
          description: string | null
          event_at: string
          id: string
          opex_category_id: string | null
          ref_id: string | null
          ref_type: string | null
          reversal_of: string | null
          tax_type: string | null
          track: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          created_by: string
          description?: string | null
          event_at?: string
          id?: string
          opex_category_id?: string | null
          ref_id?: string | null
          ref_type?: string | null
          reversal_of?: string | null
          tax_type?: string | null
          track: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string
          description?: string | null
          event_at?: string
          id?: string
          opex_category_id?: string | null
          ref_id?: string | null
          ref_type?: string | null
          reversal_of?: string | null
          tax_type?: string | null
          track?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_cash_ledger_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_cash_ledger_opex_category_id_fkey"
            columns: ["opex_category_id"]
            isOneToOne: false
            referencedRelation: "opex_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_cash_ledger_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "company_cash_ledger"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          acceptance_policy: Json
          created_at: string
          id: string
          name: string
          notes: string | null
          payment_term_days: number | null
          segment: string | null
          settlement_mode: Database["public"]["Enums"]["settlement_mode"]
          status: string
        }
        Insert: {
          acceptance_policy?: Json
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          payment_term_days?: number | null
          segment?: string | null
          settlement_mode: Database["public"]["Enums"]["settlement_mode"]
          status?: string
        }
        Update: {
          acceptance_policy?: Json
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          payment_term_days?: number | null
          segment?: string | null
          settlement_mode?: Database["public"]["Enums"]["settlement_mode"]
          status?: string
        }
        Relationships: []
      }
      deliveries: {
        Row: {
          actual_weight_kg: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          delivered_at: string | null
          demand_id: string | null
          id: string
          planned_kg: number
          site_id: string
        }
        Insert: {
          actual_weight_kg?: number | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          demand_id?: string | null
          id?: string
          planned_kg: number
          site_id: string
        }
        Update: {
          actual_weight_kg?: number | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          demand_id?: string | null
          id?: string
          planned_kg?: number
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_demand_id_fkey"
            columns: ["demand_id"]
            isOneToOne: false
            referencedRelation: "demands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_demand_id_fkey"
            columns: ["demand_id"]
            isOneToOne: false
            referencedRelation: "v_demands_with_fulfillment"
            referencedColumns: ["demand_id"]
          },
          {
            foreignKeyName: "deliveries_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_allocations: {
        Row: {
          batch_line_id: string
          buy_price_per_kg: number
          created_at: string
          delivery_id: string
          fefo_rank: number
          id: string
          override_reason: string | null
          qty_kg: number
        }
        Insert: {
          batch_line_id: string
          buy_price_per_kg: number
          created_at?: string
          delivery_id: string
          fefo_rank: number
          id?: string
          override_reason?: string | null
          qty_kg: number
        }
        Update: {
          batch_line_id?: string
          buy_price_per_kg?: number
          created_at?: string
          delivery_id?: string
          fefo_rank?: number
          id?: string
          override_reason?: string | null
          qty_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_allocations_batch_line_id_fkey"
            columns: ["batch_line_id"]
            isOneToOne: false
            referencedRelation: "batch_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_allocations_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_allocations_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "v_deliveries_pending_settlement"
            referencedColumns: ["delivery_id"]
          },
          {
            foreignKeyName: "delivery_allocations_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "v_trading_delivery_margin"
            referencedColumns: ["delivery_id"]
          },
        ]
      }
      demands: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          expected_price_per_kg: number | null
          id: string
          needed_by: string | null
          product_id: string
          requested_qty_kg: number
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          expected_price_per_kg?: number | null
          id?: string
          needed_by?: string | null
          product_id: string
          requested_qty_kg: number
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          expected_price_per_kg?: number | null
          id?: string
          needed_by?: string | null
          product_id?: string
          requested_qty_kg?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "demands_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demands_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demands_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demands_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_trading_margin_by_product"
            referencedColumns: ["product_id"]
          },
        ]
      }
      finance_budgets: {
        Row: {
          budget_amount: number
          line_item: string
          period_month: string
          track: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          budget_amount: number
          line_item: string
          period_month: string
          track: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          budget_amount?: number
          line_item?: string
          period_month?: string
          track?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_budgets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_targets: {
        Row: {
          margin_target_pct: number
          track: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          margin_target_pct: number
          track: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          margin_target_pct?: number
          track?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_targets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      handover_lines: {
        Row: {
          batch_line_id: string
          created_at: string
          handover_id: string
          id: string
          qty_kg: number
          qty_kg_received: number | null
          to_batch_line_id: string | null
        }
        Insert: {
          batch_line_id: string
          created_at?: string
          handover_id: string
          id?: string
          qty_kg: number
          qty_kg_received?: number | null
          to_batch_line_id?: string | null
        }
        Update: {
          batch_line_id?: string
          created_at?: string
          handover_id?: string
          id?: string
          qty_kg?: number
          qty_kg_received?: number | null
          to_batch_line_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "handover_lines_batch_line_id_fkey"
            columns: ["batch_line_id"]
            isOneToOne: false
            referencedRelation: "batch_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_lines_handover_id_fkey"
            columns: ["handover_id"]
            isOneToOne: false
            referencedRelation: "handovers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_lines_to_batch_line_id_fkey"
            columns: ["to_batch_line_id"]
            isOneToOne: false
            referencedRelation: "batch_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      handovers: {
        Row: {
          cancelled_at: string | null
          cancelled_reason: string | null
          client_id: string
          created_at: string
          from_site_id: string
          handed_by: string | null
          handed_over_at: string
          id: string
          notes: string | null
          received_at: string | null
          received_business_date: string | null
          received_by: string | null
          to_site_id: string
          to_tank_id: string | null
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_reason?: string | null
          client_id: string
          created_at?: string
          from_site_id: string
          handed_by?: string | null
          handed_over_at: string
          id?: string
          notes?: string | null
          received_at?: string | null
          received_business_date?: string | null
          received_by?: string | null
          to_site_id: string
          to_tank_id?: string | null
        }
        Update: {
          cancelled_at?: string | null
          cancelled_reason?: string | null
          client_id?: string
          created_at?: string
          from_site_id?: string
          handed_by?: string | null
          handed_over_at?: string
          id?: string
          notes?: string | null
          received_at?: string | null
          received_business_date?: string | null
          received_by?: string | null
          to_site_id?: string
          to_tank_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "handovers_from_site_id_fkey"
            columns: ["from_site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handovers_handed_by_fkey"
            columns: ["handed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handovers_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handovers_to_site_id_fkey"
            columns: ["to_site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handovers_to_tank_id_fkey"
            columns: ["to_tank_id"]
            isOneToOne: false
            referencedRelation: "tanks"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_ledger: {
        Row: {
          batch_line_id: string
          client_id: string
          created_at: string
          event_at: string
          id: string
          movement_type: Database["public"]["Enums"]["movement_type"]
          qty_kg: number
          ref_id: string | null
          ref_type: string | null
          reversal_of: string | null
          user_id: string | null
        }
        Insert: {
          batch_line_id: string
          client_id: string
          created_at?: string
          event_at: string
          id?: string
          movement_type: Database["public"]["Enums"]["movement_type"]
          qty_kg: number
          ref_id?: string | null
          ref_type?: string | null
          reversal_of?: string | null
          user_id?: string | null
        }
        Update: {
          batch_line_id?: string
          client_id?: string
          created_at?: string
          event_at?: string
          id?: string
          movement_type?: Database["public"]["Enums"]["movement_type"]
          qty_kg?: number
          ref_id?: string | null
          ref_type?: string | null
          reversal_of?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_ledger_batch_line_id_fkey"
            columns: ["batch_line_id"]
            isOneToOne: false
            referencedRelation: "batch_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_ledger_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "inventory_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_ledger_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_with_track"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mortality_events: {
        Row: {
          batch_line_id: string
          cause: string | null
          client_id: string
          created_at: string
          event_at: string
          id: string
          inventory_ledger_id: string | null
          qty_kg: number
          recorded_by: string | null
        }
        Insert: {
          batch_line_id: string
          cause?: string | null
          client_id: string
          created_at?: string
          event_at: string
          id?: string
          inventory_ledger_id?: string | null
          qty_kg: number
          recorded_by?: string | null
        }
        Update: {
          batch_line_id?: string
          cause?: string | null
          client_id?: string
          created_at?: string
          event_at?: string
          id?: string
          inventory_ledger_id?: string | null
          qty_kg?: number
          recorded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mortality_events_batch_line_id_fkey"
            columns: ["batch_line_id"]
            isOneToOne: false
            referencedRelation: "batch_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortality_events_inventory_ledger_id_fkey"
            columns: ["inventory_ledger_id"]
            isOneToOne: false
            referencedRelation: "inventory_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortality_events_inventory_ledger_id_fkey"
            columns: ["inventory_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_with_track"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mortality_events_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      opex_categories: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      price_today: {
        Row: {
          created_at: string
          effective_date: string
          id: string
          price: number
          product_id: string
          site_id: string
        }
        Insert: {
          created_at?: string
          effective_date: string
          id?: string
          price: number
          product_id: string
          site_id: string
        }
        Update: {
          created_at?: string
          effective_date?: string
          id?: string
          price?: number
          product_id?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_today_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_today_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_trading_margin_by_product"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "price_today_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      product_holding_policy: {
        Row: {
          created_at: string
          id: string
          max_holding_hours: number
          product_id: string
          track: Database["public"]["Enums"]["site_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          max_holding_hours: number
          product_id: string
          track: Database["public"]["Enums"]["site_type"]
        }
        Update: {
          created_at?: string
          id?: string
          max_holding_hours?: number
          product_id?: string
          track?: Database["public"]["Enums"]["site_type"]
        }
        Relationships: [
          {
            foreignKeyName: "product_holding_policy_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_holding_policy_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_trading_margin_by_product"
            referencedColumns: ["product_id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      quality_inspections: {
        Row: {
          batch_id: string
          client_id: string
          created_at: string
          grade: string | null
          id: string
          inspected_at: string
          inspector_id: string | null
          notes: string | null
        }
        Insert: {
          batch_id: string
          client_id: string
          created_at?: string
          grade?: string | null
          id?: string
          inspected_at: string
          inspector_id?: string | null
          notes?: string | null
        }
        Update: {
          batch_id?: string
          client_id?: string
          created_at?: string
          grade?: string | null
          id?: string
          inspected_at?: string
          inspector_id?: string | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_inspections_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      receiving_lots: {
        Row: {
          buy_price_per_kg: number
          created_at: string
          id: string
          product_id: string
          qty_kg: number
          receiving_transaction_id: string
        }
        Insert: {
          buy_price_per_kg: number
          created_at?: string
          id?: string
          product_id: string
          qty_kg: number
          receiving_transaction_id: string
        }
        Update: {
          buy_price_per_kg?: number
          created_at?: string
          id?: string
          product_id?: string
          qty_kg?: number
          receiving_transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receiving_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_trading_margin_by_product"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "receiving_lots_receiving_transaction_id_fkey"
            columns: ["receiving_transaction_id"]
            isOneToOne: false
            referencedRelation: "receiving_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      receiving_transactions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          site_id: string
          source_handover_id: string | null
          supplier_id: string | null
          transaction_date: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          site_id: string
          source_handover_id?: string | null
          supplier_id?: string | null
          transaction_date: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          site_id?: string
          source_handover_id?: string | null
          supplier_id?: string | null
          transaction_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "receiving_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_transactions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_transactions_source_handover_id_fkey"
            columns: ["source_handover_id"]
            isOneToOne: false
            referencedRelation: "handovers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_transactions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          amount: number
          created_at: string
          customer_id: string
          delivery_id: string
          due_date: string | null
          id: string
          mode: Database["public"]["Enums"]["settlement_mode"]
          override_reason: string | null
          settled_at: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          customer_id: string
          delivery_id: string
          due_date?: string | null
          id?: string
          mode: Database["public"]["Enums"]["settlement_mode"]
          override_reason?: string | null
          settled_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          customer_id?: string
          delivery_id?: string
          due_date?: string | null
          id?: string
          mode?: Database["public"]["Enums"]["settlement_mode"]
          override_reason?: string | null
          settled_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlements_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: true
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: true
            referencedRelation: "v_deliveries_pending_settlement"
            referencedColumns: ["delivery_id"]
          },
          {
            foreignKeyName: "settlements_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: true
            referencedRelation: "v_trading_delivery_margin"
            referencedColumns: ["delivery_id"]
          },
        ]
      }
      sites: {
        Row: {
          created_at: string
          id: string
          monthly_cost: number
          name: string
          type: Database["public"]["Enums"]["site_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          monthly_cost?: number
          name: string
          type: Database["public"]["Enums"]["site_type"]
        }
        Update: {
          created_at?: string
          id?: string
          monthly_cost?: number
          name?: string
          type?: Database["public"]["Enums"]["site_type"]
        }
        Relationships: []
      }
      stock_adjustments: {
        Row: {
          batch_line_id: string
          client_id: string
          created_at: string
          event_at: string
          id: string
          inventory_ledger_id: string | null
          kind: string
          qty_kg: number
          reason: string
          recorded_by: string | null
        }
        Insert: {
          batch_line_id: string
          client_id: string
          created_at?: string
          event_at: string
          id?: string
          inventory_ledger_id?: string | null
          kind: string
          qty_kg: number
          reason: string
          recorded_by?: string | null
        }
        Update: {
          batch_line_id?: string
          client_id?: string
          created_at?: string
          event_at?: string
          id?: string
          inventory_ledger_id?: string | null
          kind?: string
          qty_kg?: number
          reason?: string
          recorded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_batch_line_id_fkey"
            columns: ["batch_line_id"]
            isOneToOne: false
            referencedRelation: "batch_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_inventory_ledger_id_fkey"
            columns: ["inventory_ledger_id"]
            isOneToOne: false
            referencedRelation: "inventory_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_inventory_ledger_id_fkey"
            columns: ["inventory_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_with_track"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          id: string
          name: string
          payment_term_days: number | null
          phone: string | null
          status: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          id?: string
          name: string
          payment_term_days?: number | null
          phone?: string | null
          status?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          id?: string
          name?: string
          payment_term_days?: number | null
          phone?: string | null
          status?: string
        }
        Relationships: []
      }
      tanks: {
        Row: {
          created_at: string
          id: string
          name: string
          site_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          site_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tanks_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      terima_cepat_favorites: {
        Row: {
          created_at: string
          id: string
          label: string
          product_id: string
          site_id: string
          supplier_id: string
          tank_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          product_id: string
          site_id: string
          supplier_id: string
          tank_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          product_id?: string
          site_id?: string
          supplier_id?: string
          tank_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "terima_cepat_favorites_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terima_cepat_favorites_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_trading_margin_by_product"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "terima_cepat_favorites_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terima_cepat_favorites_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terima_cepat_favorites_tank_id_fkey"
            columns: ["tank_id"]
            isOneToOne: false
            referencedRelation: "tanks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terima_cepat_favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_sites: {
        Row: {
          created_at: string
          site_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          site_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          site_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_sites_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_sites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          full_name: string
          id: string
          role: string | null
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          role?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          role?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      v_batch_line_balance: {
        Row: {
          balance_kg: number | null
          batch_line_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_ledger_batch_line_id_fkey"
            columns: ["batch_line_id"]
            isOneToOne: false
            referencedRelation: "batch_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      v_cash_balance: {
        Row: {
          balance: number | null
          pic_name: string | null
          pic_user_id: string | null
          site_id: string | null
          site_name: string | null
          track: Database["public"]["Enums"]["site_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_ledger_pic_user_id_fkey"
            columns: ["pic_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_ledger_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      v_cash_ledger_with_track: {
        Row: {
          amount: number | null
          category: string | null
          created_at: string | null
          created_by: string | null
          event_at: string | null
          id: string | null
          ref_id: string | null
          ref_type: string | null
          reversal_of: string | null
          site_id: string | null
          track: Database["public"]["Enums"]["site_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_ledger_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_ledger_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "cash_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_ledger_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "v_cash_ledger_with_track"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_ledger_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      v_deliveries_pending_settlement: {
        Row: {
          actual_weight_kg: number | null
          customer_id: string | null
          customer_name: string | null
          delivered_at: string | null
          delivery_id: string | null
          demand_id: string | null
          expected_price_per_kg: number | null
          planned_kg: number | null
          site_id: string | null
          site_name: string | null
          track: Database["public"]["Enums"]["site_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_demand_id_fkey"
            columns: ["demand_id"]
            isOneToOne: false
            referencedRelation: "demands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_demand_id_fkey"
            columns: ["demand_id"]
            isOneToOne: false
            referencedRelation: "v_demands_with_fulfillment"
            referencedColumns: ["demand_id"]
          },
          {
            foreignKeyName: "deliveries_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demands_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_delivery_product_line_count: {
        Row: {
          delivery_id: string | null
          n_products: number | null
          sole_product_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_allocations_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_allocations_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "v_deliveries_pending_settlement"
            referencedColumns: ["delivery_id"]
          },
          {
            foreignKeyName: "delivery_allocations_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "v_trading_delivery_margin"
            referencedColumns: ["delivery_id"]
          },
        ]
      }
      v_demands_with_fulfillment: {
        Row: {
          allocated_kg: number | null
          demand_id: string | null
          remaining_kg: number | null
          requested_qty_kg: number | null
        }
        Insert: {
          allocated_kg?: never
          demand_id?: string | null
          remaining_kg?: never
          requested_qty_kg?: number | null
        }
        Update: {
          allocated_kg?: never
          demand_id?: string | null
          remaining_kg?: never
          requested_qty_kg?: number | null
        }
        Relationships: []
      }
      v_inventory_ledger_with_track: {
        Row: {
          batch_line_id: string | null
          client_id: string | null
          created_at: string | null
          event_at: string | null
          id: string | null
          movement_type: Database["public"]["Enums"]["movement_type"] | null
          qty_kg: number | null
          ref_id: string | null
          ref_type: string | null
          reversal_of: string | null
          site_id: string | null
          track: Database["public"]["Enums"]["site_type"] | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "batches_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_ledger_batch_line_id_fkey"
            columns: ["batch_line_id"]
            isOneToOne: false
            referencedRelation: "batch_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_ledger_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "inventory_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_ledger_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_with_track"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      v_settlements_aging: {
        Row: {
          amount: number | null
          customer_id: string | null
          customer_name: string | null
          days_until_due: number | null
          delivery_id: string | null
          due_date: string | null
          mode: Database["public"]["Enums"]["settlement_mode"] | null
          settled_at: string | null
          settlement_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlements_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: true
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: true
            referencedRelation: "v_deliveries_pending_settlement"
            referencedColumns: ["delivery_id"]
          },
          {
            foreignKeyName: "settlements_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: true
            referencedRelation: "v_trading_delivery_margin"
            referencedColumns: ["delivery_id"]
          },
        ]
      }
      v_trading_capital_lockup: {
        Row: {
          batch_line_id: string | null
          delivered_at: string | null
          delivery_allocation_id: string | null
          lockup_days: number | null
          qty_kg: number | null
          received_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_allocations_batch_line_id_fkey"
            columns: ["batch_line_id"]
            isOneToOne: false
            referencedRelation: "batch_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      v_trading_delivery_margin: {
        Row: {
          actual_weight_kg: number | null
          cogs: number | null
          delivery_id: string | null
          margin: number | null
          margin_per_kg: number | null
          revenue: number | null
          site_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      v_trading_dpo_inputs: {
        Row: {
          buy_price_per_kg: number | null
          delivery_allocation_id: string | null
          payment_term_days: number | null
          purchase_value: number | null
          qty_kg: number | null
        }
        Relationships: []
      }
      v_trading_margin_by_product: {
        Row: {
          cogs: number | null
          delivery_count: number | null
          margin: number | null
          margin_pct: number | null
          product_id: string | null
          product_name: string | null
          revenue: number | null
        }
        Relationships: []
      }
      v_trading_margin_by_segment: {
        Row: {
          cogs: number | null
          delivery_count: number | null
          margin: number | null
          margin_pct: number | null
          revenue: number | null
          segment: string | null
        }
        Relationships: []
      }
      v_trading_margin_mixed_summary: {
        Row: {
          cogs: number | null
          delivery_count: number | null
          margin: number | null
          revenue: number | null
        }
        Relationships: []
      }
      v_trading_receivable_cycle: {
        Row: {
          created_at: string | null
          days_to_collect: number | null
          delivery_id: string | null
          due_date: string | null
          settled_at: string | null
          settlement_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlements_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: true
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: true
            referencedRelation: "v_deliveries_pending_settlement"
            referencedColumns: ["delivery_id"]
          },
          {
            foreignKeyName: "settlements_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: true
            referencedRelation: "v_trading_delivery_margin"
            referencedColumns: ["delivery_id"]
          },
        ]
      }
    }
    Functions: {
      approve_cash_reconciliation: {
        Args: {
          p_approve: boolean
          p_reason?: string
          p_reconciliation_id: string
        }
        Returns: undefined
      }
      auth_user_role: { Args: never; Returns: string }
      cancel_delivery: {
        Args: { p_delivery_id: string; p_reason: string }
        Returns: undefined
      }
      cancel_handover_dispatch: {
        Args: { p_handover_id: string; p_reason: string }
        Returns: undefined
      }
      confirm_handover_receipt: {
        Args: {
          p_business_date: string
          p_handover_id: string
          p_lines: Json
          p_to_tank_id: string
        }
        Returns: undefined
      }
      create_cash_reconciliation: {
        Args: {
          p_notes?: string
          p_period_end_date: string
          p_physical_amount: number
          p_site_id: string
        }
        Returns: string
      }
      create_cash_reversal: {
        Args: { p_ledger_id: string; p_reason: string }
        Returns: string
      }
      create_company_cash_reversal: {
        Args: { p_id: string; p_reason: string }
        Returns: string
      }
      create_delivery_with_allocations: {
        Args: {
          p_allocations: Json
          p_demand_id: string
          p_override_reason?: string
          p_site_id: string
        }
        Returns: string
      }
      create_handover_dispatch: {
        Args: {
          p_client_id?: string
          p_from_site_id: string
          p_lines: Json
          p_notes?: string
          p_to_site_id: string
        }
        Returns: string
      }
      create_ledger_reversal: {
        Args: { p_ledger_id: string; p_reason: string }
        Returns: string
      }
      create_receiving_with_batch: {
        Args: {
          p_lots: Json
          p_site_id: string
          p_supplier_id: string
          p_tank_id: string
          p_transaction_date: string
        }
        Returns: {
          batch_id: string
          batch_line_id: string
          product_id: string
          receiving_lot_id: string
          receiving_transaction_id: string
        }[]
      }
      demand_allocated_kg: { Args: { p_demand_id: string }; Returns: number }
      get_available_batch_lines: {
        Args: { p_site_id: string }
        Returns: {
          age_hours: number
          balance_kg: number
          batch_line_id: string
          is_overdue: boolean
          max_holding_hours: number
          product_id: string
          product_name: string
          received_at: string
          tank_name: string
        }[]
      }
      get_budget_actuals: {
        Args: { p_period_month: string; p_track: string }
        Returns: {
          opex_actual: number
          revenue_actual: number
        }[]
      }
      get_fefo_risk_report: {
        Args: never
        Returns: {
          age_hours: number
          balance_kg: number
          batch_line_id: string
          is_overdue: boolean
          max_holding_hours: number
          product_id: string
          product_name: string
          received_at: string
          site_id: string
          site_name: string
          tank_name: string
          track: string
        }[]
      }
      get_or_create_batch: {
        Args: { p_business_date: string; p_site_id: string; p_tank_id: string }
        Returns: string
      }
      get_site_forecast: {
        Args: {
          p_forecast_days?: number
          p_history_days?: number
          p_site_id: string
        }
        Returns: {
          avg_daily_kg: number
          data_points: number
          first_received_at: string
          forecast_kg: number
          last_received_at: string
          product_id: string
          product_name: string
          total_received_kg: number
        }[]
      }
      investor_company_cash_ledger: {
        Args: never
        Returns: {
          amount: number
          category: string
          created_at: string
          created_by: string
          description: string | null
          event_at: string
          id: string
          opex_category_id: string | null
          ref_id: string | null
          ref_type: string | null
          reversal_of: string | null
          tax_type: string | null
          track: string
        }[]
        SetofOptions: {
          from: "*"
          to: "company_cash_ledger"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      investor_settlements_aging: {
        Args: never
        Returns: {
          amount: number | null
          customer_id: string | null
          customer_name: string | null
          days_until_due: number | null
          delivery_id: string | null
          due_date: string | null
          mode: Database["public"]["Enums"]["settlement_mode"] | null
          settled_at: string | null
          settlement_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "v_settlements_aging"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      investor_trading_capital_lockup: {
        Args: never
        Returns: {
          batch_line_id: string | null
          delivered_at: string | null
          delivery_allocation_id: string | null
          lockup_days: number | null
          qty_kg: number | null
          received_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "v_trading_capital_lockup"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      investor_trading_delivery_margin: {
        Args: never
        Returns: {
          actual_weight_kg: number | null
          cogs: number | null
          delivery_id: string | null
          margin: number | null
          margin_per_kg: number | null
          revenue: number | null
          site_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "v_trading_delivery_margin"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      investor_trading_dpo_inputs: {
        Args: never
        Returns: {
          buy_price_per_kg: number | null
          delivery_allocation_id: string | null
          payment_term_days: number | null
          purchase_value: number | null
          qty_kg: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "v_trading_dpo_inputs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      investor_trading_margin_by_product: {
        Args: never
        Returns: {
          cogs: number | null
          delivery_count: number | null
          margin: number | null
          margin_pct: number | null
          product_id: string | null
          product_name: string | null
          revenue: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "v_trading_margin_by_product"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      investor_trading_margin_by_segment: {
        Args: never
        Returns: {
          cogs: number | null
          delivery_count: number | null
          margin: number | null
          margin_pct: number | null
          revenue: number | null
          segment: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "v_trading_margin_by_segment"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      investor_trading_margin_mixed_summary: {
        Args: never
        Returns: {
          cogs: number | null
          delivery_count: number | null
          margin: number | null
          revenue: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "v_trading_margin_mixed_summary"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      investor_trading_receivable_cycle: {
        Args: never
        Returns: {
          created_at: string | null
          days_to_collect: number | null
          delivery_id: string | null
          due_date: string | null
          settled_at: string | null
          settlement_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "v_trading_receivable_cycle"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      ref_price: {
        Args: { p_date?: string; p_product_id: string; p_site_id: string }
        Returns: {
          price: number
          source: string
        }[]
      }
      user_can_access_site: { Args: { p_site_id: string }; Returns: boolean }
    }
    Enums: {
      movement_type:
        | "receive"
        | "mortality"
        | "shrinkage"
        | "delivery"
        | "reject"
        | "transfer_in"
        | "transfer_out"
        | "adjustment"
      settlement_mode: "cod" | "term"
      site_type: "trading" | "budidaya"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      movement_type: [
        "receive",
        "mortality",
        "shrinkage",
        "delivery",
        "reject",
        "transfer_in",
        "transfer_out",
        "adjustment",
      ],
      settlement_mode: ["cod", "term"],
      site_type: ["trading", "budidaya"],
    },
  },
} as const
