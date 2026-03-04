const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

export const api = {
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
  updateLeadTags: (leadId: string, tags: string[]) =>
    request<{ status: string }>(`/api/leads/${leadId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags }),
    }),

  // Estimates
  getEstimates: (params?: string) =>
    request<Estimate[]>(`/api/estimates${params ? `?${params}` : ""}`),
  getEstimate: (id: string) => request<EstimateDetail>(`/api/estimates/${id}`),
  approveEstimate: (id: string) =>
    request<Estimate>(`/api/estimates/${id}/approve`, { method: "POST" }),
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
  markAdditionalServicesSent: (estimateId: string) =>
    request<{ status: string }>(`/api/estimates/${estimateId}/additional-services-sent`, {
      method: "POST",
    }),

  // Settings
  getPricing: () => request<PricingConfig[]>(`/api/settings/pricing`),
  updatePricing: (service_type: string, config: object) =>
    request<PricingConfig>(`/api/settings/pricing`, {
      method: "PUT",
      body: JSON.stringify({ service_type, config }),
    }),

  // Stats
  getStats: () => request<DashboardStats>(`/api/stats`),

  // GHL Sync
  syncGHL: () => request<SyncResult>("/api/sync/ghl", { method: "POST" }),
  previewGHL: () => request<SyncPreview>("/api/sync/ghl/preview"),
  discoverFields: () => request<FieldDiscovery>("/api/sync/ghl/fields"),
  updateFieldMapping: (ghlFieldId: string, ourFieldName: string | null) =>
    request<{ status: string }>(`/api/sync/ghl/fields/${ghlFieldId}`, {
      method: "PUT",
      body: JSON.stringify({ our_field_name: ourFieldName }),
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
  customer_responded: boolean;
  customer_response_text: string;
  tags: string[];
  va_notes: string;
  created_at: string;
  form_data: Record<string, string>;
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
  created_at: string;
  approved_at: string | null;
  lead?: Lead;
}

export interface EstimateDetail extends Estimate {
  inputs: Record<string, string | number | boolean>;
  breakdown: BreakdownItem[];
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
