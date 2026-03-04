"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type PricingConfig, type FieldMapping } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Check, RefreshCw, Zap } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WEBHOOK_URL = `${API_URL}/webhook/ghl`;

const OUR_FIELDS = [
  { value: "", label: "— Not mapped —" },
  { value: "fence_height", label: "Fence Height" },
  { value: "fence_age", label: "Fence Age" },
  { value: "previously_stained", label: "Previously Stained" },
  { value: "service_timeline", label: "Service Timeline" },
  { value: "additional_services", label: "Additional Services" },
  { value: "additional_notes", label: "Additional Notes" },
  { value: "surface_type", label: "Surface Type" },
  { value: "square_footage", label: "Square Footage" },
  { value: "service_type", label: "Service Type" },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button size="sm" variant="outline" onClick={copy} className="shrink-0">
      {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

type FenceConfig = {
  base_rate_per_sqft: number;
  age_factors: { lt5: number; yr5_10: number; gt10: number };
  prep_factor_new: number;
  urgency_factors: { flexible: number; within_month: number; rush: number };
  estimate_margin: number;
};

type PressureConfig = {
  base_rate_per_sqft: number;
  surface_factors: { concrete: number; deck: number; siding: number; other: number };
  condition_factors: { good: number; fair: number; poor: number };
  estimate_margin: number;
};

const defaultFenceConfig: FenceConfig = {
  base_rate_per_sqft: 1.5,
  age_factors: { lt5: 1.0, yr5_10: 1.1, gt10: 1.25 },
  prep_factor_new: 1.15,
  urgency_factors: { flexible: 1.0, within_month: 1.05, rush: 1.25 },
  estimate_margin: 0.1,
};

const defaultPressureConfig: PressureConfig = {
  base_rate_per_sqft: 0.25,
  surface_factors: { concrete: 1.0, deck: 1.2, siding: 1.3, other: 1.0 },
  condition_factors: { good: 1.0, fair: 1.15, poor: 1.35 },
  estimate_margin: 0.1,
};

export default function SettingsPage() {
  const [fenceConfig, setFenceConfig] = useState<FenceConfig>(defaultFenceConfig);
  const [pressureConfig, setPressureConfig] = useState<PressureConfig>(defaultPressureConfig);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ imported: number; skipped_duplicate: number; skipped_no_fields: number; total_fetched: number } | null>(null);
  const [fields, setFields] = useState<FieldMapping[]>([]);
  const [discoveringFields, setDiscoveringFields] = useState(false);

  const syncGHL = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const data = await api.syncGHL();
      setSyncResult(data);
      toast.success(`Synced ${data.imported} new leads from GHL`);
    } catch {
      toast.error("Sync failed — check your GHL API key and database connection");
    } finally {
      setSyncing(false);
    }
  };

  const discoverFields = async () => {
    setDiscoveringFields(true);
    try {
      const data = await api.discoverFields();
      setFields(data.fields);
      toast.success(`Found ${data.total_fields} fields, ${data.auto_mapped} auto-mapped`);
    } catch {
      toast.error("Failed to discover fields — check GHL API key");
    } finally {
      setDiscoveringFields(false);
    }
  };

  const updateMapping = async (ghlFieldId: string, ourFieldName: string | null) => {
    try {
      await api.updateFieldMapping(ghlFieldId, ourFieldName);
      setFields((prev) =>
        prev.map((f) =>
          f.ghl_field_id === ghlFieldId ? { ...f, our_field_name: ourFieldName } : f
        )
      );
      toast.success("Mapping updated");
    } catch {
      toast.error("Failed to update mapping");
    }
  };

  useEffect(() => {
    api.getPricing().then((configs) => {
      for (const c of configs) {
        if (c.service_type === "fence_staining") setFenceConfig(c.config as FenceConfig);
        if (c.service_type === "pressure_washing") setPressureConfig(c.config as PressureConfig);
      }
    }).catch(() => {});
  }, []);

  const savePricing = async () => {
    setSaving(true);
    try {
      await Promise.all([
        api.updatePricing("fence_staining", fenceConfig),
        api.updatePricing("pressure_washing", pressureConfig),
      ]);
      toast.success("Pricing config saved!");
    } catch {
      toast.error("Failed to save pricing config");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Configure pricing, integrations, and field mapping</p>
      </div>

      {/* GHL Field Mapping */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" /> GHL Field Mapping
          </CardTitle>
          <CardDescription>
            Discover your GHL custom fields and map them to the fields our system expects. This is required for form data to flow correctly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={discoverFields} disabled={discoveringFields} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${discoveringFields ? "animate-spin" : ""}`} />
            {discoveringFields ? "Discovering..." : "Discover GHL Fields"}
          </Button>

          {fields.length > 0 && (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">GHL Field Name</th>
                    <th className="text-left p-3 font-medium">GHL Key</th>
                    <th className="text-left p-3 font-medium">Maps To</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {fields.map((field) => (
                    <tr key={field.ghl_field_id} className="hover:bg-muted/30">
                      <td className="p-3 font-medium">{field.ghl_field_name}</td>
                      <td className="p-3 font-mono text-xs text-muted-foreground">{field.ghl_field_key}</td>
                      <td className="p-3">
                        <select
                          className="w-full rounded border px-2 py-1 text-sm bg-background"
                          value={field.our_field_name || ""}
                          onChange={(e) => updateMapping(field.ghl_field_id, e.target.value || null)}
                        >
                          {OUR_FIELDS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* GHL Sync */}
      <Card>
        <CardHeader>
          <CardTitle>Import Existing GHL Contacts</CardTitle>
          <CardDescription>
            Pull your existing GHL contacts who submitted a fence or pressure wash form and import them as leads. Only imports contacts with form fields filled in. Safe to run multiple times.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={syncGHL} disabled={syncing} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing from GHL..." : "Sync from GHL"}
          </Button>
          {syncResult && (
            <div className="rounded-lg border bg-muted/50 p-4 text-sm space-y-1">
              <p><span className="font-medium">Contacts fetched:</span> {syncResult.total_fetched}</p>
              <p className="text-green-700"><span className="font-medium">Imported:</span> {syncResult.imported} new leads</p>
              <p className="text-muted-foreground"><span className="font-medium">Skipped (already exist):</span> {syncResult.skipped_duplicate}</p>
              <p className="text-muted-foreground"><span className="font-medium">Skipped (no form fields):</span> {syncResult.skipped_no_fields}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* GHL Webhook URL */}
      <Card>
        <CardHeader>
          <CardTitle>GoHighLevel Webhook</CardTitle>
          <CardDescription>
            Paste this URL into your GHL automation webhook trigger. Use the &ldquo;Form Submitted&rdquo; event.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input readOnly value={WEBHOOK_URL} className="font-mono text-sm" />
            <CopyButton text={WEBHOOK_URL} />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            GHL &rarr; Automations &rarr; Webhook &rarr; Paste URL above &rarr; Map form fields
          </p>
        </CardContent>
      </Card>

      {/* Fence Staining Pricing */}
      <Card>
        <CardHeader>
          <CardTitle>Fence Staining — Pricing Config</CardTitle>
          <CardDescription>
            Formula: (linear_feet x height x base_rate) x age_factor x prep_factor x urgency_factor
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium block mb-1">Base rate per sq ft ($)</label>
              <Input
                type="number"
                step="0.01"
                value={fenceConfig.base_rate_per_sqft}
                onChange={(e) => setFenceConfig((c) => ({ ...c, base_rate_per_sqft: Number(e.target.value) }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Estimate margin (+/-%)</label>
              <Input
                type="number"
                step="0.01"
                value={fenceConfig.estimate_margin}
                onChange={(e) => setFenceConfig((c) => ({ ...c, estimate_margin: Number(e.target.value) }))}
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Age Factors (multiplier)</p>
            <div className="grid grid-cols-3 gap-3">
              {([["lt5", "< 5 years"], ["yr5_10", "5-10 years"], ["gt10", "> 10 years"]] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={fenceConfig.age_factors[key]}
                    onChange={(e) => setFenceConfig((c) => ({
                      ...c, age_factors: { ...c.age_factors, [key]: Number(e.target.value) }
                    }))}
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Not previously stained factor</label>
            <Input
              type="number"
              step="0.01"
              value={fenceConfig.prep_factor_new}
              onChange={(e) => setFenceConfig((c) => ({ ...c, prep_factor_new: Number(e.target.value) }))}
              className="w-40"
            />
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Urgency Factors</p>
            <div className="grid grid-cols-3 gap-3">
              {([["flexible", "Flexible"], ["within_month", "Within month"], ["rush", "Rush"]] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={fenceConfig.urgency_factors[key]}
                    onChange={(e) => setFenceConfig((c) => ({
                      ...c, urgency_factors: { ...c.urgency_factors, [key]: Number(e.target.value) }
                    }))}
                  />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pressure Washing Pricing */}
      <Card>
        <CardHeader>
          <CardTitle>Pressure Washing — Pricing Config</CardTitle>
          <CardDescription>
            Formula: (square_footage x base_rate) x surface_factor x condition_factor
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium block mb-1">Base rate per sq ft ($)</label>
              <Input
                type="number"
                step="0.01"
                value={pressureConfig.base_rate_per_sqft}
                onChange={(e) => setPressureConfig((c) => ({ ...c, base_rate_per_sqft: Number(e.target.value) }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Estimate margin (+/-%)</label>
              <Input
                type="number"
                step="0.01"
                value={pressureConfig.estimate_margin}
                onChange={(e) => setPressureConfig((c) => ({ ...c, estimate_margin: Number(e.target.value) }))}
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Surface Factors</p>
            <div className="grid grid-cols-4 gap-3">
              {(["concrete", "deck", "siding", "other"] as const).map((key) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground block mb-1 capitalize">{key}</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={pressureConfig.surface_factors[key]}
                    onChange={(e) => setPressureConfig((c) => ({
                      ...c, surface_factors: { ...c.surface_factors, [key]: Number(e.target.value) }
                    }))}
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Condition Factors</p>
            <div className="grid grid-cols-3 gap-3">
              {(["good", "fair", "poor"] as const).map((key) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground block mb-1 capitalize">{key}</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={pressureConfig.condition_factors[key]}
                    onChange={(e) => setPressureConfig((c) => ({
                      ...c, condition_factors: { ...c.condition_factors, [key]: Number(e.target.value) }
                    }))}
                  />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={savePricing} disabled={saving} size="lg">
        {saving ? "Saving..." : "Save All Settings"}
      </Button>
    </div>
  );
}
