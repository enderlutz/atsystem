const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://atsystem-production.up.railway.app";

function getToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)at_auth=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function getCurrentUser(): { sub: string; name: string; role: string } | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    // Check expiry
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { headers, ...options });
  if (res.status === 401) {
    document.cookie = "at_auth=; max-age=0; path=/";
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request<{ token: string; user: { username: string; name: string; role: string } }>(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify({ username, password }) }
    ),


  // Leads
  getLeads: (params?: string) =>
    request<Lead[]>(`/api/leads${params ? `?${params}` : ""}`),
  getLead: (id: string) => request<LeadDetail>(`/api/leads/${id}`),
  checkResponse: (leadId: string) =>
    request<ResponseCheck>(`/api/leads/${leadId}/check-response`, { method: "POST" }),
  updateVANotes: (leadId: string, notes: string) =>
    request<{ status: string }>(`/api/leads/${leadId}/notes`, {
      method: "PUT",
      body: JSON.stringify({ va_notes: notes }),
    }),
  updateLeadColumn: (leadId: string, column: string | null) =>
    request<{ status: string }>(`/api/leads/${leadId}/column`, {
      method: "PUT",
      body: JSON.stringify({ kanban_column: column }),
    }),
  updateLeadTags: (leadId: string, tags: string[]) =>
    request<{ status: string }>(`/api/leads/${leadId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags }),
    }),
  updateLeadFormData: (leadId: string, formData: Record<string, string | number | boolean | string[]>) =>
    request<LeadDetail>(`/api/leads/${leadId}/form-data`, {
      method: "PUT",
      body: JSON.stringify({ form_data: formData }),
    }),
  updateLeadContact: (leadId: string, data: { contact_name?: string; contact_phone?: string; address?: string }) =>
    request<{ status: string }>(`/api/leads/${leadId}/contact`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  archiveAllLeads: () =>
    request<{ status: string; count: number }>("/api/leads/archive-all", { method: "POST" }),
  getLeadMessages: (leadId: string) =>
    request<{ messages: GHLMessage[] }>(`/api/leads/${leadId}/messages`),
  getLeadEstimates: (leadId: string) =>
    request<Estimate[]>(`/api/leads/${leadId}/estimates`),

  // Estimates
  getEstimates: (params?: string) =>
    request<Estimate[]>(`/api/estimates${params ? `?${params}` : ""}`),
  getEstimate: (id: string) => request<EstimateDetail>(`/api/estimates/${id}`),
  approveEstimate: (id: string, selectedTier = "signature", forceSend = false) =>
    request<Estimate>(`/api/estimates/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ selected_tier: selectedTier, force_send: forceSend }),
    }),
  rejectEstimate: (id: string, notes: string) =>
    request<Estimate>(`/api/estimates/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    }),
  adjustEstimate: (id: string, low: number, high: number, notes: string) =>
    request<Estimate>(`/api/estimates/${id}`, {
      method: "PUT",
      body: JSON.stringify({ estimate_low: low, estimate_high: high, owner_notes: notes }),
    }),
  adminApproveEstimate: (id: string, body: { essential?: number; signature?: number; legacy?: number; notes?: string; force_send?: boolean }) =>
    request<{ status: string; proposal_url: string }>(`/api/estimates/${id}/admin-approve`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  resendEstimate: (id: string) =>
    request<{ status: string; proposal_url: string }>(`/api/estimates/${id}/resend`, { method: "POST" }),
  getPreviewToken: (estimateId: string) =>
    request<{ token: string }>(`/api/estimates/${estimateId}/preview`, { method: "POST" }),
  markAdditionalServicesSent: (estimateId: string) =>
    request<{ status: string }>(`/api/estimates/${estimateId}/additional-services-sent`, {
      method: "POST",
    }),
  unmarkAdditionalServicesSent: (estimateId: string) =>
    request<{ status: string }>(`/api/estimates/${estimateId}/additional-services-sent`, {
      method: "DELETE",
    }),

  // Settings
  getPricing: () => request<PricingConfig[]>(`/api/settings/pricing`),
  updatePricing: (service_type: string, config: object) =>
    request<PricingConfig>(`/api/settings/pricing`, {
      method: "PUT",
      body: JSON.stringify({ service_type, config }),
    }),

  confirmAddress: (leadId: string) =>
    request<{ status: string }>(`/api/leads/${leadId}/confirm-address`, { method: "POST" }),

  // Stats
  getStats: () => request<DashboardStats>(`/api/settings/stats`),

  // GHL Sync
  syncGHL: () => request<SyncResult>("/api/sync/ghl", { method: "POST" }),
  syncPipeline: () => request<PipelineSyncResult>("/api/sync/ghl/pipeline", { method: "POST" }),
  getSyncStatus: () => request<SyncStatus>("/api/sync/status"),
  previewGHL: () => request<SyncPreview>("/api/sync/ghl/preview"),
  discoverFields: () => request<FieldDiscovery>("/api/sync/ghl/fields"),
  updateFieldMapping: (ghlFieldId: string, ourFieldName: string | null) =>
    request<{ status: string }>(`/api/sync/ghl/fields/${ghlFieldId}`, {
      method: "PUT",
      body: JSON.stringify({ our_field_name: ourFieldName }),
    }),

  // Proposals (public — customer booking)
  getProposal: (token: string) =>
    request<ProposalData>(`/api/proposal/${token}`),
  createCheckout: (token: string, data: {
    selected_tier: string;
    booked_at: string;
    contact_email?: string | null;
    backup_dates?: string[] | null;
    selected_color?: string | null;
    color_mode?: string;
    hoa_colors?: string[] | null;
    custom_color?: string | null;
  }) =>
    request<{ checkout_url: string }>(`/api/proposal/${token}/create-checkout`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  bookProposal: (token: string, data: {
    selected_tier: string;
    booked_at: string;
    contact_email?: string | null;
    backup_dates?: string[] | null;
    selected_color?: string | null;
    color_mode?: string;
    hoa_colors?: string[] | null;
    custom_color?: string | null;
    stripe_session_id?: string | null;
  }) =>
    request<{
      status: string;
      booked_at: string;
      selected_tier: string;
      booked_tier_price: number;
      color_display: string;
      backup_dates: string[];
      deposit_paid: boolean;
      address: string;
    }>(
      `/api/proposal/${token}/book`,
      { method: "POST", body: JSON.stringify(data) }
    ),

  // Schedule (public read + admin write)
  getAvailableDates: (month?: string) =>
    request<ScheduleSlot[]>(`/api/schedule${month ? `?month=${month}` : ""}`),
  getAdminSchedule: (month?: string) =>
    request<AdminScheduleSlot[]>(`/api/admin/schedule${month ? `?month=${month}` : ""}`),
  upsertScheduleSlot: (slot: Omit<AdminScheduleSlot, "booked_count">) =>
    request<{ status: string; date: string }>("/api/admin/schedule", {
      method: "POST",
      body: JSON.stringify(slot),
    }),
  deleteScheduleSlot: (date: string) =>
    request<{ status: string; date: string }>(`/api/admin/schedule/${date}`, {
      method: "DELETE",
    }),
};

// --- Types ---
export type ServiceType = "fence_staining" | "pressure_washing";
export type LeadStatus = "new" | "estimated" | "approved" | "rejected" | "sent";
export type EstimateStatus = "pending" | "approved" | "rejected" | "adjusted";

export interface Lead {
  id: string;
  ghl_contact_id: string;
  service_type: ServiceType;
  status: LeadStatus;
  address: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  priority: string;
  urgency_level: string;
  kanban_column?: string | null;
  customer_responded: boolean;
  customer_response_text: string;
  tags: string[];
  va_notes: string;
  created_at: string;
  form_data: Record<string, unknown>;
}

export interface LeadDetail extends Lead {
  estimate?: EstimateDetail;
}

export interface Estimate {
  id: string;
  lead_id: string;
  service_type: ServiceType;
  status: EstimateStatus;
  estimate_low: number;
  estimate_high: number;
  owner_notes: string | null;
  additional_services_sent: boolean;
  send_count: number;
  created_at: string;
  approved_at: string | null;
  lead?: Lead;
  inputs?: Record<string, unknown>;
}

export interface EstimateDetail extends Estimate {
  inputs: Record<string, string | number | boolean>;
  breakdown: BreakdownItem[];
  proposal_token?: string;
}

export interface BreakdownItem {
  label: string;
  value: number;
  note?: string;
}

export interface PricingConfig {
  service_type: ServiceType;
  config: Record<string, unknown>;
  updated_at: string;
}

export interface DashboardStats {
  pending_estimates: number;
  leads_this_week: number;
  approved_this_month: number;
  revenue_estimate_this_month: number;
  hot_leads: number;
}

export interface SyncResult {
  status: string;
  total_fetched: number;
  imported: number;
  skipped_duplicate: number;
  skipped_no_fields: number;
  errors: number;
}

export interface SyncPreview {
  status: string;
  total_contacts: number;
  with_form_fields: number;
  sample_names: string[];
}

export interface FieldDiscovery {
  status: string;
  total_fields: number;
  fields: FieldMapping[];
  auto_mapped: number;
}

export interface FieldMapping {
  ghl_field_id: string;
  ghl_field_key: string;
  ghl_field_name: string;
  our_field_name: string | null;
}

export interface ResponseCheck {
  responded: boolean;
  message_count: number;
  latest?: string;
}

export interface GHLMessage {
  direction: "inbound" | "outbound";
  body: string;
  dateAdded: string;
  messageType?: string;
}

export interface PipelineSyncResult {
  status: string;
  pipeline: string;
  stages_synced: string[];
  imported: number;
  updated: number;
  errors: number;
}

export interface SyncStatus {
  last_sync_at: string | null;
  status: string;
}

export interface ProposalData {
  token: string;
  status: "sent" | "viewed" | "booked" | "preview";
  customer_name: string;
  address: string;
  contact_email?: string;
  service_type?: string;
  previously_stained?: string;
  tiers?: { essential: number; signature: number; legacy: number };
  booked_at?: string;
  selected_tier?: string;
  booked_tier_price?: number;
  selected_color?: string;
  color_mode?: "gallery" | "hoa_only" | "hoa_approved" | "custom";
  hoa_colors?: string[];
  custom_color?: string;
  color_display?: string;
  backup_dates?: string[];
  deposit_paid?: boolean;
}

export interface ScheduleSlot {
  date: string;        // "2026-03-15"
  label?: string;
  spots_remaining: number;
}

export interface AdminScheduleSlot {
  date: string;
  is_available: boolean;
  label?: string;
  max_bookings: number;
  booked_count: number;
}
