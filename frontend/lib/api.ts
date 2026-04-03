// Use relative URLs so all requests go through the Next.js proxy (next.config.mjs → Railway).
// This eliminates CORS entirely. The proxy destination is set via NEXT_PUBLIC_API_URL at build time.
const API_URL = "";
// Direct backend URL — used for large binary uploads/downloads that exceed Vercel's 4.5MB proxy limit.
const DIRECT_API_URL = process.env.NEXT_PUBLIC_API_URL || "";

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
  getLatestLead: () =>
    request<{ id: string | null; contact_name: string | null; created_at: string | null }>("/api/leads/latest"),
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
  sendNow: (leadId: string) =>
    request<{ status: string }>(`/api/leads/${leadId}/send-now`, { method: "POST" }),
  updateLeadTags: (leadId: string, tags: string[]) =>
    request<{ status: string }>(`/api/leads/${leadId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags }),
    }),
  updateLeadFormData: (leadId: string, formData: Record<string, string | number | boolean | string[]>, estimateId?: string, label?: string) =>
    request<LeadDetail>(`/api/leads/${leadId}/form-data`, {
      method: "PUT",
      body: JSON.stringify({ form_data: formData, ...(estimateId ? { estimate_id: estimateId } : {}), ...(label !== undefined ? { label } : {}) }),
    }),
  addEstimate: (leadId: string, label: string, formData: Record<string, unknown>) =>
    request<LeadDetail>(`/api/leads/${leadId}/estimates`, {
      method: "POST",
      body: JSON.stringify({ label, form_data: formData }),
    }),
  deleteEstimate: (leadId: string, estimateId: string) =>
    request<LeadDetail>(`/api/leads/${leadId}/estimates/${estimateId}`, { method: "DELETE" }),
  updateLeadContact: (leadId: string, data: { contact_name?: string; contact_phone?: string; address?: string }) =>
    request<{ status: string }>(`/api/leads/${leadId}/contact`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  archiveLead: (leadId: string) =>
    request<{ status: string }>(`/api/leads/${leadId}/archive`, { method: "POST" }),
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
  approveEstimate: (id: string, selectedTier = "signature", forceSend = false, bypassApproval = false, bypassPassword?: string, scheduledSendAt?: string, proposalVersion?: string) =>
    request<Estimate & { scheduled_send_at?: string }>(`/api/estimates/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ selected_tier: selectedTier, force_send: forceSend, bypass_approval: bypassApproval, bypass_password: bypassPassword, ...(scheduledSendAt ? { scheduled_send_at: scheduledSendAt } : {}), ...(proposalVersion ? { proposal_version: proposalVersion } : {}) }),
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
  adminApproveEstimate: (id: string, body: { essential?: number; signature?: number; legacy?: number; notes?: string; force_send?: boolean; scheduled_send_at?: string }) =>
    request<{ status: string; proposal_url: string; scheduled_send_at?: string }>(`/api/estimates/${id}/admin-approve`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  saveCustomTiers: (id: string, body: { essential?: number; signature?: number; legacy?: number; notes?: string }) =>
    request<{ status: string; tiers: Record<string, number> }>(`/api/estimates/${id}/custom-tiers`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  requestEstimateReview: (id: string) =>
    request<{ status: string; estimate_id: string }>(`/api/estimates/${id}/request-review`, { method: "POST" }),
  notifyOwnerForApproval: (id: string) =>
    request<{ status: string; estimate_id: string }>(`/api/estimates/${id}/notify-owner`, { method: "POST" }),
  resendEstimate: (id: string) =>
    request<{ status: string; proposal_url: string }>(`/api/estimates/${id}/resend`, { method: "POST" }),
  cancelQuote: (id: string) =>
    request<{ status: string }>(`/api/estimates/${id}/cancel-quote`, { method: "POST" }),
  quickApproveEstimate: (id: string, token: string) =>
    request<{ status: string; proposal_url: string }>(`/api/estimates/${id}/quick-approve?token=${encodeURIComponent(token)}`, { method: "POST" }),
  getPreviewToken: (estimateId: string) =>
    request<{ token: string }>(`/api/estimates/${estimateId}/preview`, { method: "POST" }),
  markAdditionalServicesSent: (estimateId: string, description?: string, price?: number) =>
    request<{ status: string }>(`/api/estimates/${estimateId}/additional-services-sent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: description ?? null, price: price ?? null }),
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
    selections?: ProposalSelection[] | null;
    booked_at: string;
    contact_email?: string | null;
    backup_dates?: string[] | null;
    selected_color?: string | null;
    color_mode?: string;
    hoa_colors?: string[] | null;
    custom_color?: string | null;
    additional_request?: string | null;
  }) =>
    request<{ checkout_url: string }>(`/api/proposal/${token}/create-checkout`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateProposalStage: (token: string, stage: string) =>
    request<{ status: string }>(`/api/proposal/${token}/stage`, {
      method: "POST",
      body: JSON.stringify({ stage }),
    }),
  saveProposalSelection: (token: string, data: {
    selected_tier?: string;
    selections?: ProposalSelection[];
    color_mode?: string;
    selected_color?: string;
    hoa_colors?: string[];
    custom_color?: string;
  }) =>
    request<{ status: string }>(`/api/proposal/${token}/selection`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  reportProposalActivity: (token: string, type: "heartbeat" | "left") =>
    request<{ status: string }>(`/api/proposal/${token}/activity`, {
      method: "POST",
      body: JSON.stringify({ type }),
    }),
  bookProposal: (token: string, data: {
    selected_tier: string;
    selections?: ProposalSelection[] | null;
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
    request<AdminScheduleResponse>(`/api/admin/schedule${month ? `?month=${month}` : ""}`),
  upsertScheduleSlot: (slot: Omit<AdminScheduleSlot, "booked_count">) =>
    request<{ status: string; date: string }>("/api/admin/schedule", {
      method: "POST",
      body: JSON.stringify(slot),
    }),
  deleteScheduleSlot: (date: string) =>
    request<{ status: string; date: string }>(`/api/admin/schedule/${date}`, {
      method: "DELETE",
    }),
  getDateRequests: () =>
    request<DateRequest[]>("/api/admin/schedule/date-requests"),
  approveDateRequest: (proposalId: string) =>
    request<{ status: string; new_date: string }>(`/api/admin/schedule/date-requests/${proposalId}/approve`, { method: "POST" }),
  declineDateRequest: (proposalId: string) =>
    request<{ status: string }>(`/api/admin/schedule/date-requests/${proposalId}/decline`, { method: "POST" }),

  // Workflow automation
  getWorkflowStatus: (leadId: string) =>
    request<WorkflowStatus>(`/api/workflow/leads/${leadId}/status`),
  transitionWorkflowStage: (leadId: string, stage: string, reason?: string) =>
    request<{ status: string; new_stage: string }>(`/api/workflow/leads/${leadId}/transition`, {
      method: "POST",
      body: JSON.stringify({ stage, reason: reason || "manual_va" }),
    }),
  pauseWorkflow: (leadId: string) =>
    request<{ status: string }>(`/api/workflow/leads/${leadId}/pause`, { method: "POST" }),
  resumeWorkflow: (leadId: string) =>
    request<{ status: string }>(`/api/workflow/leads/${leadId}/resume`, { method: "POST" }),
  markJobComplete: (leadId: string) =>
    request<{ status: string }>(`/api/workflow/leads/${leadId}/job-complete`, { method: "POST" }),
  getMessageQueue: (params?: string) =>
    request<QueuedMessage[]>(`/api/workflow/queue${params ? `?${params}` : ""}`),
  cancelQueuedMessage: (messageId: string) =>
    request<{ status: string }>(`/api/workflow/queue/${messageId}/cancel`, { method: "POST" }),
  sendQueuedMessageNow: (messageId: string) =>
    request<{ status: string }>(`/api/workflow/queue/${messageId}/send-now`, { method: "POST" }),
  getWorkflowStats: () =>
    request<WorkflowStats>("/api/workflow/stats"),
  getWorkflowConfig: () =>
    request<WorkflowConfigItem[]>("/api/workflow/config"),
  updateWorkflowConfig: (key: string, value: string) =>
    request<{ status: string }>(`/api/workflow/config/${key}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),
  getWorkflowStages: () =>
    request<{ value: string; label: string }[]>("/api/workflow/stages"),
  getGhlPipelines: () =>
    request<GhlPipeline[]>("/api/workflow/ghl-pipelines"),
  saveGhlStageMap: (mapping: Record<string, string>) =>
    request<{ status: string; mapped: number }>("/api/workflow/ghl-stage-map", {
      method: "POST",
      body: JSON.stringify({ mapping }),
    }),
  askForAddress: (leadId: string) =>
    request<{ status: string; new_stage: string }>(`/api/workflow/leads/${leadId}/ask-address`, { method: "POST" }),
  triggerNewBuild: (leadId: string) =>
    request<{ status: string; new_stage: string }>(`/api/workflow/leads/${leadId}/new-build`, { method: "POST" }),
  sendDateLink: (leadId: string) =>
    request<{ status: string; new_stage: string; url: string }>(`/api/workflow/leads/${leadId}/send-date-link`, { method: "POST" }),
  // Template editing
  getStageTemplates: (stage: string, branch?: string) =>
    request<StageTemplateResponse>(`/api/workflow/templates/${stage}${branch ? `?branch=${branch}` : ""}`),
  saveStageTemplates: (stage: string, body: { branch?: string | null; messages: { delay_seconds: number; message_body: string }[] }) =>
    request<{ status: string; saved: number }>(`/api/workflow/templates/${stage}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  resetStageTemplates: (stage: string, branch?: string) =>
    request<{ status: string }>(`/api/workflow/templates/${stage}${branch ? `?branch=${branch}` : ""}`, { method: "DELETE" }),
  previewTemplate: (messageBody: string, sampleData?: Record<string, string>) =>
    request<{ rendered: string }>("/api/workflow/templates/preview", {
      method: "POST",
      body: JSON.stringify({ message_body: messageBody, sample_data: sampleData || {} }),
    }),
  testSendTemplate: (messageBody: string, opts?: { contactId?: string; stage?: string; sequenceIndex?: number; branch?: string }) =>
    request<{ status: string; rendered: string; attachments?: string[] }>("/api/workflow/templates/test-send", {
      method: "POST",
      body: JSON.stringify({ message_body: messageBody, contact_id: opts?.contactId, stage: opts?.stage, sequence_index: opts?.sequenceIndex ?? 0, branch: opts?.branch }),
    }),
  getOverriddenStages: () =>
    request<{ overridden_stages: string[] }>("/api/workflow/templates/overrides"),
  // Analytics
  getAnalyticsRevenue: (period = "30d") =>
    request<AnalyticsRevenue>(`/api/analytics/revenue?period=${period}`),
  getAnalyticsFunnel: (period = "30d") =>
    request<AnalyticsFunnel>(`/api/analytics/funnel?period=${period}`),
  getAnalyticsSpeed: (period = "30d") =>
    request<AnalyticsSpeed>(`/api/analytics/speed?period=${period}`),
  getAnalyticsEngagement: (period = "30d") =>
    request<AnalyticsEngagement>(`/api/analytics/engagement?period=${period}`),
  getAnalyticsCohorts: (cohortBy = "week") =>
    request<any>(`/api/analytics/cohorts?cohort_by=${cohortBy}`),
  getAnalyticsInsights: (period = "30d") =>
    request<any>(`/api/analytics/insights?period=${period}`),

  getAutomationLog: (params?: { lead_id?: string; event_type?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.lead_id) qs.set("lead_id", params.lead_id);
    if (params?.event_type) qs.set("event_type", params.event_type);
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    const q = qs.toString();
    return request<AutomationLogResponse>(`/api/workflow/log${q ? `?${q}` : ""}`);
  },

  getNotificationsRecent: (since?: string) =>
    request<{ events: AutomationLogEvent[]; count_since: number }>(
      `/api/notifications/recent${since ? `?since=${since}` : ""}`
    ),

  getSmsCounts: (leadIds: string[]) =>
    request<{ counts: Record<string, number> }>(
      `/api/workflow/sms-counts?lead_ids=${leadIds.join(",")}`
    ),

  // All Contacts (GHL)
  getAllContacts: () =>
    request<{ contacts: GhlContact[]; total: number; already_imported: number; last_synced_at: string | null }>("/api/contacts/all"),
  syncContacts: () =>
    request<{ status: string; total_upserted: number; marked_imported: number }>("/api/contacts/sync", { method: "POST" }),
  importContact: (contactId: string, locationId: string) =>
    request<{ status: string; lead_id: string }>(`/api/contacts/${contactId}/import?location_id=${locationId}`, { method: "POST" }),

  // PDF Templates
  uploadPdfTemplate: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${DIRECT_API_URL}/api/pdf-templates/upload`, {
      method: "POST",
      headers,
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "Upload failed");
    }
    return res.json() as Promise<PdfTemplateUploadResult>;
  },
  getPdfTemplate: () =>
    request<PdfTemplateInfo>("/api/pdf-templates/current"),
  getPdfTemplatePageUrl: (pageNum: number) =>
    `${DIRECT_API_URL}/api/pdf-templates/page/${pageNum}`,
  savePdfFieldMap: (fieldMap: Record<string, FieldPosition>) =>
    request<{ status: string }>("/api/pdf-templates/field-map", {
      method: "PUT",
      body: JSON.stringify({ field_map: fieldMap }),
    }),
  deletePdfTemplate: () =>
    request<{ status: string }>("/api/pdf-templates", { method: "DELETE" }),
  previewPdf: async () => {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${DIRECT_API_URL}/api/pdf-templates/preview`, {
      method: "POST",
      headers,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "Preview failed");
    }
    return res.blob();
  },
};

// --- Beacon helper (for sendBeacon on page unload) ---
export function getActivityBeaconUrl(token: string) {
  return `${API_URL}/api/proposal/${token}/activity`;
}

// --- PDF Template Types ---
export interface FieldPosition {
  page: number;
  x: number;
  y: number;
  font_size: number;
}

export interface PdfTemplateInfo {
  id: string;
  filename: string;
  page_count: number;
  page_widths: number[];
  page_heights: number[];
  field_map: Record<string, FieldPosition>;
  updated_at: string;
}

export interface PdfTemplateUploadResult {
  status: string;
  id: string;
  filename: string;
  page_count: number;
  page_widths: number[];
  page_heights: number[];
}

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
  workflow_stage?: string | null;
  workflow_stage_entered_at?: string | null;
  workflow_paused?: boolean;
  pending_address?: boolean;
}

export interface LeadDetail extends Lead {
  estimate?: EstimateDetail;
  estimates?: EstimateDetail[];
}

export interface Estimate {
  id: string;
  lead_id: string;
  service_type: ServiceType;
  status: EstimateStatus;
  estimate_low: number;
  estimate_high: number;
  owner_notes: string | null;
  label?: string | null;
  additional_services_sent: boolean;
  addon_description?: string | null;
  addon_price?: number | null;
  send_count: number;
  created_at: string;
  approved_at: string | null;
  lead?: Lead;
  inputs?: Record<string, unknown>;
  proposal_funnel_stage?: string;
  proposal_status?: string;
  proposal_last_active_at?: string | null;
  proposal_left_page_at?: string | null;
}

export interface EstimateDetail extends Estimate {
  inputs: Record<string, string | number | boolean>;
  breakdown: BreakdownItem[];
  proposal_token?: string;
  proposal_selected_tier?: string;
  proposal_color_mode?: string;
  proposal_selected_color?: string;
  proposal_hoa_colors?: string[];
  proposal_custom_color?: string;
  proposal_booked_at?: string;
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

export interface ProposalSection {
  estimate_id: string;
  label: string;
  tiers: { essential: number; signature: number; legacy: number };
  previously_stained?: string;
  fence_sides?: string;
  custom_fence_sides?: string;
}

export interface ProposalSelection {
  estimate_id: string;
  selected_tier: "essential" | "signature" | "legacy";
}

export interface ProposalData {
  token: string;
  status: "sent" | "viewed" | "booked" | "preview" | "cancelled";
  customer_name: string;
  address: string;
  contact_email?: string;
  service_type?: string;
  previously_stained?: string;
  tiers?: { essential: number; signature: number; legacy: number };
  sections?: ProposalSection[];
  selections?: ProposalSelection[];
  military_discount?: boolean;
  booked_at?: string;
  selected_tier?: string;
  booked_tier_price?: number;
  booked_total_price?: number;
  selected_color?: string;
  color_mode?: "gallery" | "hoa_only" | "hoa_approved" | "custom";
  hoa_colors?: string[];
  custom_color?: string;
  color_display?: string;
  backup_dates?: string[];
  deposit_paid?: boolean;
  funnel_stage?: string;
  fence_sides?: string;
  custom_fence_sides?: string;
}

export interface ScheduleSlot {
  date: string;        // "2026-03-15"
  label?: string;
  spots_remaining: number;
}

export interface ScheduleBooking {
  customer_name: string;
  contact_phone: string;
  selected_tier: string;
  tier_price: number;
  booked_at: string;
  color_display?: string | null;
  hoa_label?: string | null;
  linear_feet?: string | number | null;
  fence_height?: string | number | null;
}

export interface AdminScheduleSlot {
  date: string;
  is_available: boolean;
  label?: string;
  max_bookings: number;
  booked_count: number;
  bookings?: ScheduleBooking[];
}

export interface CalendarEvent {
  date: string;
  summary: string;
  start_time: string | null;
}

export interface AdminScheduleResponse {
  slots: AdminScheduleSlot[];
  calendar_blocked: CalendarEvent[];
}

export interface DateRequest {
  proposal_id: string;
  customer_name: string;
  contact_phone: string;
  address: string;
  booked_at: string;        // YYYY-MM-DD — confirmed primary date
  requested_date: string;   // YYYY-MM-DD — alternate date customer wants
  selected_tier: string;
  tier_price: number;
  color_display?: string | null;
  hoa_label?: string | null;
  linear_feet?: string | number | null;
  fence_height?: string | number | null;
}

// --- Workflow Types ---
export interface WorkflowStatus {
  lead_id: string;
  current_stage: string | null;
  stage_label: string | null;
  stage_entered_at: string | null;
  paused: boolean;
  pending_messages: WorkflowPendingMessage[];
  message_history: WorkflowMessageHistory[];
}

export interface WorkflowPendingMessage {
  id: string;
  stage: string;
  sequence_index: number;
  message_body: string;
  send_at: string;
}

export interface WorkflowMessageHistory {
  id: string;
  stage: string;
  message_body: string;
  send_at: string;
  sent_at: string | null;
  status: string;
  cancel_reason: string | null;
}

export interface QueuedMessage {
  id: string;
  lead_id: string;
  stage: string;
  sequence_index: number;
  message_body: string;
  send_at: string;
  sent_at: string | null;
  status: string;
  ghl_contact_id: string;
  contact_name?: string;
  error_message?: string;
}

export interface WorkflowStats {
  stage_counts: Record<string, number>;
  stage_labels: Record<string, string>;
  pending_messages: number;
  sent_today: number;
  paused_leads: number;
}

export interface WorkflowConfigItem {
  key: string;
  value: string;
  updated_at: string;
}

export interface AutomationLogEvent {
  id: string;
  lead_id: string;
  event_type: string;
  detail: string;
  metadata: Record<string, unknown>;
  created_at: string;
  contact_name: string;
}

export interface AutomationLogResponse {
  events: AutomationLogEvent[];
  total: number;
}

export interface GhlPipelineStage {
  id: string;
  name: string;
}

export interface GhlPipeline {
  id: string;
  name: string;
  stages: GhlPipelineStage[];
}

export interface GhlContact {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  location_id: string;
  location_label: string;
}

export interface StageTemplateMessage {
  sequence_index: number;
  delay_seconds: number;
  message_body: string;
}

export interface StageTemplateResponse {
  stage: string;
  branch: string | null;
  is_overridden: boolean;
  messages: StageTemplateMessage[];
}

// --- Analytics Types ---
export interface AnalyticsRevenue {
  total_revenue: number;
  total_bookings: number;
  avg_deal_value: number;
  current_month_revenue: number;
  previous_month_revenue: number;
  month_change_pct: number;
  projected_month_revenue: number;
  revenue_trend: { period: string; revenue: number; bookings: number; avg_deal: number }[];
  tier_distribution: { tier: string; count: number; revenue: number }[];
  top_zip_codes: { zip_code: string; bookings: number; revenue: number }[];
}

export interface AnalyticsFunnel {
  funnel_stages: { stage: string; count: number }[];
  overall_conversion_rate: number;
  biggest_dropoff: { from: string; to: string; drop_pct: number } | null;
  conversion_trend: { week: string; leads: number; booked: number; rate: number }[];
}

export interface AnalyticsSpeed {
  avg_hours_to_estimate: number | null;
  avg_hours_to_booking: number | null;
  avg_days_lead_to_booking: number | null;
  stage_dwell_times: { stage: string; label: string; avg_hours: number; count: number }[];
  current_bottlenecks: { stage: string; label: string; count: number; avg_days_stuck: number }[];
  speed_trend: { week: string; avg_days: number }[];
}

export interface AnalyticsEngagement {
  sms_stats: { sent: number; failed: number; cancelled: number; pending: number };
  delivery_rate: number;
  stage_response_rates: { stage: string; label: string; messaged: number; responded: number; rate: number }[];
  overall_response_rate: number;
  message_volume: { day: string; sent: number; failed: number }[];
  schedule_capacity: { date: string; max_bookings: number; booked: number }[];
}

// Module-level cache for prefetched lead detail data — persists across client-side navigations
export const leadDetailCache = new Map<string, LeadDetail>();
