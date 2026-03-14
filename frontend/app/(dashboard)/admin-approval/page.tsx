"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, type Estimate, getCurrentUser } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CheckCircle, XCircle, ExternalLink, ShieldCheck, Eye } from "lucide-react";

const PRIORITY_ORDER: Record<string, number> = { HOT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const APPROVAL_BADGE: Record<string, { label: string; cls: string }> = {
  green:  { label: "Auto-approve", cls: "bg-green-100 text-green-700 border-green-200" },
  yellow: { label: "Add-ons review", cls: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  red:    { label: "Needs review", cls: "bg-red-100 text-red-700 border-red-200" },
};

const PRIORITY_BADGE: Record<string, string> = {
  HOT:    "bg-red-100 text-red-700 border-red-200",
  HIGH:   "bg-orange-100 text-orange-700 border-orange-200",
  MEDIUM: "bg-blue-100 text-blue-700 border-blue-200",
  LOW:    "bg-gray-100 text-gray-600 border-gray-200",
};

type PriceState = {
  essential: string;
  signature: string;
  legacy: string;
  notes: string;
  forceSend: boolean;
  rejectMode: boolean;
  rejectionNotes: string;
};

function parseTiers(inputs: Record<string, unknown> | undefined): Record<string, number> {
  const raw = inputs?._tiers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function initPriceState(est: Estimate): PriceState {
  const inputs = est.inputs as Record<string, unknown> | undefined;
  const tiers = parseTiers(inputs);
  return {
    essential: tiers.essential ? String(Math.round(tiers.essential)) : "",
    signature: tiers.signature ? String(Math.round(tiers.signature)) : String(Math.round(est.estimate_low || 0)),
    legacy:    tiers.legacy    ? String(Math.round(tiers.legacy))    : "",
    notes: "",
    forceSend: false,
    rejectMode: false,
    rejectionNotes: "",
  };
}

export default function AdminApprovalPage() {
  const router = useRouter();
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [loading, setLoading] = useState(true);
  const [priceStates, setPriceStates] = useState<Record<string, PriceState>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  // Guard: redirect if not admin
  useEffect(() => {
    const user = getCurrentUser();
    if (!user || user.role !== "admin") {
      router.replace("/");
    }
  }, [router]);

  const loadEstimates = useCallback(async () => {
    try {
      const data = await api.getEstimates("status=pending");
      // Sort: RED first, then by priority, then newest
      const sorted = [...data].sort((a, b) => {
        const aInputs = a.inputs as Record<string, unknown> | undefined;
        const bInputs = b.inputs as Record<string, unknown> | undefined;
        const aRed = (aInputs?._approval_status as string) === "red" ? 0 : 1;
        const bRed = (bInputs?._approval_status as string) === "red" ? 0 : 1;
        if (aRed !== bRed) return aRed - bRed;
        const pa = PRIORITY_ORDER[(a.lead as { priority?: string } | undefined)?.priority ?? ""] ?? 2;
        const pb = PRIORITY_ORDER[(b.lead as { priority?: string } | undefined)?.priority ?? ""] ?? 2;
        if (pa !== pb) return pa - pb;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setEstimates(sorted);
      // Init price states for new estimates only
      setPriceStates((prev) => {
        const next = { ...prev };
        for (const est of sorted) {
          if (!next[est.id]) next[est.id] = initPriceState(est);
        }
        return next;
      });
    } catch {
      // silently skip
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEstimates();
  }, [loadEstimates]);

  const updatePrice = (id: string, field: keyof PriceState, value: string | boolean) => {
    setPriceStates((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const handleApprove = async (est: Estimate) => {
    const ps = priceStates[est.id];
    const sig = Number(ps.signature);
    if (!sig || sig <= 0) {
      toast.error("Signature price must be greater than $0");
      return;
    }
    setSubmittingId(est.id);
    try {
      await api.adminApproveEstimate(est.id, {
        essential: ps.essential ? Number(ps.essential) : undefined,
        signature: sig,
        legacy:    ps.legacy    ? Number(ps.legacy)    : undefined,
        notes:     ps.notes     || undefined,
        force_send: ps.forceSend,
      });
      toast.success(`Packages sent to ${(est.lead as { contact_name?: string } | undefined)?.contact_name || "client"}!`);
      setEstimates((prev) => prev.filter((e) => e.id !== est.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to approve");
    } finally {
      setSubmittingId(null);
    }
  };

  const handleReject = async (est: Estimate) => {
    const ps = priceStates[est.id];
    setSubmittingId(est.id);
    try {
      await api.rejectEstimate(est.id, ps.rejectionNotes);
      toast.success("Estimate rejected.");
      setEstimates((prev) => prev.filter((e) => e.id !== est.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reject");
    } finally {
      setSubmittingId(null);
    }
  };

  const handlePreview = async (estimateId: string) => {
    setPreviewingId(estimateId);
    try {
      const { token } = await api.getPreviewToken(estimateId);
      window.open(`/proposal/${token}`, "_blank");
    } catch {
      toast.error("Failed to generate preview");
    } finally {
      setPreviewingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Admin Approval</h1>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const lead = (est: Estimate) => est.lead as { contact_name?: string; address?: string; priority?: string } | undefined;
  const approvalStatus = (est: Estimate) => ((est.inputs as Record<string, unknown> | undefined)?._approval_status as string) || "";

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Approval</h1>
          <p className="text-muted-foreground">
            {estimates.length > 0
              ? `${estimates.length} pending estimate${estimates.length > 1 ? "s" : ""} — review prices and send to clients`
              : "No pending estimates — all caught up!"}
          </p>
        </div>
      </div>

      {estimates.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <ShieldCheck className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium">All estimates reviewed</p>
            <p className="text-sm mt-1">New estimates from the VA will appear here.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {estimates.map((est) => {
          const ps = priceStates[est.id];
          if (!ps) return null;
          const l = lead(est);
          const status = approvalStatus(est);
          const approvalBadge = APPROVAL_BADGE[status];
          const priorityCls = l?.priority ? PRIORITY_BADGE[l.priority] : null;
          const isSubmitting = submittingId === est.id;

          return (
            <Card key={est.id} className={status === "red" ? "border-red-200" : ""}>
              <CardContent className="py-5 space-y-4">
                {/* Header row */}
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-base">
                        {l?.contact_name || "Unknown"}
                      </span>
                      {l?.priority && (
                        <span className={`text-xs font-medium border rounded px-2 py-0.5 ${priorityCls}`}>
                          {l.priority === "HOT" ? "🔥 HOT" : l.priority}
                        </span>
                      )}
                      {approvalBadge && (
                        <span className={`text-xs font-medium border rounded px-2 py-0.5 ${approvalBadge.cls}`}>
                          {approvalBadge.label}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{l?.address || "No address"}</p>
                    <p className="text-xs text-muted-foreground">Fence Staining · Created {formatDate(est.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => handlePreview(est.id)}
                      disabled={previewingId === est.id}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 underline underline-offset-2"
                    >
                      <Eye className="h-3 w-3" />
                      {previewingId === est.id ? "Loading…" : "Preview"}
                    </button>
                    <Link
                      href={`/estimates/${est.id}`}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 underline underline-offset-2"
                    >
                      Full Details <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                </div>

                {/* Price inputs */}
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { key: "essential" as const, label: "Essential" },
                    { key: "signature" as const, label: "Signature ★" },
                    { key: "legacy" as const,    label: "Legacy" },
                  ] as const).map(({ key, label }) => (
                    <div key={key}>
                      <label className={`text-xs font-medium block mb-1 ${key === "signature" ? "text-primary" : "text-muted-foreground"}`}>
                        {label}
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                        <Input
                          type="number"
                          className={`pl-6 ${key === "signature" ? "border-primary ring-1 ring-primary/20" : ""}`}
                          value={ps[key]}
                          onChange={(e) => updatePrice(est.id, key, e.target.value)}
                          placeholder="0"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Notes */}
                <div>
                  <Input
                    placeholder="Admin notes (optional)"
                    value={ps.notes}
                    onChange={(e) => updatePrice(est.id, "notes", e.target.value)}
                    className="text-sm"
                  />
                </div>

                {/* Actions row */}
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded"
                      checked={ps.forceSend}
                      onChange={(e) => updatePrice(est.id, "forceSend", e.target.checked)}
                    />
                    Force send (no reply required)
                  </label>
                  <div className="ml-auto flex items-center gap-2">
                    {ps.rejectMode ? (
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="Rejection reason..."
                          value={ps.rejectionNotes}
                          onChange={(e) => updatePrice(est.id, "rejectionNotes", e.target.value)}
                          className="text-sm h-8 w-48"
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={isSubmitting}
                          onClick={() => handleReject(est)}
                        >
                          {isSubmitting ? "Rejecting…" : "Confirm Reject"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => updatePrice(est.id, "rejectMode", false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive gap-1.5"
                          disabled={isSubmitting}
                          onClick={() => updatePrice(est.id, "rejectMode", true)}
                        >
                          <XCircle className="h-3.5 w-3.5" /> Reject
                        </Button>
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 gap-1.5"
                          disabled={isSubmitting}
                          onClick={() => handleApprove(est)}
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          {isSubmitting ? "Sending…" : "Approve & Send"}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
