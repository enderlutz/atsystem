"use client";

import { useEffect, useState, useCallback } from "react";
import { api, type StageTemplateMessage } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Save, RotateCcw, Eye, Send, Plus, Trash2, Loader2 } from "lucide-react";

interface TemplateEditorProps {
  stage: string;
  stageLabel: string;
  branch?: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const DELAY_UNITS = [
  { label: "seconds", mult: 1 },
  { label: "minutes", mult: 60 },
  { label: "hours", mult: 3600 },
  { label: "days", mult: 86400 },
];

function bestUnit(seconds: number): { value: number; unit: string } {
  if (seconds === 0) return { value: 0, unit: "seconds" };
  if (seconds % 86400 === 0) return { value: seconds / 86400, unit: "days" };
  if (seconds % 3600 === 0) return { value: seconds / 3600, unit: "hours" };
  if (seconds % 60 === 0) return { value: seconds / 60, unit: "minutes" };
  return { value: seconds, unit: "seconds" };
}

const PLACEHOLDER_HINTS = [
  "{first_name}", "{proposal_link}", "{date}", "{address}", "{month}",
  "{review_link}", "{incentive}", "{referral_bonus}", "{stripe_link}",
  "{entry_color_name}", "{signature_color_chart}", "{legacy_color_chart}",
  "{color_1}", "{color_2}", "{selected_tier}",
];

interface EditableMessage {
  delay_value: number;
  delay_unit: string;
  message_body: string;
}

export default function TemplateEditor({ stage, stageLabel, branch, open, onClose, onSaved }: TemplateEditorProps) {
  const [messages, setMessages] = useState<EditableMessage[]>([]);
  const [isOverridden, setIsOverridden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [previewLoading, setPreviewLoading] = useState<number | null>(null);
  const [testSending, setTestSending] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getStageTemplates(stage, branch || undefined);
      setIsOverridden(data.is_overridden);
      setMessages(
        data.messages.map((m) => {
          const { value, unit } = bestUnit(m.delay_seconds);
          return { delay_value: value, delay_unit: unit, message_body: m.message_body };
        })
      );
      setPreviews({});
    } catch (e) {
      console.error("Failed to load templates:", e);
    } finally {
      setLoading(false);
    }
  }, [stage, branch]);

  useEffect(() => {
    if (open) loadTemplates();
  }, [open, loadTemplates]);

  if (!open) return null;

  const toSeconds = (msg: EditableMessage): number => {
    const u = DELAY_UNITS.find((u) => u.label === msg.delay_unit);
    return msg.delay_value * (u?.mult || 1);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveStageTemplates(stage, {
        branch: branch || null,
        messages: messages.map((m) => ({
          delay_seconds: toSeconds(m),
          message_body: m.message_body,
        })),
      });
      setIsOverridden(true);
      onSaved();
    } catch (e) {
      console.error("Failed to save templates:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await api.resetStageTemplates(stage, branch || undefined);
      await loadTemplates();
      onSaved();
    } catch (e) {
      console.error("Failed to reset templates:", e);
    } finally {
      setResetting(false);
    }
  };

  const handlePreview = async (index: number) => {
    setPreviewLoading(index);
    try {
      const result = await api.previewTemplate(messages[index].message_body);
      setPreviews((prev) => ({ ...prev, [index]: result.rendered }));
    } catch (e) {
      console.error("Preview failed:", e);
    } finally {
      setPreviewLoading(null);
    }
  };

  const handleTestSend = async (index: number) => {
    setTestSending(index);
    setTestResult(null);
    try {
      const result = await api.testSendTemplate(messages[index].message_body, { stage, sequenceIndex: index });
      setTestResult(`Test SMS sent: "${result.rendered.slice(0, 60)}..."`);
      setTimeout(() => setTestResult(null), 5000);
    } catch (e) {
      setTestResult("Failed to send test SMS. Check test_sms_contact_id in workflow config.");
      setTimeout(() => setTestResult(null), 5000);
    } finally {
      setTestSending(null);
    }
  };

  const updateMessage = (index: number, field: keyof EditableMessage, value: string | number) => {
    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: value } : m))
    );
    // Clear preview when body changes
    if (field === "message_body") {
      setPreviews((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
    }
  };

  const addMessage = () => {
    setMessages((prev) => [...prev, { delay_value: 1, delay_unit: "hours", message_body: "" }]);
  };

  const removeMessage = (index: number) => {
    setMessages((prev) => prev.filter((_, i) => i !== index));
  };

  const formatDelay = (msg: EditableMessage): string => {
    if (msg.delay_value === 0) return "Immediate";
    return `${msg.delay_value} ${msg.delay_unit}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-2xl bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{stageLabel}</h2>
            <Badge variant={isOverridden ? "default" : "secondary"}>
              {isOverridden ? "Customized" : "Default"}
            </Badge>
            {branch && (
              <Badge variant="outline" className="capitalize">
                {branch}
              </Badge>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Placeholder hints */}
              <div className="text-xs text-muted-foreground bg-gray-50 rounded-lg p-3">
                <span className="font-medium">Available placeholders: </span>
                {PLACEHOLDER_HINTS.map((p) => (
                  <code key={p} className="mx-0.5 px-1 py-0.5 bg-white border rounded text-xs">
                    {p}
                  </code>
                ))}
              </div>

              {/* Messages */}
              {messages.map((msg, i) => (
                <Card key={i} className="relative">
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                          {i + 1}
                        </span>
                        <span className="text-muted-foreground">{formatDelay(msg)}</span>
                      </span>
                      {messages.length > 1 && (
                        <button
                          onClick={() => removeMessage(i)}
                          className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    {/* Delay */}
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-muted-foreground w-12">Delay</label>
                      <input
                        type="number"
                        min="0"
                        value={msg.delay_value}
                        onChange={(e) => updateMessage(i, "delay_value", parseInt(e.target.value) || 0)}
                        className="w-20 border rounded px-2 py-1 text-sm"
                      />
                      <select
                        value={msg.delay_unit}
                        onChange={(e) => updateMessage(i, "delay_unit", e.target.value)}
                        className="border rounded px-2 py-1 text-sm bg-white"
                      >
                        {DELAY_UNITS.map((u) => (
                          <option key={u.label} value={u.label}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Message body */}
                    <textarea
                      value={msg.message_body}
                      onChange={(e) => updateMessage(i, "message_body", e.target.value)}
                      rows={4}
                      className="w-full border rounded-lg px-3 py-2 text-sm resize-y focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                      placeholder="Enter SMS message template..."
                    />

                    {/* Preview / Test buttons */}
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePreview(i)}
                        disabled={previewLoading === i || !msg.message_body}
                      >
                        {previewLoading === i ? (
                          <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                        ) : (
                          <Eye className="h-3 w-3 mr-1.5" />
                        )}
                        Preview
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestSend(i)}
                        disabled={testSending === i || !msg.message_body}
                      >
                        {testSending === i ? (
                          <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                        ) : (
                          <Send className="h-3 w-3 mr-1.5" />
                        )}
                        Send Test SMS
                      </Button>
                    </div>

                    {/* Preview result */}
                    {previews[i] && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                        <div className="text-xs font-medium text-green-700 mb-1">Preview:</div>
                        <div className="text-green-900 whitespace-pre-wrap">{previews[i]}</div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}

              {/* Add message button */}
              <button
                onClick={addMessage}
                className="w-full border-2 border-dashed border-gray-200 rounded-lg py-3 text-sm text-muted-foreground hover:border-blue-300 hover:text-blue-600 flex items-center justify-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Message Step
              </button>
            </>
          )}
        </div>

        {/* Test result toast */}
        {testResult && (
          <div className="mx-5 mb-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700">
            {testResult}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t bg-gray-50">
          <div>
            {isOverridden && (
              <Button variant="outline" size="sm" onClick={handleReset} disabled={resetting}>
                {resetting ? (
                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3 w-3 mr-1.5" />
                )}
                Reset to Default
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || messages.length === 0}>
              {saving ? (
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
              ) : (
                <Save className="h-3 w-3 mr-1.5" />
              )}
              Save Templates
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
