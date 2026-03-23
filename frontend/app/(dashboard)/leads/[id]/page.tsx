"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, leadDetailCache, getCurrentUser, type LeadDetail, type GHLMessage, type Estimate, type WorkflowStatus } from "@/lib/api";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, MapPin, ExternalLink, Phone, Mail, User,
  CheckCircle2, MessageSquare, Tag, Calculator, RefreshCw,
  Send, AlertTriangle, History, Zap, Pause, Play, Clock,
} from "lucide-react";

const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";

const FENCE_HEIGHT_OPTIONS = [
  "6ft standard",
  "6.5ft standard with rot board",
  "7ft",
  "8ft",
  "Not sure",
];

const FENCE_AGE_OPTIONS = [
  "Brand new (less than 6 months)",
  "1-6 years",
  "6-15 years",
  "Older than 15 years / Not sure",
];

const TIMELINE_OPTIONS = [
  "As soon as possible",
  "Within 2 weeks",
  "Sometime this month",
  "Just planning ahead",
];

const TIER_CONFIG = [
  { key: "essential", label: "Essential" },
  { key: "signature", label: "Signature" },
  { key: "legacy", label: "Legacy" },
];

const CONFIDENCE_OPTIONS = [
  { label: "I'm confident", value: "100" },
  { label: "Somewhat confident", value: "80" },
  { label: "I'm not confident", value: "60" },
];

const FENCE_SIDES = {
  Inside: ["Inside Front", "Inside Left", "Inside Back", "Inside Right"],
  Outside: ["Outside Front", "Outside Left", "Outside Back", "Outside Right"],
};

const APPROVAL_CONFIG = {
  green: { label: "Ready to Send", classes: "bg-green-50 border-green-300 text-green-800", dot: "bg-green-500" },
  yellow: { label: "Add-ons Pending", classes: "bg-yellow-50 border-yellow-300 text-yellow-800", dot: "bg-yellow-500" },
  red: { label: "Owner Review Required", classes: "bg-red-50 border-red-300 text-red-800", dot: "bg-red-500" },
} as const;

const selectCls = "w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring";

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [vaNotes, setVaNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [checkingResponse, setCheckingResponse] = useState(false);

  // Estimate inputs state
  const [linearFeet, setLinearFeet] = useState("");
  const [fenceHeight, setFenceHeight] = useState("6ft standard");
  const [fenceAge, setFenceAge] = useState("1-6 years");
  const [previouslyStained, setPreviouslyStained] = useState("No");
  const [timeline, setTimeline] = useState("");
  const [additionalServices, setAdditionalServices] = useState("");
  const [editingAdditionalServices, setEditingAdditionalServices] = useState(false);
  const [zipCode, setZipCode] = useState("");

  // Contact info editable state
  const [editingContact, setEditingContact] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactAddress, setContactAddress] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const [confidencePct, setConfidencePct] = useState("100");
  const [fenceSides, setFenceSides] = useState<string[]>([]);
  const [customFenceSides, setCustomFenceSides] = useState("");
  const [showCustomFenceSides, setShowCustomFenceSides] = useState(false);
  const [savingEstimate, setSavingEstimate] = useState(false);
  const [estimateSaved, setEstimateSaved] = useState(false);
  const [additionalServicesSent, setAdditionalServicesSent] = useState(false);
  const [markingAddons, setMarkingAddons] = useState(false);

  // Role detection
  const isAdmin = getCurrentUser()?.role === "admin";

  // Admin inline actions for RED estimates
  const [adminMode, setAdminMode] = useState<"view" | "custom" | "reject">("view");
  const [adminCustomEssential, setAdminCustomEssential] = useState("");
  const [adminCustomSignature, setAdminCustomSignature] = useState("");
  const [adminCustomLegacy, setAdminCustomLegacy] = useState("");
  const [adminNotes, setAdminNotes] = useState("");

  // Inline approve state
  const [approvingEstimate, setApprovingEstimate] = useState(false);
  const [estimateSent, setEstimateSent] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [forceSend, setForceSend] = useState(false);
  const [requestingReview, setRequestingReview] = useState(false);
  const [reviewRequested, setReviewRequested] = useState(false);
  const [notifyingOwner, setNotifyingOwner] = useState(false);
  const [ownerNotified, setOwnerNotified] = useState(false);
  const [bypassApproval, setBypassApproval] = useState(false);
  const [bypassPassword, setBypassPassword] = useState("");
  const [bypassError, setBypassError] = useState<string | null>(null);

  // GHL Messages state
  const [messages, setMessages] = useState<GHLMessage[]>([]);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  // Estimate history state
  const [estimateHistory, setEstimateHistory] = useState<Estimate[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Address confirmation state
  const [confirmingAddress, setConfirmingAddress] = useState(false);
  const [addressConfirmed, setAddressConfirmed] = useState(false);

  // Workflow shortcut buttons state
  const [askingAddress, setAskingAddress] = useState(false);
  const [addressAsked, setAddressAsked] = useState(false);
  const [triggeringNewBuild, setTriggeringNewBuild] = useState(false);
  const [newBuildTriggered, setNewBuildTriggered] = useState(false);
  const [sendingDateLink, setSendingDateLink] = useState(false);
  const [dateLinkSent, setDateLinkSent] = useState(false);

  // Estimate preview modal
  const [showPreview, setShowPreview] = useState(false);
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    const applyData = (data: LeadDetail) => {
      leadDetailCache.set(id, data); // Keep cache fresh
      setLead(data);
      setVaNotes(data.va_notes || "");
      const fd = data.form_data || {};
      setLinearFeet(String(fd.linear_feet || ""));
      setFenceHeight(String(fd.fence_height || "6ft standard"));
      setFenceAge(String(fd.fence_age || "1-6 years"));
      setPreviouslyStained(String(fd.previously_stained || "No"));
      setTimeline(String(fd.service_timeline || fd.timeframe || ""));
      setAdditionalServices(String(fd.additional_services || ""));
      // Fallback: extract zip from address for leads predating the form_data fix
      const addressZip = (data.address || "").match(/\b(\d{5})\b/)?.[1] || "";
      setZipCode(String(fd.zip_code || addressZip || ""));
      const storedPct = Number(fd.confident_pct ?? 100);
      setConfidencePct(storedPct >= 90 ? "100" : storedPct >= 75 ? "80" : "60");
      const rawSides = fd.fence_sides;
      if (Array.isArray(rawSides)) setFenceSides(rawSides);
      else if (typeof rawSides === "string" && rawSides) setFenceSides(rawSides.split(",").map((s: string) => s.trim()));
      else setFenceSides([]);
      if (fd.custom_fence_sides) {
        setCustomFenceSides(String(fd.custom_fence_sides));
        setShowCustomFenceSides(true);
      }
      setAdditionalServicesSent(data.estimate?.additional_services_sent ?? false);
      // Pre-fill admin custom tier inputs from existing tiers
      const t = data.estimate?.inputs?._tiers as Record<string, number> | undefined;
      if (t?.essential) setAdminCustomEssential(String(t.essential));
      if (t?.signature) setAdminCustomSignature(String(t.signature));
      if (t?.legacy) setAdminCustomLegacy(String(t.legacy));
      if (data.estimate?.inputs?._owner_notified) {
        setOwnerNotified(true);
      }
      if (data.status === "sent" || data.estimate?.status === "approved") {
        setEstimateSent(true);
      }
      setContactName(data.contact_name || "");
      setContactPhone(data.contact_phone || "");
      setContactAddress(data.address || "");
    };

    // If prefetched, show instantly — then refresh in background
    const cached = leadDetailCache.get(id);
    if (cached) {
      applyData(cached);
      setLoading(false);
    }

    api.getLead(id).then(applyData).catch(console.error).finally(() => {
      setLoading(false);
      // Load messages after lead renders — avoids competing with the main render request
      api.getLeadMessages(id).then((result) => {
        setMessages(result.messages || []);
        setMessagesLoaded(true);
      }).catch(() => {
        setMessagesLoaded(true);
      });
    });
  }, [id]);

  const toggleFenceSide = (side: string) => {
    setFenceSides((prev) =>
      prev.includes(side) ? prev.filter((s) => s !== side) : [...prev, side]
    );
  };

  const handleLoadHistory = async () => {
    if (!lead) return;
    setLoadingHistory(true);
    try {
      const all = await api.getLeadEstimates(lead.id);
      // Exclude the current active estimate from history
      setEstimateHistory(all.filter((e) => e.id !== lead.estimate?.id));
      setHistoryLoaded(true);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleLoadMessages = async (refresh = false) => {
    if (!lead) return;
    if (messagesLoaded && !refresh) return;
    setLoadingMessages(true);
    setMessagesError(null);
    try {
      const result = await api.getLeadMessages(lead.id);
      setMessages(result.messages || []);
      setMessagesLoaded(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load messages";
      setMessagesError(msg);
      setMessagesLoaded(true);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleCheckResponse = async () => {
    if (!lead) return;
    setCheckingResponse(true);
    try {
      const result = await api.checkResponse(lead.id);
      if (result.responded) {
        setLead({ ...lead, customer_responded: true, customer_response_text: result.latest || "" });
      }
      // Always refresh messages after checking
      const msgResult = await api.getLeadMessages(lead.id);
      setMessages(msgResult.messages || []);
      setMessagesLoaded(true);
    } catch (e) {
      console.error(e);
    }
    setCheckingResponse(false);
  };

  const handleApproveEstimate = async () => {
    if (!lead?.estimate) return;
    setApprovingEstimate(true);
    setApproveError(null);
    try {
      await api.approveEstimate(lead.estimate.id, "signature", forceSend);
      setEstimateSent(true);
      setLead({ ...lead, status: "sent" });
    } catch (e: unknown) {
      setApproveError(e instanceof Error ? e.message : "Failed to send estimate");
    } finally {
      setApprovingEstimate(false);
    }
  };

  const handleRequestReview = async () => {
    if (!lead?.estimate) return;
    setRequestingReview(true);
    try {
      await api.requestEstimateReview(lead.estimate.id);
      setReviewRequested(true);
    } catch (e: unknown) {
      setApproveError(e instanceof Error ? e.message : "Failed to flag for review");
    } finally {
      setRequestingReview(false);
    }
  };

  const handleNotifyOwner = async () => {
    if (!lead?.estimate) return;
    setNotifyingOwner(true);
    setApproveError(null);
    try {
      await api.notifyOwnerForApproval(lead.estimate.id);
      setOwnerNotified(true);
    } catch (e: unknown) {
      setApproveError(e instanceof Error ? e.message : "Failed to notify Alan");
    } finally {
      setNotifyingOwner(false);
    }
  };

  const handleBypassApprove = async () => {
    if (!lead?.estimate || !bypassPassword) return;
    setApprovingEstimate(true);
    setApproveError(null);
    setBypassError(null);
    try {
      await api.approveEstimate(lead.estimate.id, "signature", forceSend, true, bypassPassword);
      setEstimateSent(true);
      setLead({ ...lead, status: "sent" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to send estimate";
      if (msg.toLowerCase().includes("password") || msg.toLowerCase().includes("bypass denied")) {
        setBypassError(msg);
      } else {
        setApproveError(msg);
      }
    } finally {
      setApprovingEstimate(false);
    }
  };

  const handleAdminApprove = async () => {
    if (!est?.id) return;
    setApprovingEstimate(true);
    setApproveError(null);
    try {
      await api.adminApproveEstimate(est.id, { force_send: forceSend });
      setEstimateSent(true);
    } catch (e: unknown) {
      setApproveError(e instanceof Error ? e.message : "Failed to approve");
    } finally {
      setApprovingEstimate(false);
    }
  };

  const handleAdminCustomApprove = async () => {
    if (!est?.id) return;
    setApprovingEstimate(true);
    setApproveError(null);
    try {
      const essential = adminCustomEssential ? Number(adminCustomEssential) : undefined;
      const signature = adminCustomSignature ? Number(adminCustomSignature) : undefined;
      const legacy = adminCustomLegacy ? Number(adminCustomLegacy) : undefined;
      await api.adminApproveEstimate(est.id, { essential, signature, legacy, notes: adminNotes || undefined, force_send: forceSend });
      setEstimateSent(true);
      setAdminMode("view");
    } catch (e: unknown) {
      setApproveError(e instanceof Error ? e.message : "Failed to approve with custom pricing");
    } finally {
      setApprovingEstimate(false);
    }
  };

  const handleAdminSaveCustomTiers = async () => {
    if (!est?.id) return;
    setApprovingEstimate(true);
    setApproveError(null);
    try {
      const essential = adminCustomEssential ? Number(adminCustomEssential) : undefined;
      const signature = adminCustomSignature ? Number(adminCustomSignature) : undefined;
      const legacy = adminCustomLegacy ? Number(adminCustomLegacy) : undefined;
      const result = await api.saveCustomTiers(est.id, { essential, signature, legacy, notes: adminNotes || undefined });
      // Refresh lead data to get updated tiers
      const refreshed = await api.getLead(lead!.id);
      leadDetailCache.set(id, refreshed);
      setLead(refreshed);
      setAdminMode("view");
    } catch (e: unknown) {
      setApproveError(e instanceof Error ? e.message : "Failed to save custom prices");
    } finally {
      setApprovingEstimate(false);
    }
  };

  const handleAdminReject = async () => {
    if (!est?.id) return;
    setApprovingEstimate(true);
    setApproveError(null);
    try {
      await api.rejectEstimate(est.id, adminNotes || "");
      if (lead) setLead({ ...lead, status: "rejected" });
      setAdminMode("view");
    } catch (e: unknown) {
      setApproveError(e instanceof Error ? e.message : "Failed to reject");
    } finally {
      setApprovingEstimate(false);
    }
  };

  const handleAskForAddress = async () => {
    if (!lead) return;
    setAskingAddress(true);
    try {
      await api.askForAddress(lead.id);
      setAddressAsked(true);
    } catch (e) {
      console.error(e);
    } finally {
      setAskingAddress(false);
    }
  };

  const handleNewBuild = async () => {
    if (!lead) return;
    setTriggeringNewBuild(true);
    try {
      await api.triggerNewBuild(lead.id);
      setNewBuildTriggered(true);
    } catch (e) {
      console.error(e);
    } finally {
      setTriggeringNewBuild(false);
    }
  };

  const handleSendDateLink = async () => {
    if (!lead) return;
    setSendingDateLink(true);
    try {
      await api.sendDateLink(lead.id);
      setDateLinkSent(true);
    } catch (e) {
      console.error(e);
    } finally {
      setSendingDateLink(false);
    }
  };

  const handleConfirmAddress = async () => {
    if (!lead) return;
    setConfirmingAddress(true);
    try {
      await api.confirmAddress(lead.id);
      setAddressConfirmed(true);
      setLead({
        ...lead,
        form_data: { ...lead.form_data, address_confirmed: true },
      });
    } catch (e) {
      console.error(e);
    } finally {
      setConfirmingAddress(false);
    }
  };

  const handleMarkAddonsSent = async () => {
    if (!lead?.estimate) return;
    setMarkingAddons(true);
    try {
      await api.markAdditionalServicesSent(lead.estimate.id);
      setAdditionalServicesSent(true);
    } catch (e) {
      console.error(e);
    } finally {
      setMarkingAddons(false);
    }
  };

  const handleUnmarkAddonsSent = async () => {
    if (!lead?.estimate) return;
    setMarkingAddons(true);
    try {
      await api.unmarkAdditionalServicesSent(lead.estimate.id);
      setAdditionalServicesSent(false);
    } catch (e) {
      console.error(e);
    } finally {
      setMarkingAddons(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!lead) return;
    setSavingNotes(true);
    try {
      await api.updateVANotes(lead.id, vaNotes);
      setLead({ ...lead, va_notes: vaNotes });
    } catch (e) {
      console.error(e);
    }
    setSavingNotes(false);
  };

  const handleSaveEstimateInputs = async () => {
    if (!lead) return;
    setSavingEstimate(true);
    try {
      const formData: Record<string, string | number | boolean | string[]> = {
        fence_height: fenceHeight,
        fence_age: fenceAge,
        previously_stained: previouslyStained,
        additional_services: additionalServices,
        fence_sides: fenceSides,
        confident_pct: Number(confidencePct) || 100,
      };
      if (linearFeet) formData.linear_feet = Number(linearFeet);
      if (timeline) formData.service_timeline = timeline;
      if (zipCode) formData.zip_code = zipCode;
      if (customFenceSides.trim()) formData.custom_fence_sides = customFenceSides.trim();
      else formData.custom_fence_sides = "";

      const updated = await api.updateLeadFormData(lead.id, formData);
      setLead(updated);
      setEstimateSent(false); // Reset sent state after recalculation
      setApproveError(null);
      setEstimateSaved(true);
      setTimeout(() => setEstimateSaved(false), 3000);
    } catch (e) {
      console.error(e);
    }
    setSavingEstimate(false);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!lead) {
    return <p className="text-muted-foreground">Lead not found.</p>;
  }

  const mapsEmbedUrl = GOOGLE_MAPS_KEY
    ? `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_KEY}&q=${encodeURIComponent(lead.address)}&zoom=19&maptype=satellite`
    : null;

  const mapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.address)}`;

  const est = lead.estimate;
  const approvalStatus = (est?.inputs?._approval_status as string) || "";
  const approvalReason = (est?.inputs?._approval_reason as string) || "";
  const approvalCfg = APPROVAL_CONFIG[approvalStatus as keyof typeof APPROVAL_CONFIG];
  const canApproveInline = (approvalStatus === "green" || approvalStatus === "yellow") && est?.status === "pending";
  const isRed = approvalStatus === "red";
  const tiers = est?.inputs?._tiers as Record<string, number> | undefined;

  const inboundMessages = messages.filter((m) => m.direction === "inbound");
  const customerRespondedFromMessages = inboundMessages.length > 0;
  const addressAutocompleted = Boolean(lead.form_data?.address_autocompleted);
  const addressConfirmedInForm = Boolean(lead.form_data?.address_confirmed);
  const hasOriginalAddress = Boolean(lead.form_data?.original_address);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/leads">
            <ArrowLeft className="h-4 w-4 mr-1" /> Leads
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{contactName || contactAddress || lead.id.slice(0, 8)}</h1>
          <p className="text-muted-foreground text-sm">Lead #{lead.id.slice(0, 8)} · {formatDate(lead.created_at)}</p>
        </div>
      </div>

      {/* Address Autocomplete Warning Banner */}
      {addressAutocompleted && !addressConfirmedInForm && !addressConfirmed && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">Address was auto-completed — please confirm with the customer</p>
            {hasOriginalAddress && (
              <p className="text-xs text-amber-700">
                <span className="font-medium">Customer entered:</span> {String(lead.form_data.original_address)}
              </p>
            )}
            <p className="text-xs text-amber-700">
              <span className="font-medium">Auto-completed to:</span> {lead.address}
            </p>
          </div>
          <Button
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
            disabled={confirmingAddress}
            onClick={handleConfirmAddress}
          >
            {confirmingAddress ? "Confirming..." : "Confirm Address"}
          </Button>
        </div>
      )}

      {/* Contact Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4" /> Contact Info
            </CardTitle>
            {!editingContact ? (
              <Button size="sm" variant="outline" onClick={() => setEditingContact(true)}>
                Edit
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={savingContact}
                  onClick={async () => {
                    setSavingContact(true);
                    try {
                      await api.updateLeadContact(lead.id, {
                        contact_name: contactName,
                        contact_phone: contactPhone,
                        address: contactAddress,
                      });
                      setLead({ ...lead, contact_name: contactName, contact_phone: contactPhone, address: contactAddress });
                      setEditingContact(false);
                    } catch (e) {
                      console.error(e);
                    }
                    setSavingContact(false);
                  }}
                >
                  {savingContact ? "Saving..." : "Save"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => {
                  setContactName(lead.contact_name || "");
                  setContactPhone(lead.contact_phone || "");
                  setContactAddress(lead.address || "");
                  setEditingContact(false);
                }}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {editingContact ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Name</label>
                <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Full name" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Phone</label>
                <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Phone number" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Address</label>
                <Input value={contactAddress} onChange={(e) => setContactAddress(e.target.value)} placeholder="Street address" />
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-6">
              {contactName && (
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{contactName}</span>
                </div>
              )}
              {contactPhone && (
                <a href={`tel:${contactPhone}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                  <Phone className="h-4 w-4" />
                  {contactPhone}
                </a>
              )}
              {lead.contact_email && (
                <a href={`mailto:${lead.contact_email}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                  <Mail className="h-4 w-4" />
                  {lead.contact_email}
                </a>
              )}
              {contactAddress && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{contactAddress}</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Lead Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lead Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Service</span>
              <span className="font-medium capitalize">{lead.service_type.replace("_", " ")}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Status</span>
              <Badge>{lead.status}</Badge>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Priority</span>
              <span className="font-medium">{lead.priority}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">GHL Contact</span>
              <span className="font-mono text-xs">{lead.ghl_contact_id}</span>
            </div>
            {lead.tags && lead.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {lead.tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
                    <Tag className="h-3 w-3" /> {tag}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Google Maps */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Property View
              </CardTitle>
              <Button size="sm" variant="outline" asChild>
                <a href={mapsLink} target="_blank" rel="noopener noreferrer">
                  Open Maps <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {mapsEmbedUrl ? (
              <iframe
                src={mapsEmbedUrl}
                className="w-full h-64 rounded-b-lg"
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            ) : (
              <div className="h-64 flex flex-col items-center justify-center gap-3 bg-muted/30 rounded-b-lg">
                <MapPin className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground text-center px-4">
                  Add a Google Maps API key in settings to see satellite view
                </p>
                <Button size="sm" asChild>
                  <a href={mapsLink} target="_blank" rel="noopener noreferrer">
                    Open in Google Maps <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* GHL Messages — shown BEFORE estimate result so VA has context */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Messages
              {(lead.customer_responded || customerRespondedFromMessages) && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                  <CheckCircle2 className="h-3 w-3" /> Customer replied
                </span>
              )}
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => handleLoadMessages(true)} disabled={loadingMessages}>
                <RefreshCw className={`h-3.5 w-3.5 ${loadingMessages ? "animate-spin" : ""}`} />
              </Button>
              <Button size="sm" variant="outline" onClick={handleCheckResponse} disabled={checkingResponse}>
                {checkingResponse ? "Checking..." : "Check for Response"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!messagesLoaded ? (
            <p className="text-sm text-muted-foreground">Loading messages…</p>
          ) : messagesError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <p className="font-semibold mb-1">Could not load messages</p>
              <p className="text-xs opacity-80">{messagesError}</p>
            </div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages yet for this contact.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-xs lg:max-w-sm px-3 py-2 rounded-2xl text-sm ${
                    msg.direction === "outbound"
                      ? "bg-blue-600 text-white rounded-br-none"
                      : "bg-muted text-foreground rounded-bl-none"
                  }`}>
                    <p>{msg.body}</p>
                    {msg.dateAdded && (
                      <p className={`text-xs mt-1 ${msg.direction === "outbound" ? "text-blue-200" : "text-muted-foreground"}`}>
                        {new Date(msg.dateAdded).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Estimate Inputs — VA fills this in */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calculator className="h-4 w-4" /> Estimate Inputs
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Fill in fence details to generate or update the estimate. Measure linear feet from the satellite map above.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Linear Feet</label>
              <Input
                type="number"
                placeholder="e.g. 120"
                value={linearFeet}
                onChange={(e) => setLinearFeet(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Measure from satellite map</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Zip Code</label>
              <Input
                type="text"
                placeholder="e.g. 77433"
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
                maxLength={5}
              />
              <p className="text-xs text-muted-foreground">Determines pricing zone</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Measurement Confidence</label>
              <select className={selectCls} value={confidencePct} onChange={(e) => setConfidencePct(e.target.value)}>
                {CONFIDENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">"Not confident" → Owner review</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Fence Height</label>
              <select className={selectCls} value={fenceHeight} onChange={(e) => setFenceHeight(e.target.value)}>
                {FENCE_HEIGHT_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Fence Age</label>
              <select className={selectCls} value={fenceAge} onChange={(e) => setFenceAge(e.target.value)}>
                {FENCE_AGE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Previously Stained</label>
              <select className={selectCls} value={previouslyStained} onChange={(e) => setPreviouslyStained(e.target.value)}>
                <option>No</option>
                <option>Yes</option>
                <option>Not sure</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Service Timeline</label>
              <select className={selectCls} value={timeline} onChange={(e) => setTimeline(e.target.value)}>
                <option value="">— select —</option>
                {TIMELINE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>

          {/* Sides of Fence */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Sides of Fence
              {fenceSides.length > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  ({fenceSides.length} selected)
                </span>
              )}
            </label>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border p-3 bg-muted/20">
              {Object.entries(FENCE_SIDES).map(([group, sides]) => (
                <div key={group}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{group}</p>
                  <div className="space-y-1">
                    {sides.map((side) => (
                      <label key={side} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded"
                          checked={fenceSides.includes(side)}
                          onChange={() => toggleFenceSide(side)}
                        />
                        {side}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none mt-2">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded"
                checked={showCustomFenceSides}
                onChange={(e) => {
                  setShowCustomFenceSides(e.target.checked);
                  if (!e.target.checked) setCustomFenceSides("");
                }}
              />
              Custom fence input
            </label>
            {showCustomFenceSides && (
              <Input
                placeholder="e.g. Outside fence facing Highway 66, Outside fence facing Highway 56"
                value={customFenceSides}
                onChange={(e) => setCustomFenceSides(e.target.value)}
                className="mt-1"
              />
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Additional Services</label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-3 w-3 rounded"
                  checked={editingAdditionalServices}
                  onChange={(e) => setEditingAdditionalServices(e.target.checked)}
                />
                Edit
              </label>
            </div>
            {editingAdditionalServices ? (
              <Input
                placeholder="e.g. gate painting, pressure washing (leave blank if none)"
                value={additionalServices}
                onChange={(e) => setAdditionalServices(e.target.value)}
              />
            ) : (
              <div className="w-full border border-input rounded-md px-3 py-2 text-sm bg-muted/40 text-muted-foreground min-h-[36px]">
                {additionalServices || <span className="italic">None (from GHL lead form)</span>}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Auto-populated from the customer's GHL form. Check "Edit" to override.</p>
          </div>

          {/* Workflow address shortcut buttons */}
          <div className="flex gap-2 flex-wrap pt-1 border-t">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handleAskForAddress}
              disabled={askingAddress || addressAsked}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {addressAsked ? "Address Request Sent ✓" : askingAddress ? "Sending..." : "Ask for Address"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handleNewBuild}
              disabled={triggeringNewBuild || newBuildTriggered}
            >
              <MapPin className="h-3.5 w-3.5" />
              {newBuildTriggered ? "New Build SMS Sent ✓" : triggeringNewBuild ? "Sending..." : "New Build – Can't Measure"}
            </Button>
          </div>

          <Button
            onClick={handleSaveEstimateInputs}
            disabled={savingEstimate}
            className={`gap-2 ${estimateSaved ? "bg-green-600 hover:bg-green-600" : ""}`}
          >
            <RefreshCw className={`h-4 w-4 ${savingEstimate ? "animate-spin" : ""}`} />
            {savingEstimate ? "Recalculating..." : estimateSaved ? "Saved ✓" : "Save & Recalculate Estimate"}
          </Button>
        </CardContent>
      </Card>

      {/* Estimate Result */}
      {est && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Estimate</CardTitle>
              <Badge variant={
                est.status === "approved" ? "success" :
                est.status === "rejected" ? "destructive" : "pending"
              }>
                {estimateSent ? "sent" : est.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {approvalCfg && (
              <div className={`flex items-start gap-3 border rounded-lg px-3 py-2 ${approvalCfg.classes}`}>
                <span className={`mt-0.5 h-2.5 w-2.5 rounded-full flex-shrink-0 ${approvalCfg.dot}`} />
                <div>
                  <p className="font-semibold text-sm">{approvalCfg.label}</p>
                  {approvalReason && <p className="text-xs mt-0.5 opacity-80">{approvalReason}</p>}
                  {isRed && (
                    <p className="text-xs mt-1 opacity-70">
                      {isAdmin
                        ? "This estimate requires your approval before sending."
                        : "You can notify Alan for approval or bypass and send with password confirmation."}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Tier price cards — display only, all 3 are sent together */}
            {tiers ? (
              <div className="grid grid-cols-3 gap-2">
                {TIER_CONFIG.map(({ key, label }) => {
                  const price = tiers[key];
                  return (
                    <div key={key} className="rounded-lg border-2 border-border p-3 text-left">
                      <p className="text-xs font-medium text-muted-foreground">{label}</p>
                      <p className="text-lg font-bold mt-0.5">
                        {price ? `$${Number(price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                      </p>
                      {price ? (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          ${(Number(price) / 21).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-3xl font-bold">
                {est.estimate_low > 0 ? formatCurrency(est.estimate_low) : "—"}
              </p>
            )}

            {est.status === "pending" && est.owner_notes && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Custom prices saved — not yet sent to customer
              </p>
            )}

            {/* Preview Estimate + quick actions */}
            {tiers && (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={async () => {
                    const token = est?.proposal_token;
                    if (token) {
                      setPreviewToken(token);
                      setShowPreview(true);
                      return;
                    }
                    if (!est?.id) return;
                    setLoadingPreview(true);
                    try {
                      const { token: t } = await api.getPreviewToken(est.id);
                      setPreviewToken(t);
                      setShowPreview(true);
                    } catch (e) {
                      console.error(e);
                    } finally {
                      setLoadingPreview(false);
                    }
                  }}
                  disabled={loadingPreview}
                  className="text-sm text-blue-600 hover:text-blue-700 underline underline-offset-2 disabled:opacity-50"
                >
                  {loadingPreview ? "Loading…" : "Preview estimate →"}
                </button>
                {est?.id && (
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/estimates/${est.id}`}>Edit Custom Price</Link>
                  </Button>
                )}
                {est?.id && !estimateSent && isRed && !isAdmin && !ownerNotified && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleNotifyOwner}
                    disabled={notifyingOwner}
                    className="border-amber-300 text-amber-700 hover:bg-amber-50"
                  >
                    {notifyingOwner ? "Notifying…" : "Notify Alan"}
                  </Button>
                )}
                {ownerNotified && !isAdmin && (
                  <span className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">
                    Alan notified
                  </span>
                )}
              </div>
            )}

            {/* Action area — differs by status */}
            {estimateSent ? (
              <div className="flex flex-col gap-2 w-full">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-green-100 text-green-700 w-fit">
                  <CheckCircle2 className="h-4 w-4" /> Sent to customer
                </span>
                {/* Funnel stage indicator */}
                {(() => {
                  const STAGES = ["sent", "opened", "hoa_selected", "package_selected", "color_selected", "date_selected", "checkout_started", "booked"];
                  const STAGE_LABELS: Record<string, string> = {
                    sent: "Sent", opened: "Viewed", hoa_selected: "HOA", package_selected: "Package",
                    color_selected: "Color", date_selected: "Date", checkout_started: "Checkout", booked: "Booked",
                  };
                  const stage = est?.proposal_funnel_stage || "sent";
                  const stageIdx = STAGES.indexOf(stage);
                  return (
                    <div className="rounded-lg border p-2.5 bg-muted/20 w-full">
                      <p className="text-xs font-semibold text-muted-foreground mb-1.5">Customer progress</p>
                      <div className="flex items-center gap-0.5 flex-wrap">
                        {STAGES.map((s, i) => {
                          const done = i <= stageIdx;
                          const isCurrent = i === stageIdx;
                          return (
                            <span key={s} className="flex items-center gap-0.5">
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${done ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground"} ${isCurrent ? "ring-1 ring-amber-400" : ""}`}>
                                {STAGE_LABELS[s]}
                              </span>
                              {i < STAGES.length - 1 && <span className="text-muted-foreground text-[10px]">›</span>}
                            </span>
                          );
                        })}
                      </div>
                      {/* Customer page activity */}
                      {(() => {
                        const lastActive = est?.proposal_last_active_at;
                        const leftAt = est?.proposal_left_page_at;
                        if (!lastActive && !leftAt) return null;
                        const now = Date.now();
                        const activeMs = lastActive ? now - new Date(lastActive).getTime() : Infinity;
                        const leftMs = leftAt ? now - new Date(leftAt).getTime() : Infinity;
                        const isActive = activeMs < 120_000 && (!leftAt || new Date(lastActive!).getTime() > new Date(leftAt).getTime());
                        const hasLeft = leftAt && (!lastActive || new Date(leftAt).getTime() >= new Date(lastActive).getTime());
                        const formatAgo = (ms: number) => {
                          const mins = Math.floor(ms / 60_000);
                          if (mins < 1) return "just now";
                          if (mins < 60) return `${mins}m ago`;
                          const hrs = Math.floor(mins / 60);
                          if (hrs < 24) return `${hrs}h ago`;
                          return `${Math.floor(hrs / 24)}d ago`;
                        };
                        if (isActive) return <p className="text-xs mt-1.5 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" /> <span className="text-green-700 font-medium">Customer is on the page now</span></p>;
                        if (hasLeft) return <p className="text-xs mt-1.5 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> <span className="text-red-600 font-medium">Left page {formatAgo(leftMs)}</span></p>;
                        return <p className="text-xs mt-1.5 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400 inline-block" /> <span className="text-muted-foreground">Last seen {formatAgo(activeMs)}</span></p>;
                      })()}
                    </div>
                  );
                })()}
                {/* Workflow automation status */}
                {lead.workflow_stage && (
                  <WorkflowSection leadId={lead.id} workflowStage={lead.workflow_stage} workflowPaused={lead.workflow_paused || false} />
                )}

                {/* Interactive Proposal Data */}
                {(est?.proposal_selected_tier || est?.proposal_color_mode || est?.proposal_booked_at) && (() => {
                  const tier = est.proposal_selected_tier;
                  const colorMode = est.proposal_color_mode;
                  const color = est.proposal_selected_color;
                  const hoaColors = est.proposal_hoa_colors;
                  const customColor = est.proposal_custom_color;
                  const bookedAt = est.proposal_booked_at;
                  const isBooked = est.proposal_status === "booked";

                  const colorDisplay = (() => {
                    if (!colorMode || colorMode === "gallery") return color || null;
                    if (colorMode === "hoa_only") return hoaColors?.length ? `HOA: ${hoaColors.join(", ")}` : null;
                    if (colorMode === "hoa_approved") return customColor ? `HOA Approved — ${customColor}` : "HOA Approved (pending)";
                    if (colorMode === "custom") return customColor ? `Custom — ${customColor}` : "Custom (pending)";
                    return color || null;
                  })();

                  const hoaOptionLabel = (() => {
                    if (!colorMode || colorMode === "gallery") return null;
                    if (colorMode === "hoa_only") return "HOA Multi-Select";
                    if (colorMode === "hoa_approved") return "HOA Approved Color";
                    if (colorMode === "custom") return "Custom Color";
                    return null;
                  })();

                  return (
                    <div className="rounded-lg border bg-muted/20 p-3 space-y-2.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Interactive Proposal Data</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                        {tier && (
                          <>
                            <span className="text-muted-foreground text-xs">Package</span>
                            <span className="text-xs font-medium capitalize">{tier}</span>
                          </>
                        )}
                        {hoaOptionLabel && (
                          <>
                            <span className="text-muted-foreground text-xs">HOA Option</span>
                            <span className="text-xs font-medium">{hoaOptionLabel}</span>
                          </>
                        )}
                        {colorDisplay && (
                          <>
                            <span className="text-muted-foreground text-xs">Color</span>
                            <span className="text-xs font-medium">{colorDisplay}</span>
                          </>
                        )}
                        {bookedAt && (
                          <>
                            <span className="text-muted-foreground text-xs">Date</span>
                            <span className="text-xs font-medium">
                              {new Date(bookedAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                              {isBooked && <span className="ml-1.5 text-green-600 font-semibold">✓ Booked</span>}
                            </span>
                          </>
                        )}
                      </div>
                      {/* Send date-selection link when color is chosen but no date yet */}
                      {colorDisplay && !isBooked && !bookedAt && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-xs w-full"
                          onClick={handleSendDateLink}
                          disabled={sendingDateLink || dateLinkSent}
                        >
                          <Send className="h-3.5 w-3.5" />
                          {dateLinkSent ? "Date Link Sent ✓" : sendingDateLink ? "Sending..." : "Send Date Selection Link"}
                        </Button>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : isRed ? (
              isAdmin ? (
                <div className="space-y-3 w-full">
                  {adminMode === "view" && (
                    <>
                      {!lead.customer_responded && !customerRespondedFromMessages && (
                        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                          <input type="checkbox" className="h-3.5 w-3.5 rounded" checked={forceSend} onChange={(e) => setForceSend(e.target.checked)} />
                          <span className="text-muted-foreground">Send even if no text back</span>
                        </label>
                      )}
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          className="gap-2 bg-green-600 hover:bg-green-700"
                          onClick={handleAdminApprove}
                          disabled={approvingEstimate || (!lead.customer_responded && !customerRespondedFromMessages && !forceSend)}
                        >
                          <Send className="h-4 w-4" />
                          {approvingEstimate ? "Sending..." : "Approve & Send All Packages"}
                        </Button>
                        <Button variant="outline" onClick={() => setAdminMode("custom")}>Custom Pricing</Button>
                        <Button variant="destructive" onClick={() => setAdminMode("reject")}>Reject</Button>
                      </div>
                    </>
                  )}
                  {adminMode === "custom" && (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">Override tier prices:</p>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs font-medium mb-1 block text-muted-foreground">Essential ($)</label>
                          <Input type="number" value={adminCustomEssential} onChange={(e) => setAdminCustomEssential(e.target.value)} placeholder="e.g. 650" />
                        </div>
                        <div>
                          <label className="text-xs font-medium mb-1 block font-semibold">Signature ★ ($)</label>
                          <Input type="number" value={adminCustomSignature} onChange={(e) => setAdminCustomSignature(e.target.value)} placeholder="e.g. 850" />
                        </div>
                        <div>
                          <label className="text-xs font-medium mb-1 block text-muted-foreground">Legacy ($)</label>
                          <Input type="number" value={adminCustomLegacy} onChange={(e) => setAdminCustomLegacy(e.target.value)} placeholder="e.g. 1050" />
                        </div>
                      </div>
                      <Textarea placeholder="Notes (optional)" value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} />
                      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input type="checkbox" className="h-3.5 w-3.5 rounded" checked={forceSend} onChange={(e) => setForceSend(e.target.checked)} />
                        <span className="text-muted-foreground">Send even if no text back</span>
                      </label>
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={handleAdminSaveCustomTiers} disabled={approvingEstimate || !adminCustomSignature}>
                          {approvingEstimate ? "Saving..." : "Save Custom Prices"}
                        </Button>
                        <Button
                          className="bg-green-600 hover:bg-green-700"
                          onClick={handleAdminCustomApprove}
                          disabled={approvingEstimate || !adminCustomSignature || (!lead.customer_responded && !customerRespondedFromMessages && !forceSend)}
                        >
                          <Send className="h-4 w-4 mr-2" />
                          {approvingEstimate ? "Sending..." : "Save & Send All Packages"}
                        </Button>
                        <Button variant="ghost" onClick={() => setAdminMode("view")}>Cancel</Button>
                      </div>
                    </div>
                  )}
                  {adminMode === "reject" && (
                    <div className="space-y-3">
                      <Textarea placeholder="Rejection reason (optional)" value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} />
                      <div className="flex gap-2">
                        <Button variant="destructive" onClick={handleAdminReject} disabled={approvingEstimate}>
                          {approvingEstimate ? "Rejecting..." : "Confirm Reject"}
                        </Button>
                        <Button variant="ghost" onClick={() => setAdminMode("view")}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* VA view for RED estimates — Notify Alan + bypass flow */
                <div className="space-y-3 w-full">
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      className="border-amber-300 text-amber-700 hover:bg-amber-50 gap-2"
                      onClick={handleNotifyOwner}
                      disabled={notifyingOwner || ownerNotified}
                    >
                      <MessageSquare className="h-4 w-4" />
                      {notifyingOwner ? "Notifying..." : ownerNotified ? "Alan Notified" : "Notify Alan"}
                    </Button>
                    {ownerNotified && (
                      <span className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1 self-center">
                        Alan has been texted for approval
                      </span>
                    )}
                  </div>

                  <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
                    <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded mt-0.5"
                        checked={bypassApproval}
                        onChange={(e) => {
                          setBypassApproval(e.target.checked);
                          if (!e.target.checked) { setBypassPassword(""); setBypassError(null); }
                        }}
                      />
                      <div>
                        <span className="font-medium">Send even if it might require Alan&apos;s approval</span>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Reason flagged: {approvalReason || "Requires owner review"}
                        </p>
                      </div>
                    </label>

                    {bypassApproval && (
                      <div className="space-y-2 pl-6">
                        {!lead.customer_responded && !customerRespondedFromMessages && (
                          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <input type="checkbox" className="h-3.5 w-3.5 rounded" checked={forceSend} onChange={(e) => setForceSend(e.target.checked)} />
                            <span className="text-muted-foreground">Send even if no text back</span>
                          </label>
                        )}
                        <div className="max-w-xs">
                          <label className="text-xs font-medium mb-1 block">Enter your password to confirm</label>
                          <Input
                            type="password"
                            value={bypassPassword}
                            onChange={(e) => { setBypassPassword(e.target.value); setBypassError(null); }}
                            placeholder="Your account password"
                          />
                          {bypassError && <p className="text-xs text-red-600 mt-1">{bypassError}</p>}
                        </div>
                        <Button
                          className="gap-2 bg-green-600 hover:bg-green-700"
                          onClick={handleBypassApprove}
                          disabled={approvingEstimate || !bypassPassword || (!lead.customer_responded && !customerRespondedFromMessages && !forceSend)}
                        >
                          <Send className="h-4 w-4" />
                          {approvingEstimate ? "Sending..." : "Confirm & Send All Packages"}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )
            ) : canApproveInline ? (
              <div className="flex flex-col gap-2 w-full">
                {!lead.customer_responded && !customerRespondedFromMessages && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded"
                      checked={forceSend}
                      onChange={(e) => setForceSend(e.target.checked)}
                    />
                    <span className="text-muted-foreground">
                      Send packages even though there has been no text back
                    </span>
                  </label>
                )}
                <Button
                  className="gap-2 bg-green-600 hover:bg-green-700 w-full"
                  onClick={handleApproveEstimate}
                  disabled={approvingEstimate || (!lead.customer_responded && !customerRespondedFromMessages && !forceSend)}
                >
                  <Send className="h-4 w-4" />
                  {approvingEstimate ? "Sending..." : "Approve & Send All Packages"}
                </Button>
              </div>
            ) : (
              <Button asChild>
                <Link href={`/estimates/${est.id}`}>View Estimate</Link>
              </Button>
            )}

            {approveError && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                {approveError}
              </div>
            )}

            {/* Yellow: add-ons tracking */}
            {approvalStatus === "yellow" && (
              <div className="flex items-center justify-between pt-1 border-t">
                <p className="text-sm text-muted-foreground">Additional services pricing</p>
                {additionalServicesSent ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" /> Sent Additional Proposal
                    </span>
                    <button
                      className="text-xs text-muted-foreground hover:text-destructive underline underline-offset-2"
                      disabled={markingAddons}
                      onClick={handleUnmarkAddonsSent}
                    >
                      Undo
                    </button>
                  </span>
                ) : (
                  <Button size="sm" variant="outline" className="text-xs h-7 px-2"
                    disabled={markingAddons}
                    onClick={handleMarkAddonsSent}
                  >
                    {markingAddons ? "Saving…" : "Mark Add-ons Sent"}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* VA Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">VA Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="Add notes about this lead (syncs to GHL)..."
            value={vaNotes}
            onChange={(e) => setVaNotes(e.target.value)}
            rows={3}
          />
          <Button
            size="sm"
            onClick={handleSaveNotes}
            disabled={savingNotes || vaNotes === (lead.va_notes || "")}
          >
            {savingNotes ? "Saving..." : "Save Notes"}
          </Button>
        </CardContent>
      </Card>
      {/* Estimate History */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" /> Estimate History
            </CardTitle>
            {!historyLoaded ? (
              <Button size="sm" variant="outline" onClick={handleLoadHistory} disabled={loadingHistory}>
                {loadingHistory ? "Loading..." : "Load History"}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={handleLoadHistory} disabled={loadingHistory}>
                <RefreshCw className={`h-3.5 w-3.5 ${loadingHistory ? "animate-spin" : ""}`} />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!historyLoaded ? (
            <p className="text-sm text-muted-foreground">Click "Load History" to see all previous estimates for this lead.</p>
          ) : estimateHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No previous estimates found.</p>
          ) : (
            <div className="space-y-3">
              {estimateHistory.map((e) => {
                const t = e.inputs?._tiers as Record<string, number> | undefined;
                const approvalStatus = e.inputs?._approval_status as string | undefined;
                const statusColor =
                  approvalStatus === "green" ? "bg-green-500" :
                  approvalStatus === "yellow" ? "bg-yellow-400" :
                  "bg-red-500";
                return (
                  <div key={e.id} className="flex items-center justify-between rounded-lg border px-3 py-2 gap-4">
                    <div className="flex items-center gap-2 min-w-0">
                      {approvalStatus && (
                        <span className={`h-2 w-2 rounded-full flex-shrink-0 ${statusColor}`} />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">{formatDate(e.created_at)}</p>
                        {e.owner_notes && (
                          <p className="text-xs text-muted-foreground truncate">{e.owner_notes}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {t?.signature ? (
                        <div className="text-right text-xs space-y-0.5">
                          <div>E <span className="font-medium">{formatCurrency(t.essential || 0)}</span></div>
                          <div>S <span className="font-semibold">{formatCurrency(t.signature)}</span></div>
                          <div>L <span className="font-medium">{formatCurrency(t.legacy || 0)}</span></div>
                        </div>
                      ) : (
                        <span className="text-sm font-medium">{formatCurrency(e.estimate_low)}</span>
                      )}
                      <Badge variant={
                        e.status === "approved" ? "success" :
                        e.status === "rejected" ? "destructive" :
                        e.status === "adjusted" ? "warning" : "pending"
                      }>
                        {e.status}
                      </Badge>
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/estimates/${e.id}`}>View</Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview Estimate Modal — loads actual proposal page in iframe */}
      {showPreview && previewToken && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div
            className="rounded-2xl w-full shadow-2xl overflow-hidden flex flex-col"
            style={{ maxWidth: 420, maxHeight: "90vh", background: "#0D0C0A" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2.5 shrink-0" style={{ borderBottom: "1px solid rgba(212,166,74,0.2)" }}>
              <p className="text-xs font-medium text-gray-400">
                Customer view — {est?.proposal_token ? "live proposal" : "preview"}
              </p>
              <div className="flex items-center gap-2">
                <a
                  href={`/proposal/${previewToken}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-2.5 py-1 rounded-lg transition-colors"
                  style={{ background: "#D4A64A", color: "#0D0C0A", fontWeight: 600 }}
                >
                  Open full page ↗
                </a>
                <button onClick={() => setShowPreview(false)} className="text-gray-500 hover:text-gray-300 transition-colors p-1 text-lg leading-none">✕</button>
              </div>
            </div>
            <iframe
              src={`/proposal/${previewToken}`}
              style={{ width: "100%", flex: 1, minHeight: 580, border: "none" }}
              title="Customer Proposal Preview"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowSection({ leadId, workflowStage, workflowPaused }: { leadId: string; workflowStage: string; workflowPaused: boolean }) {
  const [status, setStatus] = useState<WorkflowStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(workflowPaused);

  useEffect(() => {
    api.getWorkflowStatus(leadId).then(setStatus).catch(console.error).finally(() => setLoading(false));
  }, [leadId]);

  const STAGE_COLORS: Record<string, string> = {
    new_lead: "bg-blue-100 text-blue-800",
    asking_address: "bg-orange-100 text-orange-800",
    hot_lead: "bg-red-100 text-red-800",
    proposal_sent: "bg-teal-100 text-teal-800",
    no_package_selection: "bg-yellow-100 text-yellow-800",
    package_selected: "bg-cyan-100 text-cyan-800",
    no_date_selected: "bg-indigo-100 text-indigo-800",
    date_selected: "bg-blue-100 text-blue-900",
    deposit_paid: "bg-green-100 text-green-800",
    additional_service: "bg-purple-100 text-purple-800",
    job_complete: "bg-pink-100 text-pink-800",
    cold_nurture: "bg-slate-100 text-slate-800",
    past_customer: "bg-emerald-100 text-emerald-800",
  };

  const handlePauseToggle = async () => {
    try {
      if (paused) {
        await api.resumeWorkflow(leadId);
        setPaused(false);
      } else {
        await api.pauseWorkflow(leadId);
        setPaused(true);
      }
    } catch (e) {
      console.error("Failed to toggle pause:", e);
    }
  };

  const handleJobComplete = async () => {
    try {
      await api.markJobComplete(leadId);
      const updated = await api.getWorkflowStatus(leadId);
      setStatus(updated);
    } catch (e) {
      console.error("Failed to mark job complete:", e);
    }
  };

  const formatRelative = (iso: string) => {
    const diff = new Date(iso).getTime() - Date.now();
    const mins = Math.round(diff / 60000);
    if (mins < 0) return "overdue";
    if (mins < 60) return `in ${mins}m`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `in ${hrs}h`;
    return `in ${Math.round(hrs / 24)}d`;
  };

  if (loading) return null;

  return (
    <div className="rounded-lg border p-2.5 bg-muted/10 w-full mt-2">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
          <Zap className="h-3 w-3" /> Workflow Automation
        </p>
        <div className="flex items-center gap-1">
          {workflowStage === "deposit_paid" && (
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleJobComplete}>
              Mark Complete
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handlePauseToggle}>
            {paused ? <Play className="h-3 w-3 mr-1" /> : <Pause className="h-3 w-3 mr-1" />}
            {paused ? "Resume" : "Pause"}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLORS[workflowStage] || "bg-gray-100 text-gray-800"}`}>
          {status?.stage_label || workflowStage}
        </span>
        {paused && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-800">
            Paused
          </span>
        )}
      </div>

      {status && status.pending_messages.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Next messages</p>
          {status.pending_messages.slice(0, 3).map((m) => (
            <div key={m.id} className="flex items-start gap-1.5">
              <Clock className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] text-muted-foreground">{formatRelative(m.send_at)}</span>
                <p className="text-xs text-muted-foreground line-clamp-1">{m.message_body}</p>
              </div>
            </div>
          ))}
          {status.pending_messages.length > 3 && (
            <p className="text-[10px] text-muted-foreground">
              +{status.pending_messages.length - 3} more scheduled
            </p>
          )}
        </div>
      )}
    </div>
  );
}
