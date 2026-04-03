"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, getCurrentUser, type FieldMapping, type PipelineSyncResult, type PdfTemplateInfo } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Check, RefreshCw, Zap, Upload, FileText, Trash2, MapPin } from "lucide-react";
import PdfFieldMapper from "@/components/pdf-field-mapper";

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

type TierRates = { essential: number; signature: number; legacy: number };

type FenceConfig = {
  tier_rates: {
    brand_new: TierRates;
    "1_6yr": TierRates;
    "6_15yr": TierRates;
  };
  size_surcharge_rate: number;
};

type PressureConfig = {
  base_rate_per_sqft: number;
  surface_factors: { concrete: number; deck: number; siding: number; other: number };
  condition_factors: { good: number; fair: number; poor: number };
  estimate_margin: number;
};

const defaultFenceConfig: FenceConfig = {
  tier_rates: {
    brand_new: { essential: 0.72, signature: 0.84, legacy: 1.09 },
    "1_6yr":   { essential: 0.74, signature: 0.86, legacy: 1.11 },
    "6_15yr":  { essential: 0.76, signature: 0.88, legacy: 1.13 },
  },
  size_surcharge_rate: 0.12,
};

const defaultPressureConfig: PressureConfig = {
  base_rate_per_sqft: 0.25,
  surface_factors: { concrete: 1.0, deck: 1.2, siding: 1.3, other: 1.0 },
  condition_factors: { good: 1.0, fair: 1.15, poor: 1.35 },
  estimate_margin: 0.1,
};

export default function SettingsPage() {
  const currentUser = getCurrentUser();
  const isAdmin = currentUser?.role === "admin";
  const [fenceConfig, setFenceConfig] = useState<FenceConfig>(defaultFenceConfig);
  const [pressureConfig, setPressureConfig] = useState<PressureConfig>(defaultPressureConfig);
  const [pricingLoaded, setPricingLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ imported: number; skipped_duplicate: number; skipped_no_fields: number; total_fetched: number } | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [syncingPipeline, setSyncingPipeline] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<PipelineSyncResult | null>(null);
  const [fields, setFields] = useState<FieldMapping[]>([]);
  const [discoveringFields, setDiscoveringFields] = useState(false);

  // PDF Template state
  const [pdfTemplate, setPdfTemplate] = useState<PdfTemplateInfo | null>(null);
  const [pdfTemplateLoading, setPdfTemplateLoading] = useState(false);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [showFieldMapper, setShowFieldMapper] = useState(false);
  const [pdfDeleting, setPdfDeleting] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const loadPdfTemplate = async () => {
    setPdfTemplateLoading(true);
    try {
      const data = await api.getPdfTemplate();
      setPdfTemplate(data);
    } catch {
      setPdfTemplate(null);
    } finally {
      setPdfTemplateLoading(false);
    }
  };

  const handlePdfUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are accepted");
      return;
    }
    setPdfUploading(true);
    try {
      await api.uploadPdfTemplate(file);
      toast.success("PDF template uploaded");
      await loadPdfTemplate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setPdfUploading(false);
    }
  };

  const handlePdfDelete = async () => {
    if (!confirm("Delete the PDF template? This will remove the template and all field mappings.")) return;
    setPdfDeleting(true);
    try {
      await api.deletePdfTemplate();
      setPdfTemplate(null);
      setShowFieldMapper(false);
      toast.success("Template deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setPdfDeleting(false);
    }
  };

  const archiveAll = async () => {
    if (!confirm("Archive ALL leads? They will be hidden from the dashboard. This cannot be undone without direct database access.")) return;
    setArchiving(true);
    try {
      const data = await api.archiveAllLeads();
      toast.success(`Archived ${data.count} leads — dashboard is now clear`);
    } catch {
      toast.error("Archive failed");
    } finally {
      setArchiving(false);
    }
  };

  const syncPipeline = async () => {
    setSyncingPipeline(true);
    setPipelineResult(null);
    try {
      const data = await api.syncPipeline();
      setPipelineResult(data);
      if (data.status === "error") {
        toast.error("Pipeline sync failed — see details below");
      } else {
        toast.success(`Pipeline sync complete — ${data.imported} imported, ${data.updated} updated`);
      }
    } catch {
      toast.error("Pipeline sync failed — check your GHL API key");
    } finally {
      setSyncingPipeline(false);
    }
  };

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
        if (c.service_type === "fence_staining") {
          const fetched = c.config as FenceConfig;
          setFenceConfig({
            ...defaultFenceConfig,
            ...fetched,
            tier_rates: {
              ...defaultFenceConfig.tier_rates,
              ...(fetched.tier_rates || {}),
            },
          });
        }
        if (c.service_type === "pressure_washing") {
          const fetched = c.config as PressureConfig;
          setPressureConfig({
            ...defaultPressureConfig,
            ...fetched,
            surface_factors: { ...defaultPressureConfig.surface_factors, ...(fetched.surface_factors || {}) },
            condition_factors: { ...defaultPressureConfig.condition_factors, ...(fetched.condition_factors || {}) },
          });
        }
      }
    }).catch(() => {}).finally(() => setPricingLoaded(true));
    if (isAdmin) loadPdfTemplate();
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

      {/* Pipeline Sync */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-orange-500" /> Sync Fence Staining Pipeline
          </CardTitle>
          <CardDescription>
            Pull leads from the <span className="font-medium">FENCE STAINING NEW AUTOMATION FLOW</span> pipeline —
            stages: <span className="font-medium">New Lead</span> and <span className="font-medium">HOT LEAD_SEND ESTIMATE</span>.
            New contacts are imported; existing ones have their priority updated.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={syncPipeline} disabled={syncingPipeline} className="gap-2 bg-orange-600 hover:bg-orange-700">
            <RefreshCw className={`h-4 w-4 ${syncingPipeline ? "animate-spin" : ""}`} />
            {syncingPipeline ? "Syncing pipeline..." : "Sync Pipeline Leads"}
          </Button>
          {pipelineResult && (
            <div className={`rounded-lg border p-4 text-sm space-y-1 ${pipelineResult.status === "error" ? "bg-red-50 border-red-200" : "bg-muted/50"}`}>
              {pipelineResult.status === "error" ? (
                <p className="text-red-700 font-medium">{(pipelineResult as unknown as { message: string }).message}</p>
              ) : (
                <>
                  <p className="font-medium text-muted-foreground">{pipelineResult.pipeline}</p>
                  <p className="text-xs text-muted-foreground">Stages: {(pipelineResult.stages_synced ?? []).join(", ")}</p>
                  <div className="pt-1 space-y-1">
                    <p className="text-green-700"><span className="font-medium">Imported:</span> {pipelineResult.imported} new leads</p>
                    <p className="text-muted-foreground"><span className="font-medium">Updated:</span> {pipelineResult.updated} existing leads</p>
                    {pipelineResult.errors > 0 && (
                      <p className="text-red-600"><span className="font-medium">Errors:</span> {pipelineResult.errors}</p>
                    )}
                  </div>
                </>
              )}
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
            Per-sqft rates by fence age. Signature is the recommended middle tier. Zone surcharges (+2% Blue, +5% Purple) and size surcharge (500–1,000 sqft range) are applied on top.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Fence Age</th>
                  <th className="text-center p-3 font-medium">Essential ($/sqft)</th>
                  <th className="text-center p-3 font-medium text-primary">Signature ★ ($/sqft)</th>
                  <th className="text-center p-3 font-medium">Legacy ($/sqft)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {([
                  ["brand_new", "Brand New"],
                  ["1_6yr", "1–6 Years"],
                  ["6_15yr", "6–15 Years"],
                ] as const).map(([bracket, label]) => (
                  <tr key={bracket} className="hover:bg-muted/20">
                    <td className="p-3 font-medium text-muted-foreground">{label}</td>
                    {(["essential", "signature", "legacy"] as const).map((tier) => (
                      <td key={tier} className="p-2 text-center">
                        <Input
                          type="number"
                          step="0.01"
                          className={`w-20 mx-auto text-center ${tier === "signature" ? "border-primary/50" : ""}`}
                          value={fenceConfig.tier_rates[bracket][tier]}
                          onChange={(e) => setFenceConfig((c) => ({
                            ...c,
                            tier_rates: {
                              ...c.tier_rates,
                              [bracket]: { ...c.tier_rates[bracket], [tier]: Number(e.target.value) },
                            },
                          }))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-sm font-medium whitespace-nowrap">Size surcharge ($/sqft, 500–1,000 sqft jobs)</label>
            <Input
              type="number"
              step="0.01"
              className="w-24"
              value={fenceConfig.size_surcharge_rate}
              onChange={(e) => setFenceConfig((c) => ({ ...c, size_surcharge_rate: Number(e.target.value) }))}
            />
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

      <Button onClick={savePricing} disabled={saving || !pricingLoaded} size="lg">
        {saving ? "Saving..." : !pricingLoaded ? "Loading..." : "Save All Settings"}
      </Button>

      {/* PDF Proposal Template — admin only */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              PDF Proposal Template
            </CardTitle>
            <CardDescription>
              Upload a branded PDF template and map where customer data fields appear. Used when sending PDF proposals.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {pdfTemplateLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : pdfTemplate && !showFieldMapper ? (
              /* Template exists — show info + actions */
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <FileText className="h-8 w-8 text-blue-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{pdfTemplate.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {pdfTemplate.page_count} pages &middot; Updated {new Date(pdfTemplate.updated_at).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {Object.keys(pdfTemplate.field_map).length} of 7 fields mapped
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setShowFieldMapper(true)} className="gap-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    Map Fields
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => pdfInputRef.current?.click()}
                    disabled={pdfUploading}
                  >
                    <Upload className="h-3.5 w-3.5 mr-1" />
                    {pdfUploading ? "Uploading..." : "Replace"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 hover:text-red-700"
                    onClick={handlePdfDelete}
                    disabled={pdfDeleting}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {pdfDeleting ? "Deleting..." : "Delete"}
                  </Button>
                </div>
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePdfUpload(f);
                    e.target.value = "";
                  }}
                />
              </div>
            ) : showFieldMapper && pdfTemplate ? (
              /* Field mapper open */
              <PdfFieldMapper
                template={pdfTemplate}
                onSaved={() => {
                  toast.success("Field mappings saved");
                  loadPdfTemplate();
                }}
                onClose={() => setShowFieldMapper(false)}
              />
            ) : (
              /* No template — upload zone */
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const f = e.dataTransfer.files[0];
                  if (f) handlePdfUpload(f);
                }}
                onClick={() => pdfInputRef.current?.click()}
              >
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm font-medium">
                  {pdfUploading ? "Uploading..." : "Drag & drop your PDF template here"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse &middot; PDF only &middot; max 15MB</p>
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePdfUpload(f);
                    e.target.value = "";
                  }}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Danger Zone — admin only */}
      {isAdmin && (
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="text-red-700">Danger Zone</CardTitle>
            <CardDescription>
              Archive all current leads so the dashboard is cleared. Leads are hidden, not deleted — they can be restored directly in the database if needed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={archiveAll} disabled={archiving} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${archiving ? "animate-spin" : ""}`} />
              {archiving ? "Archiving..." : "Archive All Leads"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
