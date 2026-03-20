"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, type EstimateDetail, getCurrentUser } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ArrowLeft, CheckCircle, XCircle, Edit2, MapPin, ExternalLink, Eye, Send, RotateCcw, MessageSquare } from "lucide-react";

const fieldLabels: Record<string, string> = {
  fence_height: "Fence Height",
  fence_age: "Fence Age",
  previously_stained: "Previously Stained",
  service_timeline: "Service Timeline",
  linear_feet: "Linear Feet",
  additional_services: "Additional Services",
  additional_notes: "Notes",
  surface_type: "Surface Type",
  square_footage: "Square Footage",
  condition: "Condition",
};

const APPROVAL_CONFIG = {
  green: {
    label: "Green — Auto-send approved",
    classes: "bg-green-50 border-green-300 text-green-800",
    dot: "bg-green-500",
  },
  yellow: {
    label: "Yellow — Fence quote ready, price add-ons separately",
    classes: "bg-yellow-50 border-yellow-300 text-yellow-800",
    dot: "bg-yellow-500",
  },
  red: {
    label: "Red — Requires Alan's review",
    classes: "bg-red-50 border-red-300 text-red-800",
    dot: "bg-red-500",
  },
} as const;

const PRIORITY_CONFIG: Record<string, { label: string; classes: string }> = {
  HOT:    { label: "🔥 HOT",    classes: "bg-red-100 text-red-700 border-red-200" },
  HIGH:   { label: "HIGH",      classes: "bg-orange-100 text-orange-700 border-orange-200" },
  MEDIUM: { label: "MEDIUM",    classes: "bg-blue-100 text-blue-700 border-blue-200" },
  LOW:    { label: "LOW",       classes: "bg-gray-100 text-gray-600 border-gray-200" },
};

function formatCurrencyShort(val: number) {
  return val > 0 ? `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

function formatMonthly(val: number) {
  return val > 0 ? `$${(val / 21).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo` : "";
}

function parseTiers(inputs: EstimateDetail["inputs"] | undefined): Record<string, number> {
  const maybeInputs = inputs as Record<string, unknown> | undefined;
  const rawTiers = maybeInputs?._tiers;
  if (!rawTiers || typeof rawTiers !== "object" || Array.isArray(rawTiers)) {
    return {};
  }

  const parsed: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawTiers as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      parsed[key] = value;
    }
  }
  return parsed;
}

export default function EstimateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [estimate, setEstimate] = useState<EstimateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"view" | "adjust" | "reject" | "custom">("view");
  const [forceSend, setForceSend] = useState(false);
  const [adjustPrice, setAdjustPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [customEssential, setCustomEssential] = useState("");
  const [customSignature, setCustomSignature] = useState("");
  const [customLegacy, setCustomLegacy] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [resending, setResending] = useState(false);
  // VA bypass state
  const [notifyingOwner, setNotifyingOwner] = useState(false);
  const [ownerNotified, setOwnerNotified] = useState(false);
  const [bypassApproval, setBypassApproval] = useState(false);
  const [bypassPassword, setBypassPassword] = useState("");
  const [bypassError, setBypassError] = useState<string | null>(null);

  useEffect(() => {
    api.getEstimate(id).then((e) => {
      setEstimate(e);
      const t = parseTiers(e.inputs);
      setAdjustPrice(String(t.signature || e.estimate_low));
      if (t.essential) setCustomEssential(String(t.essential));
      if (t.signature) setCustomSignature(String(t.signature));
      if (t.legacy) setCustomLegacy(String(t.legacy));
      if ((e.inputs as Record<string, unknown>)?._owner_notified) setOwnerNotified(true);
      setLoading(false);
    }).catch(console.error);
  }, [id]);

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      await api.approveEstimate(id, "signature", forceSend);
      toast.success("All packages sent to client!");
      router.push("/estimates");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to approve estimate");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdjust = async () => {
    setSubmitting(true);
    try {
      const price = Number(adjustPrice);
      await api.adjustEstimate(id, price, price, notes);
      toast.success("Estimate adjusted and approved!");
      router.push("/estimates");
    } catch (e) {
      toast.error("Failed to adjust estimate");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    setSubmitting(true);
    try {
      await api.rejectEstimate(id, notes);
      toast.success("Estimate rejected.");
      router.push("/estimates");
    } catch (e) {
      toast.error("Failed to reject estimate");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCustomApprove = async () => {
    setSubmitting(true);
    try {
      const essential = customEssential ? Number(customEssential) : undefined;
      const signature = customSignature ? Number(customSignature) : undefined;
      const legacy = customLegacy ? Number(customLegacy) : undefined;
      await api.adminApproveEstimate(id, { essential, signature, legacy, notes: notes || undefined, force_send: forceSend });
      toast.success("Custom prices set & all packages sent to client!");
      router.push("/estimates");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to approve with custom pricing");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveCustomTiers = async () => {
    setSubmitting(true);
    try {
      const essential = customEssential ? Number(customEssential) : undefined;
      const signature = customSignature ? Number(customSignature) : undefined;
      const legacy = customLegacy ? Number(customLegacy) : undefined;
      await api.saveCustomTiers(id, { essential, signature, legacy, notes: notes || undefined });
      toast.success("Custom prices saved (not sent yet).");
      const updated = await api.getEstimate(id);
      setEstimate(updated);
      setMode("view");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save custom prices");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    try {
      const { token } = await api.getPreviewToken(id);
      window.open(`/proposal/${token}`, "_blank");
    } catch (e) {
      toast.error("Failed to generate preview");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await api.resendEstimate(id);
      toast.success("Estimate resent to client!");
      // Refresh to show updated send count
      const updated = await api.getEstimate(id);
      setEstimate(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to resend estimate");
    } finally {
      setResending(false);
    }
  };

  const handleNotifyOwner = async () => {
    setNotifyingOwner(true);
    try {
      await api.notifyOwnerForApproval(id);
      setOwnerNotified(true);
      toast.success("Alan has been notified via text");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to notify Alan");
    } finally {
      setNotifyingOwner(false);
    }
  };

  const handleBypassApprove = async () => {
    if (!bypassPassword) return;
    setSubmitting(true);
    setBypassError(null);
    try {
      await api.approveEstimate(id, "signature", forceSend, true, bypassPassword);
      toast.success("All packages sent to client (bypass approved)!");
      router.push("/estimates");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to send estimate";
      if (msg.toLowerCase().includes("password") || msg.toLowerCase().includes("bypass denied")) {
        setBypassError(msg);
      } else {
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!estimate) return <p className="text-muted-foreground">Estimate not found.</p>;

  const isPending = estimate.status === "pending";
  const isAdmin = getCurrentUser()?.role === "admin";
  const mapsLink = estimate.lead?.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(estimate.lead.address)}`
    : null;

  // Extract computed meta from inputs (underscore-prefixed keys)
  const inputs = estimate.inputs as Record<string, unknown>;
  const approvalStatus = (inputs._approval_status as string) || "";
  const approvalReason = (inputs._approval_reason as string) || "";
  const zone = (inputs._zone as string) || "";
  const priority = (inputs._priority as string) || "";
  const sqft = (inputs._sqft as number) || 0;
  const tiers = parseTiers(estimate.inputs);

  // Only show user-facing form fields (skip underscore meta keys)
  const formFields = Object.entries(inputs).filter(([k]) => !k.startsWith("_"));

  const approvalCfg = APPROVAL_CONFIG[approvalStatus as keyof typeof APPROVAL_CONFIG];
  const priorityCfg = priority ? PRIORITY_CONFIG[priority] : null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/estimates"><ArrowLeft className="h-4 w-4 mr-1" /> Estimates</Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">
            {estimate.service_type === "fence_staining" ? "Fence Restoration" : "Pressure Washing"} Estimate
          </h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono text-xs mr-2">#{estimate.id.slice(0, 8)}</span>
            Created {formatDate(estimate.created_at)}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          {estimate.send_count > 0 && (
            <span className="text-xs text-blue-600 flex items-center gap-1">
              <Send className="h-3 w-3" /> Sent {estimate.send_count}×
            </span>
          )}
          <Button size="sm" variant="outline" onClick={handlePreview} disabled={previewLoading} className="gap-1.5">
            <Eye className="h-3.5 w-3.5" />
            {previewLoading ? "Loading…" : "Preview"}
          </Button>
          {isPending && (
            <Button size="sm" variant="outline" onClick={() => setMode("custom")} className="gap-1.5">
              <Edit2 className="h-3.5 w-3.5" />
              Edit Custom Price
            </Button>
          )}
          {isAdmin && (estimate.status === "approved" || estimate.status === "adjusted") && (
            <Button size="sm" variant="outline" onClick={handleResend} disabled={resending} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              {resending ? "Sending…" : "Resend"}
            </Button>
          )}
          <Badge variant={
            estimate.status === "approved" ? "success" :
            estimate.status === "rejected" ? "destructive" :
            estimate.status === "adjusted" ? "warning" : "pending"
          }>
            {estimate.status}
          </Badge>
        </div>
      </div>

      {/* Approval Status Banner */}
      {approvalCfg && (
        <div className={`flex items-start gap-3 border rounded-lg px-4 py-3 ${approvalCfg.classes}`}>
          <span className={`mt-1 h-2.5 w-2.5 rounded-full flex-shrink-0 ${approvalCfg.dot}`} />
          <div>
            <p className="font-semibold text-sm">{approvalCfg.label}</p>
            {approvalReason && <p className="text-xs mt-0.5 opacity-80">{approvalReason}</p>}
          </div>
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            {zone && (
              <span className="text-xs font-medium border rounded px-2 py-0.5 bg-white/60">
                {zone} Zone
              </span>
            )}
            {priorityCfg && (
              <span className={`text-xs font-medium border rounded px-2 py-0.5 ${priorityCfg.classes}`}>
                {priorityCfg.label}
              </span>
            )}
            {sqft > 0 && (
              <span className="text-xs font-medium border rounded px-2 py-0.5 bg-white/60">
                {sqft.toLocaleString()} sqft
              </span>
            )}
          </div>
        </div>
      )}

      {/* 3-Tier Pricing — display only, all 3 are sent together */}
      {estimate.service_type === "fence_staining" && tiers.signature > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Package Pricing</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">All 3 packages are sent together in the proposal.</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              {([
                { key: "essential", label: "Essential", highlight: false },
                { key: "signature", label: "Signature ★", highlight: true },
                { key: "legacy", label: "Legacy", highlight: false },
              ] as const).map(({ key, label, highlight }) => (
                <div
                  key={key}
                  className={`rounded-lg border-2 p-3 text-center space-y-1 ${
                    highlight ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <p className={`text-xs font-medium uppercase tracking-wide ${
                    highlight ? "text-primary" : "text-muted-foreground"
                  }`}>{label}</p>
                  <p className="text-xl font-bold">{formatCurrencyShort(tiers[key])}</p>
                  {tiers[key] > 0 && (
                    <p className="text-xs text-muted-foreground">{formatMonthly(tiers[key])}</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Lead Info */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Lead Details</CardTitle>
              {mapsLink && (
                <Button size="sm" variant="outline" asChild>
                  <a href={mapsLink} target="_blank" rel="noopener noreferrer">
                    <MapPin className="h-3 w-3 mr-1" /> Maps <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {estimate.lead?.address && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Address</span>
                <span className="font-medium text-right max-w-[220px]">{estimate.lead.address}</span>
              </div>
            )}
            {formFields.map(([key, value]) => (
              <div key={key} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{fieldLabels[key] ?? key}</span>
                <span className="font-medium text-right max-w-[220px]">{String(value)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Estimate Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Estimate Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {estimate.breakdown.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <div>
                  <span>{item.label}</span>
                  {item.note && <p className="text-xs text-muted-foreground">{item.note}</p>}
                </div>
                <span className="font-medium">{formatCurrency(item.value)}</span>
              </div>
            ))}
            <hr />
            {tiers.signature > 0 ? (
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Essential</span>
                  <span className="font-semibold">{formatCurrencyShort(tiers.essential)}</span>
                </div>
                <div className="flex justify-between text-base font-bold">
                  <span>Signature <span className="text-xs font-normal text-muted-foreground">★ Recommended</span></span>
                  <span>{formatCurrencyShort(tiers.signature)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Legacy</span>
                  <span className="font-semibold">{formatCurrencyShort(tiers.legacy)}</span>
                </div>
              </div>
            ) : (
              <div className="flex justify-between font-bold text-lg">
                <span>Total</span>
                <span>{formatCurrency(estimate.estimate_low)}</span>
              </div>
            )}
            {estimate.owner_notes && (
              <p className="text-sm text-muted-foreground bg-muted p-3 rounded">
                Note: {estimate.owner_notes}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Approval Actions (pending estimates — both admin and VA) */}
      {isPending && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{isAdmin ? "Owner Action" : "Send Estimate"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {mode === "view" && (
              <div className="space-y-3">
                {approvalStatus === "red" && isAdmin && (
                  <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                    This estimate requires Alan&apos;s review before sending. Approval is blocked.
                  </p>
                )}
                {approvalStatus === "red" && !isAdmin && (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    This estimate is flagged for review: {approvalReason || "Requires owner review"}. You can notify Alan or bypass with password confirmation below.
                  </p>
                )}
                {tiers.signature === 0 && approvalStatus !== "red" && (
                  <p className="text-sm text-orange-700 bg-orange-50 border border-orange-200 rounded-md px-3 py-2">
                    Estimate price is $0 — recalculate before approving.
                  </p>
                )}

                {/* Admin: full controls */}
                {isAdmin && (
                  <>
                    <div className="flex gap-3 flex-wrap">
                      <Button onClick={handleApprove} disabled={submitting || approvalStatus === "red" || tiers.signature === 0 || (!estimate.lead?.customer_responded && !forceSend)} className="gap-2 bg-green-600 hover:bg-green-700">
                        <CheckCircle className="h-4 w-4" />
                        {submitting ? "Sending..." : "Approve & Send All Packages"}
                      </Button>
                      <Button variant="outline" onClick={() => setMode("custom")} className="gap-2">
                        <Edit2 className="h-4 w-4" />
                        Custom Pricing
                      </Button>
                      <Button variant="outline" onClick={() => setMode("adjust")} className="gap-2">
                        <Edit2 className="h-4 w-4" />
                        Adjust Amount
                      </Button>
                      <Button variant="destructive" onClick={() => setMode("reject")} className="gap-2">
                        <XCircle className="h-4 w-4" />
                        Reject
                      </Button>
                    </div>
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
                  </>
                )}

                {/* VA: GREEN/YELLOW — direct send */}
                {!isAdmin && approvalStatus !== "red" && (
                  <>
                    {!estimate.lead?.customer_responded && (
                      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input type="checkbox" className="h-3.5 w-3.5 rounded" checked={forceSend} onChange={(e) => setForceSend(e.target.checked)} />
                        <span className="text-muted-foreground">Send even if no text back</span>
                      </label>
                    )}
                    <Button onClick={handleApprove} disabled={submitting || tiers.signature === 0 || (!estimate.lead?.customer_responded && !forceSend)} className="gap-2 bg-green-600 hover:bg-green-700">
                      <Send className="h-4 w-4" />
                      {submitting ? "Sending..." : "Approve & Send All Packages"}
                    </Button>
                  </>
                )}

                {/* VA: RED — notify Alan + bypass flow */}
                {!isAdmin && approvalStatus === "red" && (
                  <>
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
                          {!estimate.lead?.customer_responded && (
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
                            disabled={submitting || !bypassPassword || (!estimate.lead?.customer_responded && !forceSend)}
                          >
                            <Send className="h-4 w-4" />
                            {submitting ? "Sending..." : "Confirm & Send All Packages"}
                          </Button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {mode === "adjust" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Set a custom price for this estimate, then it will be sent to the client.</p>
                <div className="max-w-xs">
                  <label className="text-sm font-medium mb-1 block">Custom price ($)</label>
                  <Input type="number" value={adjustPrice} onChange={(e) => setAdjustPrice(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Notes (optional)</label>
                  <Textarea placeholder="Reason for adjustment..." value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleAdjust} disabled={submitting}>
                    Save & Approve
                  </Button>
                  <Button variant="ghost" onClick={() => setMode("view")}>Cancel</Button>
                </div>
              </div>
            )}

            {mode === "custom" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Override the auto-calculated prices for each tier. All 3 packages will be sent to the client with your custom prices.</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block text-muted-foreground">Essential ($)</label>
                    <Input type="number" value={customEssential} onChange={(e) => setCustomEssential(e.target.value)} placeholder="e.g. 650" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block text-primary">Signature ★ ($)</label>
                    <Input type="number" value={customSignature} onChange={(e) => setCustomSignature(e.target.value)} placeholder="e.g. 850" className="border-primary" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block text-muted-foreground">Legacy ($)</label>
                    <Input type="number" value={customLegacy} onChange={(e) => setCustomLegacy(e.target.value)} placeholder="e.g. 1050" />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Notes (optional)</label>
                  <Textarea placeholder="Reason for custom pricing..." value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input type="checkbox" className="h-3.5 w-3.5 rounded" checked={forceSend} onChange={(e) => setForceSend(e.target.checked)} />
                  <span className="text-muted-foreground">Send even if no text back</span>
                </label>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleSaveCustomTiers} disabled={submitting || !customSignature}>
                    {submitting ? "Saving..." : "Save Custom Prices"}
                  </Button>
                  <Button onClick={handleCustomApprove} disabled={submitting || !customSignature} className="bg-green-600 hover:bg-green-700">
                    <CheckCircle className="h-4 w-4 mr-2" />
                    {submitting ? "Sending..." : "Save & Send All Packages"}
                  </Button>
                  <Button variant="ghost" onClick={() => setMode("view")}>Cancel</Button>
                </div>
              </div>
            )}

            {mode === "reject" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Optionally add a note about why this estimate is being rejected.</p>
                <Textarea placeholder="Rejection reason..." value={notes} onChange={(e) => setNotes(e.target.value)} />
                <div className="flex gap-2">
                  <Button variant="destructive" onClick={handleReject} disabled={submitting}>
                    Confirm Reject
                  </Button>
                  <Button variant="ghost" onClick={() => setMode("view")}>Cancel</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
