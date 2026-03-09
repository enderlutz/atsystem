"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, type LeadDetail } from "@/lib/api";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ArrowLeft, MapPin, ExternalLink, Phone, Mail, User, CheckCircle2, MessageSquare, Tag, Calculator, RefreshCw } from "lucide-react";

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

const FENCE_SIDES = {
  Inside: ["Inside Front", "Inside Left", "Inside Back", "Inside Right"],
  Outside: ["Outside Front", "Outside Left", "Outside Back", "Outside Right"],
};

const APPROVAL_CONFIG = {
  green: { label: "Ready to Send", classes: "bg-green-50 border-green-300 text-green-800", dot: "bg-green-500" },
  yellow: { label: "Add-ons Pending", classes: "bg-yellow-50 border-yellow-300 text-yellow-800", dot: "bg-yellow-500" },
  red: { label: "Needs Review", classes: "bg-red-50 border-red-300 text-red-800", dot: "bg-red-500" },
} as const;

const selectCls = "w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring";

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [vaNotes, setVaNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [checkingResponse, setCheckingResponse] = useState(false);
  const [responseResult, setResponseResult] = useState<string | null>(null);

  // Estimate inputs state
  const [linearFeet, setLinearFeet] = useState("");
  const [fenceHeight, setFenceHeight] = useState("6ft standard");
  const [fenceAge, setFenceAge] = useState("1-6 years");
  const [previouslyStained, setPreviouslyStained] = useState("No");
  const [timeline, setTimeline] = useState("");
  const [additionalServices, setAdditionalServices] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [confidencePct, setConfidencePct] = useState("100");
  const [fenceSides, setFenceSides] = useState<string[]>([]);
  const [savingEstimate, setSavingEstimate] = useState(false);
  const [additionalServicesSent, setAdditionalServicesSent] = useState(false);
  const [markingAddons, setMarkingAddons] = useState(false);

  useEffect(() => {
    api.getLead(id).then((data) => {
      setLead(data);
      setVaNotes(data.va_notes || "");
      const fd = data.form_data || {};
      setLinearFeet(String(fd.linear_feet || ""));
      setFenceHeight(String(fd.fence_height || "6ft standard"));
      setFenceAge(String(fd.fence_age || "1-6 years"));
      setPreviouslyStained(String(fd.previously_stained || "No"));
      setTimeline(String(fd.service_timeline || fd.timeframe || ""));
      setAdditionalServices(String(fd.additional_services || ""));
      setZipCode(String(fd.zip_code || ""));
      setConfidencePct(String(fd.confident_pct ?? 100));
      const rawSides = fd.fence_sides;
      if (Array.isArray(rawSides)) setFenceSides(rawSides);
      else if (typeof rawSides === "string" && rawSides) setFenceSides(rawSides.split(",").map((s: string) => s.trim()));
      else setFenceSides([]);
      setAdditionalServicesSent(data.estimate?.additional_services_sent ?? false);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  const toggleFenceSide = (side: string) => {
    setFenceSides((prev) =>
      prev.includes(side) ? prev.filter((s) => s !== side) : [...prev, side]
    );
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

  const handleCheckResponse = async () => {
    if (!lead) return;
    setCheckingResponse(true);
    try {
      const result = await api.checkResponse(lead.id);
      if (result.responded) {
        setResponseResult(result.latest || "Customer responded");
        setLead({ ...lead, customer_responded: true, customer_response_text: result.latest || "" });
      } else {
        setResponseResult("No response yet");
      }
    } catch (e) {
      console.error(e);
      setResponseResult("Failed to check");
    }
    setCheckingResponse(false);
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

      const updated = await api.updateLeadFormData(lead.id, formData);
      setLead(updated);
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

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/leads">
            <ArrowLeft className="h-4 w-4 mr-1" /> Leads
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{lead.contact_name || lead.address}</h1>
          <p className="text-muted-foreground text-sm">Lead #{lead.id.slice(0, 8)} · {formatDate(lead.created_at)}</p>
        </div>
      </div>

      {/* Contact Info */}
      {(lead.contact_name || lead.contact_phone || lead.contact_email) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4" /> Contact Info
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6">
            {lead.contact_name && (
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{lead.contact_name}</span>
              </div>
            )}
            {lead.contact_phone && (
              <a href={`tel:${lead.contact_phone}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                <Phone className="h-4 w-4" />
                {lead.contact_phone}
              </a>
            )}
            {lead.contact_email && (
              <a href={`mailto:${lead.contact_email}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                <Mail className="h-4 w-4" />
                {lead.contact_email}
              </a>
            )}
          </CardContent>
        </Card>
      )}

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
              <label className="text-sm font-medium">Confidence Score (%)</label>
              <Input
                type="number"
                min={0}
                max={100}
                placeholder="e.g. 85"
                value={confidencePct}
                onChange={(e) => setConfidencePct(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Below 80% → Needs Review</p>
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
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Additional Services</label>
            <Input
              placeholder="e.g. gate painting, pressure washing (leave blank if none)"
              value={additionalServices}
              onChange={(e) => setAdditionalServices(e.target.value)}
            />
          </div>

          <Button onClick={handleSaveEstimateInputs} disabled={savingEstimate} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${savingEstimate ? "animate-spin" : ""}`} />
            {savingEstimate ? "Recalculating..." : "Save & Recalculate Estimate"}
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
                {est.status}
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
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <p className="text-3xl font-bold">
                {est.estimate_low > 0
                  ? `${formatCurrency(est.estimate_low)}–${formatCurrency(est.estimate_high)}`
                  : "—"}
              </p>
              <Button asChild>
                <Link href={`/estimates/${est.id}`}>
                  {est.status === "pending" ? "Review & Send" : "View Estimate"}
                </Link>
              </Button>
            </div>
            {approvalStatus === "yellow" && (
              <div className="flex items-center justify-between pt-1 border-t">
                <p className="text-sm text-muted-foreground">Additional services pricing</p>
                {additionalServicesSent ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" /> Sent Additional Proposal
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

      {/* Customer Response */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Customer Response
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lead.customer_responded ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-green-700">
                <CheckCircle2 className="h-4 w-4" /> Customer has responded
              </div>
              {lead.customer_response_text && (
                <div className="p-3 rounded-lg bg-muted text-sm">
                  &ldquo;{lead.customer_response_text}&rdquo;
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">No response detected yet</p>
              <Button size="sm" variant="outline" onClick={handleCheckResponse} disabled={checkingResponse}>
                {checkingResponse ? "Checking..." : "Check for Response"}
              </Button>
            </div>
          )}
          {responseResult && !lead.customer_responded && (
            <p className="text-sm text-muted-foreground mt-2">{responseResult}</p>
          )}
        </CardContent>
      </Card>

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
    </div>
  );
}
