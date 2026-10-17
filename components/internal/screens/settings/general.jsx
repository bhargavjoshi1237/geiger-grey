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
import { ModelIdSelect } from "@/components/internal/shared/model_id_select";
import { useProject } from "@/context/project-context";
import { useCan } from "@/context/rbac-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { PROVIDER_KINDS, hasCapability, suggestedModelsFor } from "@/lib/grey/provider_kinds";
import { getProjectSettings, saveProjectSettings } from "@/lib/supabase/project_settings";
import { listPresets } from "@/lib/supabase/ingestion_presets";
import { listProviders } from "@/lib/supabase/model_providers";

const NONE = "none";

// Chat suggestions for a connection: its own model ids first, then the kind's.
function chatSuggestions(provider) {
  if (!provider) return [];
  const own = (provider.models || []).map((id) => ({ id, label: id }));
  const seen = new Set(own.map((m) => m.id));
  return [...own, ...suggestedModelsFor(provider, "chat").filter((m) => !seen.has(m.id))];
}

// Settings → General. Project-wide defaults that seed every new knowledge
// base (which preset to start from), the project's processing and
// transcription models, how long sources are retained, and whether queries
// are logged to Request Logs.

export function GeneralSettingsScreen() {
  const { project, projectId } = useProject();
  const canManage = useCan("grey.settings.manage");
  const { setTab } = useWorkspaceUrl();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [presets, setPresets] = useState([]);
  const [providers, setProviders] = useState([]);
  // null from getProjectSettings means the read failed (not "no row yet",
  // which comes back as a defaults object) — never let the draft's built-in
  // defaults overwrite real settings in that case, so editing is blocked.
  const [settingsError, setSettingsError] = useState(false);
  const [draft, setDraft] = useState({
    defaultPresetId: null,
    retentionDays: 0,
    logQueries: true,
    processingProviderId: null,
    processingModel: null,
    transcriptionProviderId: null,
    transcriptionModel: null,
  });

  useEffect(() => {
    let alive = true;
    Promise.all([getProjectSettings(projectId), listPresets(projectId), listProviders(projectId)]).then(
      ([settings, presetRows, providerRows]) => {
        if (!alive) return;
        setSettingsError(settings === null);
        if (settings) {
          setDraft({
            defaultPresetId: settings.defaultPresetId ?? null,
            retentionDays: settings.retentionDays ?? 0,
            logQueries: settings.logQueries ?? true,
            processingProviderId: settings.processingProviderId ?? null,
            processingModel: settings.processingModel ?? null,
            transcriptionProviderId: settings.transcriptionProviderId ?? null,
            transcriptionModel: settings.transcriptionModel ?? null,
          });
        }
        setPresets(presetRows ?? []);
        setProviders(providerRows ?? []);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [projectId]);

  const controlsDisabled = !canManage || settingsError;

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const chatProviders = providers.filter((p) => hasCapability(p, "chat"));
  const transcribeProviders = providers.filter((p) => hasCapability(p, "transcribe"));
  const processingProvider = chatProviders.find((p) => p.id === draft.processingProviderId) || null;
  const transcriptionProvider = transcribeProviders.find((p) => p.id === draft.transcriptionProviderId) || null;

  const pickProcessingProvider = (value) => {
    const next = chatProviders.find((p) => p.id === value) || null;
    setDraft((d) => ({ ...d, processingProviderId: next?.id ?? null, processingModel: chatSuggestions(next)[0]?.id ?? null }));
  };

  const pickTranscriptionProvider = (value) =>
    setDraft((d) => ({ ...d, transcriptionProviderId: value === NONE ? null : value, transcriptionModel: null }));

  const connectLink = (
    <button
      type="button"
      onClick={() => setTab("Model Providers")}
      className="font-medium text-text-secondary underline-offset-2 hover:text-foreground hover:underline"
    >
      Model Providers
    </button>
  );

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
        description="Defaults for new knowledge bases, the project's models and how long sources are kept."
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
        </div>
      </SectionCard>

      <SectionCard
        title="Models"
        description="Project-wide models, called through your own provider connections."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Processing connection"
            hint={
              chatProviders.length ? (
                "Graph extraction, contextual enrichment and evaluation judging. A small, fast model such as Claude Haiku 5.5 works well."
              ) : (
                <>No chat-capable connection yet — add one in {connectLink}.</>
              )
            }
          >
            <Select
              value={draft.processingProviderId || NONE}
              disabled={controlsDisabled}
              onValueChange={pickProcessingProvider}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {chatProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Processing model" htmlFor="processing-model">
            {processingProvider ? (
              <ModelIdSelect
                key={processingProvider.id}
                inputId="processing-model"
                value={draft.processingModel || ""}
                disabled={controlsDisabled}
                onChange={(v) => set("processingModel")(v || null)}
                suggestions={chatSuggestions(processingProvider)}
              />
            ) : (
              <Input id="processing-model" value="" placeholder="Choose a connection first" disabled />
            )}
          </Field>

          <Field
            label="Transcription connection"
            hint={
              transcribeProviders.length ? (
                "Audio and video sources. Automatic uses your only transcription connection."
              ) : (
                <>No transcription connection yet (e.g. AssemblyAI) — add one in {connectLink}.</>
              )
            }
          >
            <Select
              value={draft.transcriptionProviderId || NONE}
              disabled={controlsDisabled}
              onValueChange={pickTranscriptionProvider}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Automatic</SelectItem>
                {transcribeProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Transcription model" htmlFor="transcription-model">
            {transcriptionProvider ? (
              <ModelIdSelect
                key={transcriptionProvider.id}
                inputId="transcription-model"
                value={draft.transcriptionModel || ""}
                disabled={controlsDisabled}
                onChange={(v) => set("transcriptionModel")(v || null)}
                suggestions={suggestedModelsFor(transcriptionProvider, "transcribe")}
                noneLabel={PROVIDER_KINDS[transcriptionProvider.provider]?.defaultModelLabel?.transcribe || "Provider default"}
              />
            ) : (
              <Input id="transcription-model" value="" placeholder="Provider default" disabled />
            )}
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
