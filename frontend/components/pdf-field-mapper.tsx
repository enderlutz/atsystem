"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, FieldPosition, PdfTemplateInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Save, X, Eye, RotateCcw } from "lucide-react";

const FIELDS = [
  { key: "customer_name", label: "Customer Name", defaultFontSize: 12 },
  { key: "essential_price", label: "Essential Price", defaultFontSize: 12 },
  { key: "signature_price", label: "Signature Price", defaultFontSize: 12 },
  { key: "legacy_price", label: "Legacy Price", defaultFontSize: 12 },
  { key: "essential_monthly", label: "Essential Monthly", defaultFontSize: 10 },
  { key: "signature_monthly", label: "Signature Monthly", defaultFontSize: 10 },
  { key: "legacy_monthly", label: "Legacy Monthly", defaultFontSize: 10 },
] as const;

// Distinct colors for each field marker
const FIELD_COLORS: Record<string, string> = {
  customer_name: "#EF4444",
  essential_price: "#22C55E",
  signature_price: "#3B82F6",
  legacy_price: "#A855F7",
  essential_monthly: "#F97316",
  signature_monthly: "#06B6D4",
  legacy_monthly: "#EC4899",
};

interface Props {
  template: PdfTemplateInfo;
  onSaved: () => void;
  onClose: () => void;
}

export default function PdfFieldMapper({ template, onSaved, onClose }: Props) {
  const [currentPage, setCurrentPage] = useState(0);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [fieldMap, setFieldMap] = useState<Record<string, FieldPosition>>(
    () => ({ ...template.field_map })
  );
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get page dimensions in PDF points
  const pageWidth = template.page_widths?.[currentPage] ?? 612;
  const pageHeight = template.page_heights?.[currentPage] ?? 792;

  // Auth header for image requests
  const [authToken, setAuthToken] = useState<string | null>(null);
  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)at_auth=([^;]*)/);
    setAuthToken(match ? decodeURIComponent(match[1]) : null);
  }, []);

  // Load page image via fetch with auth header (since <img> can't set Authorization)
  const [pageImageUrl, setPageImageUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setImgLoaded(false);
    setPageImageUrl(null);

    const loadPage = async () => {
      try {
        const headers: Record<string, string> = {};
        if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
        const res = await fetch(api.getPdfTemplatePageUrl(currentPage), { headers });
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setPageImageUrl(url);
      } catch {
        // ignore
      }
    };
    loadPage();
    return () => { cancelled = true; };
  }, [currentPage, authToken]);

  // Clean up blob URLs
  useEffect(() => {
    return () => {
      if (pageImageUrl) URL.revokeObjectURL(pageImageUrl);
    };
  }, [pageImageUrl]);

  const handleImageClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!activeField || !imgRef.current) return;

      const img = imgRef.current;
      const rect = img.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Convert pixel click to PDF point coordinates
      const displayWidth = rect.width;
      const displayHeight = rect.height;
      const pdfX = (clickX / displayWidth) * pageWidth;
      const pdfY = (clickY / displayHeight) * pageHeight;

      const existing = fieldMap[activeField];
      const fontSize = existing?.font_size ?? FIELDS.find(f => f.key === activeField)?.defaultFontSize ?? 12;

      setFieldMap((prev) => ({
        ...prev,
        [activeField]: { page: currentPage, x: pdfX, y: pdfY, font_size: fontSize },
      }));

      // Auto-advance to next unmapped field
      const currentIdx = FIELDS.findIndex((f) => f.key === activeField);
      const nextUnmapped = FIELDS.find(
        (f, i) => i > currentIdx && !fieldMap[f.key] && f.key !== activeField
      );
      setActiveField(nextUnmapped?.key ?? null);
    },
    [activeField, fieldMap, currentPage, pageWidth, pageHeight]
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.savePdfFieldMap(fieldMap);
      onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const blob = await api.previewPdf();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  const clearField = (key: string) => {
    setFieldMap((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const updateFontSize = (key: string, size: number) => {
    setFieldMap((prev) => {
      if (!prev[key]) return prev;
      return { ...prev, [key]: { ...prev[key], font_size: size } };
    });
  };

  // Markers for fields placed on the current page
  const currentPageMarkers = FIELDS.filter(
    (f) => fieldMap[f.key] && fieldMap[f.key].page === currentPage
  );

  const mappedCount = FIELDS.filter((f) => fieldMap[f.key]).length;

  return (
    <div className="border rounded-lg bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-sm">Map Fields</h3>
          <span className="text-xs text-muted-foreground">
            {mappedCount} of {FIELDS.length} mapped
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handlePreview} disabled={previewing || mappedCount === 0}>
            <Eye className="h-3.5 w-3.5 mr-1" />
            {previewing ? "Generating..." : "Preview"}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="h-3.5 w-3.5 mr-1" />
            {saving ? "Saving..." : "Save Mappings"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex" style={{ minHeight: "600px" }}>
        {/* Left — PDF page image */}
        <div className="flex-1 flex flex-col border-r">
          {/* Page navigation */}
          <div className="flex items-center justify-center gap-3 py-2 border-b bg-gray-50">
            <Button
              size="sm"
              variant="ghost"
              disabled={currentPage === 0}
              onClick={() => setCurrentPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium">
              Page {currentPage + 1} of {template.page_count}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={currentPage >= template.page_count - 1}
              onClick={() => setCurrentPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Image area */}
          <div
            ref={containerRef}
            className="relative flex-1 overflow-auto bg-gray-200 cursor-crosshair p-4"
            onClick={handleImageClick}
          >
            {activeField && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-black/80 text-white text-xs px-3 py-1.5 rounded-full">
                Click to place: <strong>{FIELDS.find((f) => f.key === activeField)?.label}</strong>
              </div>
            )}
            {pageImageUrl ? (
              <div className="relative inline-block">
                <img
                  ref={imgRef}
                  src={pageImageUrl}
                  alt={`Page ${currentPage + 1}`}
                  className="max-w-full shadow-lg"
                  onLoad={() => setImgLoaded(true)}
                  draggable={false}
                />
                {/* Field markers */}
                {imgLoaded &&
                  imgRef.current &&
                  currentPageMarkers.map((f) => {
                    const pos = fieldMap[f.key];
                    const img = imgRef.current!;
                    const displayWidth = img.clientWidth;
                    const displayHeight = img.clientHeight;
                    const left = (pos.x / pageWidth) * displayWidth;
                    const top = (pos.y / pageHeight) * displayHeight;
                    const color = FIELD_COLORS[f.key] || "#EF4444";

                    return (
                      <div
                        key={f.key}
                        className="absolute pointer-events-none"
                        style={{ left: `${left}px`, top: `${top}px`, transform: "translate(-4px, -4px)" }}
                      >
                        <div
                          className="w-3 h-3 rounded-full border-2 border-white shadow-md"
                          style={{ backgroundColor: color }}
                        />
                        <span
                          className="absolute left-4 -top-0.5 text-[10px] font-bold whitespace-nowrap px-1 rounded"
                          style={{ backgroundColor: color, color: "white" }}
                        >
                          {f.label}
                        </span>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Loading page...
              </div>
            )}
          </div>
        </div>

        {/* Right — Field list */}
        <div className="w-72 flex flex-col bg-gray-50">
          <div className="px-3 py-2 border-b">
            <p className="text-xs text-muted-foreground">
              Click a field below, then click on the PDF to place it.
            </p>
          </div>
          <div className="flex-1 overflow-auto">
            {FIELDS.map((f) => {
              const mapped = fieldMap[f.key];
              const isActive = activeField === f.key;
              const color = FIELD_COLORS[f.key] || "#EF4444";

              return (
                <div
                  key={f.key}
                  className={`px-3 py-2.5 border-b cursor-pointer transition-colors ${
                    isActive ? "bg-blue-50 border-l-4 border-l-blue-500" : "hover:bg-gray-100"
                  }`}
                  onClick={() => setActiveField(isActive ? null : f.key)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: mapped ? color : "#D1D5DB" }}
                      />
                      <span className="text-sm font-medium">{f.label}</span>
                    </div>
                    {mapped && (
                      <button
                        className="text-gray-400 hover:text-red-500 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearField(f.key);
                        }}
                        title="Clear placement"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {mapped ? (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-muted-foreground">
                        Page {mapped.page + 1} ({Math.round(mapped.x)}, {Math.round(mapped.y)})
                      </span>
                      <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        Size:
                        <input
                          type="number"
                          min={6}
                          max={48}
                          value={mapped.font_size}
                          onChange={(e) => updateFontSize(f.key, Number(e.target.value))}
                          onClick={(e) => e.stopPropagation()}
                          className="w-10 px-1 py-0 text-[10px] border rounded bg-white"
                        />
                      </label>
                    </div>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">Not mapped</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
