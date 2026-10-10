"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Save } from "lucide-react";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import {
  ScreenHeader,
  SectionCard,
  SettingsList,
  SettingRow,
  Field,
} from "@/components/internal/shared/screen_kit";
import { Button } from "@geiger/ui/button";
import { Input } from "@geiger/ui/input";
import { Switch } from "@geiger/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@geiger/ui/select";
import { LoadingArea } from "@geiger/ui";
import { useProject } from "@/context/project-context";
import { useCan } from "@/context/rbac-context";
import { getProjectSettings, saveProjectSettings } from "@/lib/supabase/project_settings";
import { listPresets } from "@/lib/supabase/ingestion_presets";

const EMBEDDING_MODEL_OPTIONS = [
  { value: "cohere-embed-5-pro", label: "Cohere Embed 5 Pro" },
  { value: "cohere-embed-5-fast", label: "Cohere Embed 5 Fast" },
  { value: "openai-text-embedding-3-large", label: "OpenAI text-embedding-3-large" },
  { value: "voyage-3.5", label: "Voyage 3.5" },
];

// Settings → General. Project-wide defaults that seed every new knowledge
// base: which preset and embedding model to start from, how long sources are
// retained, and whether queries are logged to Request Logs.

export function GeneralSettingsScreen() {
  const { project, projectId } = useProject();
  const canManage = useCan("grey.settings.manage");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [presets, setPresets] = useState([]);
  // null from getProjectSettings means the read failed (not "no row yet",
  // which comes back as a defaults object) — never let the draft's built-in
  // defaults overwrite real settings in that case, so editing is blocked.
  const [settingsError, setSettingsError] = useState(false);
  const [draft, setDraft] = useState({
    defaultPresetId: null,
    defaultEmbeddingModel: "cohere-embed-5-pro",
    retentionDays: 0,
    logQueries: true,
  });

  useEffect(() => {
    let alive = true;
    Promise.all([getProjectSettings(projectId), listPresets(projectId)]).then(
      ([settings, presetRows]) => {
        if (!alive) return;
        setSettingsError(settings === null);
        if (settings) {
          setDraft({
            defaultPresetId: settings.defaultPresetId ?? null,
            defaultEmbeddingModel: settings.defaultEmbeddingModel ?? "cohere-embed-5-pro",
            retentionDays: settings.retentionDays ?? 0,
            logQueries: settings.logQueries ?? true,
          });
        }
        setPresets(presetRows ?? []);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [projectId]);

  const controlsDisabled = !canManage || settingsError;

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const handleSave = async () => {
    if (settingsError) return;
    setSaving(true);
    const saved = await saveProjectSettings(projectId, draft);
    setSaving(false);
    if (saved) toast.success("Settings saved");
    else toast.error("Couldn't save settings.");
  };

  if (loading) {
    return (
      <MainScreenWrapper>
        <ScreenHeader title="General" description="Project defaults and information." />
        <LoadingArea label="Loading settings" />
      </MainScreenWrapper>
    );
  }

  const saveAction = canManage ? (
    <Button onClick={handleSave} disabled={saving || settingsError} className="bg-primary text-primary-foreground">
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      Save changes
    </Button>
  ) : null;

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="General"
        description="Defaults for new knowledge bases and how long sources are kept."
        actions={saveAction}
      />

      {settingsError ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs leading-relaxed text-destructive-text">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            Couldn&apos;t load this project&apos;s settings. Editing is disabled until this loads
            successfully — reload the page to try again.
          </p>
        </div>
      ) : null}

      <SectionCard title="Project" description="Read-only identifiers for this project.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={project?.name || ""} readOnly disabled />
          </Field>
          <Field label="Project ID">
            <Input value={projectId || ""} readOnly disabled className="font-mono text-xs" />
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        title="Ingestion defaults"
        description="New knowledge bases start from these unless changed at creation."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default ingestion preset">
            <Select
              value={draft.defaultPresetId || "none"}
              disabled={controlsDisabled}
              onValueChange={(v) => set("defaultPresetId")(v === "none" ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="No default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No default</SelectItem>
                {presets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Default embedding model">
            <Select
              value={draft.defaultEmbeddingModel}
              disabled={controlsDisabled}
              onValueChange={set("defaultEmbeddingModel")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMBEDDING_MODEL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Retention & logging">
        <SettingsList>
          <SettingRow
            title="Retention period"
            description="Days a source's chunks are kept before they're eligible for cleanup. 0 means keep forever."
            control={
              // Stepper controls only render when this account can actually
              // save a change; otherwise they'd look live but do nothing.
              <Field
                stepper={!controlsDisabled}
                value={draft.retentionDays}
                onValueChange={controlsDisabled ? undefined : (v) => set("retentionDays")(Number(v) || 0)}
                min={0}
                max={3650}
              >
                <Input
                  type="number"
                  className="w-20 text-right"
                  value={draft.retentionDays}
                  disabled={controlsDisabled}
                  onChange={(e) => set("retentionDays")(Number(e.target.value) || 0)}
                />
              </Field>
            }
          />
          <SettingRow
            title="Log queries"
            description="Record every playground and API query in Request Logs."
            control={
              <Switch
                checked={draft.logQueries}
                disabled={controlsDisabled}
                onCheckedChange={set("logQueries")}
              />
            }
          />
        </SettingsList>
      </SectionCard>
    </MainScreenWrapper>
  );
}

export default GeneralSettingsScreen;
