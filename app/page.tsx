"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_APIFY_DELAY_SECONDS,
  DEFAULT_CHATGPT_PROMPT,
  DEFAULT_GEMINI_SEEDANCE_PROMPT,
} from "@/lib/prompts";
import type { PipelineOutputs } from "@/lib/pipeline-types";
import styles from "./page.module.css";

const STEP_COUNT = 7;

type StepOutputs = {
  1?: { reelVideoUrl: string };
  2?: { frameBase64: string };
  3?: { nanoBananaJson: string };
  4?: { nanoBananaImageUrl: string };
  5?: { seedanceJson: string };
  6?: { seedanceVideoBase64: string };
  7?: { videoBase64: string; mimeType: string };
};

type StepKey = keyof StepOutputs;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const b64 = result.includes(",") ? result.split(",")[1]! : result;
      resolve(b64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function base64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function useObjectUrl(
  source: string | undefined,
  kind: "url" | "image" | "video",
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!source) {
      setUrl(null);
      return;
    }
    if (kind === "url") {
      setUrl(source);
      return;
    }
    const mime = kind === "image" ? "image/jpeg" : "video/mp4";
    const blob = base64ToBlob(source, mime);
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [source, kind]);
  return url;
}

function buildPrior(
  outputs: StepOutputs,
  edits: { nanoBananaJson: string; seedanceJson: string },
): PipelineOutputs {
  return {
    reelVideoUrl: outputs[1]?.reelVideoUrl,
    frameBase64: outputs[2]?.frameBase64,
    nanoBananaJson: edits.nanoBananaJson || outputs[3]?.nanoBananaJson,
    nanoBananaImageUrl: outputs[4]?.nanoBananaImageUrl,
    seedanceJson: edits.seedanceJson || outputs[5]?.seedanceJson,
    seedanceVideoBase64: outputs[6]?.seedanceVideoBase64,
  };
}

export default function HomePage() {
  const [reelUrl, setReelUrl] = useState("");
  const [apifyDelaySeconds, setApifyDelaySeconds] = useState(
    DEFAULT_APIFY_DELAY_SECONDS,
  );
  const [chatgptPrompt, setChatgptPrompt] = useState(DEFAULT_CHATGPT_PROMPT);
  const [chatgptExtraAppend, setChatgptExtraAppend] = useState("");
  const [geminiPrompt, setGeminiPrompt] = useState(DEFAULT_GEMINI_SEEDANCE_PROMPT);
  const [geminiExtraAppend, setGeminiExtraAppend] = useState("");
  const [seedanceExtraAppend, setSeedanceExtraAppend] = useState("");
  const [caption, setCaption] = useState("");

  const [nanoBananaRefImages, setNanoBananaRefImages] = useState<string[]>([]);
  const [seedanceRefImages, setSeedanceRefImages] = useState<string[]>([]);
  const [nanoBananaJsonEdit, setNanoBananaJsonEdit] = useState("");
  const [seedanceJsonEdit, setSeedanceJsonEdit] = useState("");

  const [apifyToken, setApifyToken] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [wavespeedKey, setWavespeedKey] = useState("");

  const [outputs, setOutputs] = useState<StepOutputs>({});
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);

  useEffect(() => {
    if (outputs[3]?.nanoBananaJson) {
      setNanoBananaJsonEdit(outputs[3].nanoBananaJson);
    }
  }, [outputs[3]?.nanoBananaJson]);

  useEffect(() => {
    if (outputs[5]?.seedanceJson) {
      setSeedanceJsonEdit(outputs[5].seedanceJson);
    }
  }, [outputs[5]?.seedanceJson]);

  const invalidateFrom = useCallback((step: StepKey) => {
    setOutputs((prev) => {
      const next = { ...prev };
      for (let s = step; s <= STEP_COUNT; s++) delete next[s as StepKey];
      return next;
    });
    if (step <= 3) setNanoBananaJsonEdit("");
    if (step <= 5) setSeedanceJsonEdit("");
  }, []);

  const completedStep = useMemo(() => {
    let max = 0;
    for (let s = 1; s <= STEP_COUNT; s++) {
      if (outputs[s as StepKey]) max = s;
    }
    return max;
  }, [outputs]);

  const executeStep = useCallback(
    async (step: number, priorOutputs: StepOutputs) => {
      const jobId = crypto.randomUUID();
      setActiveStep(step);
      setError(null);
      setStatusLabel(`Running step ${step}…`);

      const pollStatus = async () => {
        try {
          const r = await fetch(`/api/status?jobId=${encodeURIComponent(jobId)}`);
          const s = (await r.json()) as { label?: string; error?: string };
          if (s.label) setStatusLabel(s.label);
          if (s.error) setError(s.error);
        } catch {
          /* ignore */
        }
      };
      const pollId = window.setInterval(pollStatus, 3000);
      await pollStatus();

      try {
        const res = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            step,
            jobId,
            reelUrl,
            apifyDelaySeconds,
            chatgptPrompt,
            chatgptExtraAppend,
            geminiPrompt,
            geminiExtraAppend,
            seedanceExtraAppend,
            caption,
            nanoBananaJson: nanoBananaJsonEdit || outputs[3]?.nanoBananaJson,
            seedanceJson: seedanceJsonEdit || outputs[5]?.seedanceJson,
            nanoBananaRefImages,
            seedanceRefImages,
            prior: buildPrior(priorOutputs, {
              nanoBananaJson: nanoBananaJsonEdit,
              seedanceJson: seedanceJsonEdit,
            }),
            apifyToken,
            openaiKey,
            geminiKey,
            wavespeedKey,
          }),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok || !data.success) {
          setError((data.error as string) ?? `Step ${step} failed`);
          return { ok: false as const, next: priorOutputs };
        }

        const next = { ...priorOutputs };
        if (step === 1 && data.reelVideoUrl)
          next[1] = { reelVideoUrl: data.reelVideoUrl as string };
        if (step === 2 && data.frameBase64)
          next[2] = { frameBase64: data.frameBase64 as string };
        if (step === 3 && data.nanoBananaJson) {
          const j = data.nanoBananaJson as string;
          next[3] = { nanoBananaJson: j };
          setNanoBananaJsonEdit(j);
        }
        if (step === 4 && data.nanoBananaImageUrl)
          next[4] = { nanoBananaImageUrl: data.nanoBananaImageUrl as string };
        if (step === 5 && data.seedanceJson) {
          const j = data.seedanceJson as string;
          next[5] = { seedanceJson: j };
          setSeedanceJsonEdit(j);
        }
        if (step === 6 && data.seedanceVideoBase64)
          next[6] = { seedanceVideoBase64: data.seedanceVideoBase64 as string };
        if (step === 7 && data.videoBase64)
          next[7] = {
            videoBase64: data.videoBase64 as string,
            mimeType: (data.mimeType as string) ?? "video/mp4",
          };
        return { ok: true as const, next };
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
        return { ok: false as const, next: priorOutputs };
      } finally {
        window.clearInterval(pollId);
        await pollStatus();
        setActiveStep(null);
      }
    },
    [
      reelUrl,
      apifyDelaySeconds,
      chatgptPrompt,
      chatgptExtraAppend,
      geminiPrompt,
      geminiExtraAppend,
      seedanceExtraAppend,
      caption,
      nanoBananaJsonEdit,
      seedanceJsonEdit,
      nanoBananaRefImages,
      seedanceRefImages,
      outputs,
      apifyToken,
      openaiKey,
      geminiKey,
      wavespeedKey,
    ],
  );

  const stripFromStep = useCallback((base: StepOutputs, from: number) => {
    const stripped = { ...base };
    for (let s = from; s <= STEP_COUNT; s++) delete stripped[s as StepKey];
    return stripped;
  }, []);

  const runStep = useCallback(
    async (step: number) => {
      setRunning(true);
      const prior = stripFromStep(outputs, step);
      setOutputs(prior);
      const { ok, next } = await executeStep(step, prior);
      if (ok) setOutputs(next);
      setRunning(false);
      setStatusLabel(null);
    },
    [executeStep, outputs, stripFromStep],
  );

  const runPipeline = useCallback(async () => {
    if (!reelUrl.trim()) {
      setError("Instagram Reel URL is required");
      return;
    }
    if (!caption.trim()) {
      setError("Caption is required before step 7");
      return;
    }
    if (!apifyToken.trim() || !openaiKey.trim() || !geminiKey.trim() || !wavespeedKey.trim()) {
      setError("All API keys are required");
      return;
    }
    setRunning(true);
    setError(null);
    let current = { ...outputs };
    for (let s = 1; s <= STEP_COUNT; s++) {
      if (current[s as StepKey]) continue;
      const { ok, next } = await executeStep(s, current);
      if (!ok) break;
      current = next;
      setOutputs(current);
    }
    setRunning(false);
    setStatusLabel(null);
  }, [reelUrl, caption, outputs, executeStep, apifyToken, openaiKey, geminiKey, wavespeedKey]);

  const reelPreviewUrl = useObjectUrl(outputs[1]?.reelVideoUrl, "url");
  const framePreviewUrl = useObjectUrl(outputs[2]?.frameBase64, "image");
  const finalPreviewUrl = useObjectUrl(outputs[7]?.videoBase64, "video");
  const seedancePreviewUrl = useObjectUrl(outputs[6]?.seedanceVideoBase64, "video");

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <h1 className={styles.title}>Reel → AI video</h1>
        <p className={styles.subtitle}>
          Synchronous pipeline. WaveSpeed media is uploaded to their servers before
          Nano Banana &amp; Seedance. Edit any JSON output before the next step.
        </p>
        <div className={styles.apiKeysSection}>
          <h2 className={styles.apiKeysTitle}>API Keys</h2>
          <label className={styles.label}>
            Apify API Token
            <input
              className={styles.input}
              type="password"
              value={apifyToken}
              onChange={(e) => setApifyToken(e.target.value)}
              disabled={running}
              placeholder="Enter your Apify API token"
            />
          </label>
          <label className={styles.label}>
            OpenAI API Key
            <input
              className={styles.input}
              type="password"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              disabled={running}
              placeholder="Enter your OpenAI API key"
            />
          </label>
          <label className={styles.label}>
            Gemini API Key
            <input
              className={styles.input}
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              disabled={running}
              placeholder="Enter your Gemini API key"
            />
          </label>
          <label className={styles.label}>
            WaveSpeed API Key
            <input
              className={styles.input}
              type="password"
              value={wavespeedKey}
              onChange={(e) => setWavespeedKey(e.target.value)}
              disabled={running}
              placeholder="Enter your WaveSpeed API key"
            />
          </label>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            disabled={running || !reelUrl.trim() || !apifyToken.trim() || !openaiKey.trim() || !geminiKey.trim() || !wavespeedKey.trim()}
            onClick={() => void runPipeline()}
          >
            {running ? "Running…" : "Run pipeline"}
          </button>
          <span className={styles.hint}>
            Completed through step {completedStep} / {STEP_COUNT}
          </span>
        </div>

        {statusLabel && (
          <p className={styles.status} aria-live="polite">
            {activeStep ? `Step ${activeStep}: ` : ""}
            {statusLabel}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <StepCard
          n={1}
          title="Download reel (Apify)"
          running={running && activeStep === 1}
          hasOutput={!!outputs[1]}
          onRun={() => void runStep(1)}
          runDisabled={running || !reelUrl.trim()}
        >
          <label className={styles.label}>
            Instagram Reel URL
            <input
              className={styles.input}
              type="url"
              value={reelUrl}
              onChange={(e) => {
                setReelUrl(e.target.value);
                if (outputs[1]) invalidateFrom(1);
              }}
              disabled={running}
            />
          </label>
          <label className={styles.label}>
            Delay after Apify POST (seconds, default 20)
            <input
              className={styles.input}
              type="number"
              min={0}
              max={120}
              value={apifyDelaySeconds}
              onChange={(e) => {
                setApifyDelaySeconds(Number(e.target.value) || 0);
                if (outputs[1]) invalidateFrom(1);
              }}
              disabled={running}
            />
          </label>
          {outputs[1] && reelPreviewUrl && (
            <OutputBlock label="Reel video">
              <video className={styles.video} src={reelPreviewUrl} controls playsInline />
            </OutputBlock>
          )}
        </StepCard>

        <StepCard
          n={2}
          title="Download video & extract frame"
          running={running && activeStep === 2}
          hasOutput={!!outputs[2]}
          onRun={() => void runStep(2)}
          runDisabled={running || !outputs[1]}
        >
          {outputs[2] && framePreviewUrl && (
            <OutputBlock label="First frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.image} src={framePreviewUrl} alt="Frame" />
            </OutputBlock>
          )}
        </StepCard>

        <StepCard
          n={3}
          title="Nano Banana JSON (ChatGPT)"
          running={running && activeStep === 3}
          hasOutput={!!outputs[3]}
          onRun={() => void runStep(3)}
          runDisabled={running || !outputs[2]}
        >
          <PromptField
            label="ChatGPT system prompt"
            value={chatgptPrompt}
            defaultValue={DEFAULT_CHATGPT_PROMPT}
            onChange={(v) => {
              setChatgptPrompt(v);
              if (outputs[3]) invalidateFrom(3);
            }}
            disabled={running}
          />
          <label className={styles.label}>
            Extra append (added to ChatGPT instructions)
            <textarea
              className={styles.textarea}
              value={chatgptExtraAppend}
              onChange={(e) => {
                setChatgptExtraAppend(e.target.value);
                if (outputs[3]) invalidateFrom(3);
              }}
              rows={2}
              disabled={running}
            />
          </label>
          <ImageUploadField
            label="Reference images for ChatGPT / Nano Banana (image 1, 2, 3…)"
            images={nanoBananaRefImages}
            onChange={(imgs) => {
              setNanoBananaRefImages(imgs);
              if (outputs[3]) invalidateFrom(3);
            }}
            disabled={running}
          />
          {(outputs[3] || nanoBananaJsonEdit) && (
            <JsonEditor
              label="Nano Banana JSON (edit before step 4)"
              value={nanoBananaJsonEdit || outputs[3]?.nanoBananaJson || ""}
              onChange={(v) => {
                setNanoBananaJsonEdit(v);
                if (outputs[4]) invalidateFrom(4);
              }}
              disabled={running}
            />
          )}
        </StepCard>

        <StepCard
          n={4}
          title="Image (Nano Banana Pro via WaveSpeed)"
          running={running && activeStep === 4}
          hasOutput={!!outputs[4]}
          onRun={() => void runStep(4)}
          runDisabled={running || !outputs[2] || !(nanoBananaJsonEdit || outputs[3])}
        >
          {outputs[4] && (
            <OutputBlock label="Generated image URL">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.image} src={outputs[4].nanoBananaImageUrl} alt="Nano Banana" />
              <a className={styles.link} href={outputs[4].nanoBananaImageUrl} target="_blank" rel="noreferrer">
                Open on WaveSpeed CDN
              </a>
            </OutputBlock>
          )}
        </StepCard>

        <StepCard
          n={5}
          title="Seedance JSON (Gemini)"
          running={running && activeStep === 5}
          hasOutput={!!outputs[5]}
          onRun={() => void runStep(5)}
          runDisabled={running || !outputs[1]}
        >
          <PromptField
            label="Gemini system prompt"
            value={geminiPrompt}
            defaultValue={DEFAULT_GEMINI_SEEDANCE_PROMPT}
            onChange={(v) => {
              setGeminiPrompt(v);
              if (outputs[5]) invalidateFrom(5);
            }}
            disabled={running}
          />
          <label className={styles.label}>
            Extra append (added to Gemini instructions)
            <textarea
              className={styles.textarea}
              value={geminiExtraAppend}
              onChange={(e) => {
                setGeminiExtraAppend(e.target.value);
                if (outputs[5]) invalidateFrom(5);
              }}
              rows={2}
              disabled={running}
            />
          </label>
          {(outputs[5] || seedanceJsonEdit) && (
            <JsonEditor
              label="Seedance JSON (edit before step 6)"
              value={seedanceJsonEdit || outputs[5]?.seedanceJson || ""}
              onChange={(v) => {
                setSeedanceJsonEdit(v);
                if (outputs[6]) invalidateFrom(6);
              }}
              disabled={running}
            />
          )}
        </StepCard>

        <StepCard
          n={6}
          title="Video (Seedance 2.0 via WaveSpeed)"
          running={running && activeStep === 6}
          hasOutput={!!outputs[6]}
          onRun={() => void runStep(6)}
          runDisabled={
            running ||
            !outputs[4] ||
            !(seedanceJsonEdit || outputs[5])
          }
        >
          <ImageUploadField
            label="Extra reference images for Seedance only (uploaded to WaveSpeed)"
            images={seedanceRefImages}
            onChange={(imgs) => {
              setSeedanceRefImages(imgs);
              if (outputs[6]) invalidateFrom(6);
            }}
            disabled={running}
          />
          <label className={styles.label}>
            Extra append (added to Seedance JSON prompt)
            <textarea
              className={styles.textarea}
              value={seedanceExtraAppend}
              onChange={(e) => {
                setSeedanceExtraAppend(e.target.value);
                if (outputs[6]) invalidateFrom(6);
              }}
              rows={2}
              disabled={running}
            />
          </label>
          {outputs[6] && seedancePreviewUrl && (
            <OutputBlock label="Seedance video (pre-caption)">
              <video className={styles.video} src={seedancePreviewUrl} controls playsInline />
            </OutputBlock>
          )}
        </StepCard>

        <StepCard
          n={7}
          title="Burn caption (FFmpeg)"
          running={running && activeStep === 7}
          hasOutput={!!outputs[7]}
          onRun={() => void runStep(7)}
          runDisabled={running || !outputs[6] || !caption.trim()}
        >
          <label className={styles.label}>
            Snapchat-style caption
            <input
              className={styles.input}
              value={caption}
              onChange={(e) => {
                setCaption(e.target.value);
                if (outputs[7]) invalidateFrom(7);
              }}
              disabled={running}
            />
          </label>
          {outputs[7] && finalPreviewUrl && (
            <OutputBlock label="Final video">
              <video
                className={styles.video}
                src={finalPreviewUrl}
                controls
                autoPlay
                loop
                playsInline
              />
              <a
                className={styles.download}
                href={finalPreviewUrl}
                download="reel-ai-output.mp4"
              >
                Download MP4
              </a>
            </OutputBlock>
          )}
        </StepCard>
      </div>
    </main>
  );
}

function StepCard({
  n,
  title,
  children,
  running,
  hasOutput,
  onRun,
  runDisabled,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  running: boolean;
  hasOutput: boolean;
  onRun: () => void;
  runDisabled: boolean;
}) {
  return (
    <section
      className={`${styles.stepCard} ${hasOutput ? styles.stepDone : ""} ${running ? styles.stepActive : ""}`}
    >
      <div className={styles.stepHeader}>
        <span className={styles.stepNum}>Step {n}</span>
        <h2 className={styles.stepTitle}>{title}</h2>
        <button type="button" className={styles.stepRun} onClick={onRun} disabled={runDisabled}>
          {running ? "…" : hasOutput ? "Re-run" : "Run"}
        </button>
      </div>
      <div className={styles.stepBody}>{children}</div>
    </section>
  );
}

function PromptField({
  label,
  value,
  defaultValue,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  defaultValue: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={styles.promptBlock}>
      <div className={styles.promptHeader}>
        <span className={styles.promptLabel}>{label}</span>
        <button
          type="button"
          className={styles.promptToggle}
          onClick={() => {
            if (editing) {
              onChange(defaultValue);
              setEditing(false);
            } else setEditing(true);
          }}
          disabled={disabled}
        >
          {editing ? "Reset to default" : "Replace"}
        </button>
      </div>
      {editing ? (
        <textarea
          className={styles.textarea}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={8}
          disabled={disabled}
        />
      ) : (
        <pre className={styles.preMuted}>{value.slice(0, 400)}…</pre>
      )}
    </div>
  );
}

function JsonEditor({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className={styles.outputBlock}>
      <span className={styles.outputLabel}>{label}</span>
      <textarea
        className={styles.textarea}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={12}
        disabled={disabled}
        spellCheck={false}
      />
    </div>
  );
}

function ImageUploadField({
  label,
  images,
  onChange,
  disabled,
}: {
  label: string;
  images: string[];
  onChange: (b64: string[]) => void;
  disabled: boolean;
}) {
  return (
    <div className={styles.outputBlock}>
      <span className={styles.outputLabel}>{label}</span>
      <input
        type="file"
        accept="image/*"
        multiple
        disabled={disabled}
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          if (!files.length) return;
          const encoded = await Promise.all(files.map(fileToBase64));
          onChange([...images, ...encoded].slice(0, 14));
          e.target.value = "";
        }}
      />
      {images.length > 0 && (
        <div className={styles.thumbRow}>
          {images.map((b64, i) => (
            <div key={i} className={styles.thumbWrap}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className={styles.thumb}
                src={`data:image/jpeg;base64,${b64}`}
                alt={`Ref ${i + 1}`}
              />
              <button
                type="button"
                className={styles.thumbRemove}
                disabled={disabled}
                onClick={() => onChange(images.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OutputBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.outputBlock}>
      <span className={styles.outputLabel}>{label}</span>
      {children}
    </div>
  );
}