"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, type Estimate, type EstimateStatus } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Send, Pencil, Check, X } from "lucide-react";

const statusVariant: Record<EstimateStatus, "pending" | "success" | "destructive" | "warning"> = {
  pending: "pending",
  approved: "success",
  rejected: "destructive",
  adjusted: "warning",
};

const serviceLabel: Record<string, string> = {
  fence_staining: "Fence Staining",
  pressure_washing: "Pressure Washing",
};

function InlineTierEditor({
  est,
  onSaved,
}: {
  est: Estimate;
  onSaved: (updated: { essential: number; signature: number; legacy: number }) => void;
}) {
  const t = (est.inputs as Record<string, unknown>)?._tiers as Record<string, number> | undefined;
  const [editing, setEditing] = useState(false);
  const [essential, setEssential] = useState(String(t?.essential || 0));
  const [signature, setSignature] = useState(String(t?.signature || 0));
  const [legacy, setLegacy] = useState(String(t?.legacy || 0));
  const [saving, setSaving] = useState(false);
  const essRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setEssential(String(Math.round(t?.essential || 0)));
    setSignature(String(Math.round(t?.signature || 0)));
    setLegacy(String(Math.round(t?.legacy || 0)));
    setEditing(true);
    setTimeout(() => essRef.current?.focus(), 50);
  };

  const handleSave = async () => {
    const e = parseFloat(essential) || 0;
    const s = parseFloat(signature) || 0;
    const l = parseFloat(legacy) || 0;
    if (e <= 0 || s <= 0 || l <= 0) return;
    setSaving(true);
    try {
      await api.saveCustomTiers(est.id, { essential: e, signature: s, legacy: l });
      onSaved({ essential: e, signature: s, legacy: l });
      setEditing(false);
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") setEditing(false);
  };

  if (!t?.signature && !editing) {
    return <p className="font-bold text-xl">{formatCurrency(est.estimate_low)}</p>;
  }

  if (editing) {
    return (
      <div className="space-y-1 text-right" onKeyDown={handleKeyDown}>
        <div className="flex items-center gap-1 justify-end">
          <span className="text-xs text-muted-foreground w-3">E</span>
          <input ref={essRef} className="w-16 text-right text-xs border rounded px-1 py-0.5" value={essential} onChange={(e) => setEssential(e.target.value)} />
        </div>
        <div className="flex items-center gap-1 justify-end">
          <span className="text-xs text-muted-foreground w-3">S</span>
          <input className="w-16 text-right text-xs border rounded px-1 py-0.5 font-semibold" value={signature} onChange={(e) => setSignature(e.target.value)} />
        </div>
        <div className="flex items-center gap-1 justify-end">
          <span className="text-xs text-muted-foreground w-3">L</span>
          <input className="w-16 text-right text-xs border rounded px-1 py-0.5" value={legacy} onChange={(e) => setLegacy(e.target.value)} />
        </div>
        <div className="flex items-center gap-1 justify-end pt-0.5">
          <button onClick={handleSave} disabled={saving} className="p-0.5 rounded hover:bg-green-50 text-green-600" title="Save">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setEditing(false)} className="p-0.5 rounded hover:bg-red-50 text-red-500" title="Cancel">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="text-xs font-medium text-emerald-700 space-y-0.5 text-right group cursor-pointer" onClick={startEdit} title="Click to edit prices">
      <div>E <span className="font-semibold">{formatCurrency(t!.essential || 0)}</span></div>
      <div>S <span className="font-bold text-sm">{formatCurrency(t!.signature)}</span></div>
      <div>L <span className="font-semibold">{formatCurrency(t!.legacy || 0)}</span></div>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="inline-flex items-center gap-0.5 text-blue-500 text-[10px]">
          <Pencil className="h-2.5 w-2.5" /> edit
        </span>
      </div>
    </div>
  );
}


export default function EstimatesPage() {
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<EstimateStatus | "all">("pending");
  const [markingId, setMarkingId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = statusFilter !== "all" ? `status=${statusFilter}` : "";
    api.getEstimates(params)
      .then(setEstimates)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const handleMarkAdditionalSent = async (est: Estimate) => {
    setMarkingId(est.id);
    try {
      await api.markAdditionalServicesSent(est.id);
      setEstimates((prev) =>
        prev.map((e) => e.id === est.id ? { ...e, additional_services_sent: true } : e)
      );
    } catch (e) {
      console.error(e);
    }
    setMarkingId(null);
  };

  const handleUnmarkAdditionalSent = async (est: Estimate) => {
    setMarkingId(est.id);
    try {
      await api.unmarkAdditionalServicesSent(est.id);
      setEstimates((prev) =>
        prev.map((e) => e.id === est.id ? { ...e, additional_services_sent: false } : e)
      );
    } catch (e) {
      console.error(e);
    }
    setMarkingId(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Estimates</h1>
        <p className="text-muted-foreground">Review, approve, or reject generated estimates</p>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {(["pending", "approved", "adjusted", "rejected", "all"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? "default" : "outline"}
            onClick={() => setStatusFilter(s)}
          >
            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : estimates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No {statusFilter !== "all" ? statusFilter : ""} estimates yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {estimates.map((est) => (
            <Card key={est.id} className="hover:shadow-md transition-shadow">
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">
                        {est.lead?.contact_name || serviceLabel[est.service_type]}
                      </span>
                      <Badge variant={statusVariant[est.status]}>{est.status}</Badge>
                      {est.additional_services_sent && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Sent Additional Proposal
                          </span>
                          <button
                            className="text-xs text-muted-foreground hover:text-destructive underline underline-offset-2"
                            disabled={markingId === est.id}
                            onClick={() => handleUnmarkAdditionalSent(est)}
                          >
                            Undo
                          </button>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {serviceLabel[est.service_type]}
                      <span className="ml-2 font-mono text-muted-foreground/60">#{est.id.slice(0, 8)}</span>
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                      {est.lead?.address ?? "Address pending"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Created {formatDate(est.created_at)}
                      {est.approved_at && ` · Approved ${formatDate(est.approved_at)}`}
                      {est.send_count > 0 && (
                        <span className="ml-2 inline-flex items-center gap-1 text-blue-600">
                          <Send className="h-3 w-3" />
                          Sent {est.send_count}×
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="text-right space-y-2 shrink-0">
                    <InlineTierEditor
                      est={est}
                      onSaved={(tiers) => {
                        setEstimates((prev) =>
                          prev.map((e) =>
                            e.id === est.id
                              ? { ...e, inputs: { ...(e.inputs || {}), _tiers: tiers } }
                              : e
                          )
                        );
                      }}
                    />
                    <div className="flex flex-col gap-1.5 items-end">
                      <Button size="sm" asChild>
                        <Link href={`/estimates/${est.id}`}>
                          {est.status === "pending" ? "Review" : "View"}
                        </Link>
                      </Button>
                      {!est.additional_services_sent && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 px-2"
                          disabled={markingId === est.id}
                          onClick={() => handleMarkAdditionalSent(est)}
                        >
                          {markingId === est.id ? "Saving…" : "Mark Add-ons Sent"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
