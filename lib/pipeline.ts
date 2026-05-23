import fs from "node:fs";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import OpenAI from "openai";
import { wget } from "./download";
import { jobs } from "./jobs";
import {
  DEFAULT_APIFY_DELAY_SECONDS,
  DEFAULT_CHATGPT_PROMPT,
  DEFAULT_GEMINI_SEEDANCE_PROMPT,
} from "./prompts";
import type { StepResult } from "./pipeline-types";
import {
  pollWaveSpeedPrediction,
  submitWaveSpeedTask,
  uploadBase64ToWaveSpeed,
} from "./wavespeed";

ffmpeg.setFfmpegPath(ffmpegStatic as string);

const APIFY_ACTOR_ID = "8yz4aO3qlqckRu3nu";

export const STEP_LABELS: Record<number, string> = {
  1: "Downloading reel (Apify)...",
  2: "Downloading video & extracting frame...",
  3: "Generating Nano Banana JSON (ChatGPT)...",
  4: "Generating image (Nano Banana Pro)...",
  5: "Generating Seedance JSON (Gemini)...",
  6: "Generating video (Seedance 2.0)...",
  7: "Adding caption...",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

function mimeFromBase64(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  return "image/jpeg";
}

function escapeDrawtextCaption(caption: string): string {
  return caption
    .replace(/\r?\n/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

function extractJsonFromModelText(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) return fence[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function buildPrompt(base: string, extraAppend?: string): string {
  const extra = extraAppend?.trim();
  if (!extra) return base;
  return `${base}\n\n---\nUSER APPEND (apply to the JSON you generate):\n${extra}`;
}

function updateJob(jobId: string, step: number): void {
  jobs.set(jobId, {
    step,
    label: STEP_LABELS[step] ?? "Working...",
    done: false,
  });
}

function failJob(jobId: string, step: number, message: string): void {
  jobs.set(jobId, {
    step,
    label: STEP_LABELS[step] ?? "Failed",
    done: true,
    error: `Step ${step} failed: ${message}`,
  });
}

function requireEnv(): {
  apifyToken: string;
  geminiKey: string;
  openaiKey: string;
  wavespeedKey: string;
} {
  const apifyToken = process.env.APIFY_API_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const wavespeedKey = process.env.WAVESPEED_API_KEY;
  if (!apifyToken || !geminiKey || !openaiKey || !wavespeedKey) {
    throw new Error(
      "Server is missing required environment variables (APIFY, GEMINI, OPENAI, WAVESPEED)",
    );
  }
  return { apifyToken, geminiKey, openaiKey, wavespeedKey };
}

export async function runPipelineStep(
  step: number,
  jobId: string,
  params: {
    reelUrl?: string;
    apifyDelaySeconds?: number;
    chatgptPrompt?: string;
    chatgptExtraAppend?: string;
    geminiPrompt?: string;
    geminiExtraAppend?: string;
    seedanceExtraAppend?: string;
    caption?: string;
    nanoBananaJson?: string;
    seedanceJson?: string;
    nanoBananaRefImages?: string[];
    seedanceRefImages?: string[];
    prior?: {
      reelVideoUrl?: string;
      frameBase64?: string;
      nanoBananaJson?: string;
      nanoBananaImageUrl?: string;
      seedanceJson?: string;
      seedanceVideoBase64?: string;
    };
    apiKeys?: {
      apifyToken: string;
      openaiKey: string;
      geminiKey: string;
      wavespeedKey: string;
    };
  },
): Promise<StepResult> {
  const env = params.apiKeys ?? requireEnv();
  updateJob(jobId, step);

  switch (step) {
    case 1:
      return runStep1(jobId, params.reelUrl ?? "", params.apifyDelaySeconds, env.apifyToken);
    case 2:
      return runStep2(jobId, params.prior?.reelVideoUrl ?? "");
    case 3:
      return runStep3(
        jobId,
        params.prior?.frameBase64 ?? "",
        params.nanoBananaRefImages ?? [],
        params.chatgptPrompt ?? DEFAULT_CHATGPT_PROMPT,
        params.chatgptExtraAppend ?? "",
        env.openaiKey,
      );
    case 4:
      return runStep4(
        jobId,
        params.nanoBananaJson ?? params.prior?.nanoBananaJson ?? "",
        params.prior?.frameBase64 ?? "",
        params.nanoBananaRefImages ?? [],
        env.wavespeedKey,
      );
    case 5:
      return runStep5(
        jobId,
        params.prior?.reelVideoUrl ?? "",
        params.geminiPrompt ?? DEFAULT_GEMINI_SEEDANCE_PROMPT,
        params.geminiExtraAppend ?? "",
        env.geminiKey,
      );
    case 6:
      return runStep6(
        jobId,
        params.seedanceJson ?? params.prior?.seedanceJson ?? "",
        params.prior?.nanoBananaImageUrl ?? "",
        params.seedanceRefImages ?? [],
        params.seedanceExtraAppend ?? "",
        env.wavespeedKey,
      );
    case 7:
      return runStep7(
        jobId,
        params.prior?.seedanceVideoBase64 ?? "",
        params.caption ?? "",
      );
    default:
      throw new Error(`Invalid step: ${step}`);
  }
}

async function runStep1(
  jobId: string,
  reelUrl: string,
  apifyDelaySeconds: number | undefined,
  apifyToken: string,
): Promise<StepResult> {
  const delaySec = apifyDelaySeconds ?? DEFAULT_APIFY_DELAY_SECONDS;

  try {
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs?token=${encodeURIComponent(apifyToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: reelUrl, use_cache: false }),
      },
    );
    if (!runRes.ok) {
      throw new Error(`Apify start run ${runRes.status}: ${await runRes.text()}`);
    }
    const runJson = (await runRes.json()) as {
      data?: { id?: string; defaultDatasetId?: string };
    };
    const runId = runJson.data?.id;
    if (!runId) throw new Error("Apify did not return a run id");

    await sleep(delaySec * 1000);

    let datasetId = runJson.data?.defaultDatasetId;
    for (let i = 0; i < 60; i++) {
      const st = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(apifyToken)}`,
      );
      if (!st.ok) throw new Error(`Apify poll ${st.status}: ${await st.text()}`);
      const stJson = (await st.json()) as {
        data?: { status?: string; defaultDatasetId?: string };
      };
      const status = stJson.data?.status;
      if (stJson.data?.defaultDatasetId) datasetId = stJson.data.defaultDatasetId;
      if (status === "SUCCEEDED") break;
      if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
        throw new Error(`Apify run ended with status ${status}`);
      }
      await sleep(3000);
      if (i === 59) throw new Error("Apify polling exceeded maximum retries");
    }

    if (!datasetId) throw new Error("Apify run missing defaultDatasetId");

    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(apifyToken)}`,
    );
    if (!itemsRes.ok) {
      throw new Error(`Apify dataset ${itemsRes.status}: ${await itemsRes.text()}`);
    }
    const items = (await itemsRes.json()) as Array<{ videoUrl?: string }>;
    const videoUrl = items[0]?.videoUrl;
    if (!videoUrl) throw new Error("No videoUrl in Apify dataset items[0]");

    jobs.set(jobId, { step: 1, label: STEP_LABELS[1], done: true });
    return { step: 1, reelVideoUrl: videoUrl };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    failJob(jobId, 1, msg);
    throw e;
  }
}

async function runStep2(jobId: string, reelVideoUrl: string): Promise<StepResult> {
  if (!reelVideoUrl) throw new Error("Step 2 requires step 1 output (reelVideoUrl)");

  const tmpInput = `/tmp/reel-${jobId}.mp4`;
  const tmpFrame = `/tmp/frame-${jobId}.jpg`;

  try {
    await wget(reelVideoUrl, tmpInput);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(tmpInput)
        .outputOptions(["-vframes", "1", "-q:v", "2"])
        .output(tmpFrame)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });

    const frameBase64 = fs.readFileSync(tmpFrame).toString("base64");
    jobs.set(jobId, { step: 2, label: STEP_LABELS[2], done: true });
    return { step: 2, frameBase64 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    failJob(jobId, 2, msg);
    throw e;
  } finally {
    safeUnlink(tmpInput);
    safeUnlink(tmpFrame);
  }
}

async function runStep3(
  jobId: string,
  frameBase64: string,
  refImages: string[],
  chatgptPrompt: string,
  chatgptExtraAppend: string,
  openaiKey: string,
): Promise<StepResult> {
  if (!frameBase64) throw new Error("Step 3 requires step 2 output (frameBase64)");

  try {
    const openai = new OpenAI({ apiKey: openaiKey });
    const instruction = buildPrompt(chatgptPrompt, chatgptExtraAppend);

    const content = [
      { type: "input_text" as const, text: instruction },
      {
        type: "input_image" as const,
        image_url: `data:${mimeFromBase64(frameBase64)};base64,${frameBase64}`,
        detail: "high" as const,
      },
      ...refImages.map((b64) => ({
        type: "input_image" as const,
        image_url: `data:${mimeFromBase64(b64)};base64,${b64}`,
        detail: "high" as const,
      })),
    ];

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [{ role: "user" as const, content }],
    });

    const raw = response.output_text?.trim() ?? "";
    if (!raw) throw new Error("Empty ChatGPT response");

    const nanoBananaJson = extractJsonFromModelText(raw);
    JSON.parse(nanoBananaJson);

    jobs.set(jobId, { step: 3, label: STEP_LABELS[3], done: true });
    return { step: 3, nanoBananaJson };
  } catch (e) {
    const msg =
      e instanceof SyntaxError
        ? `ChatGPT returned invalid JSON: ${e.message}`
        : e instanceof Error
          ? e.message
          : String(e);
    failJob(jobId, 3, msg);
    throw new Error(msg);
  }
}

async function runStep4(
  jobId: string,
  nanoBananaJson: string,
  frameBase64: string,
  refImages: string[],
  wavespeedKey: string,
): Promise<StepResult> {
  if (!nanoBananaJson.trim()) {
    throw new Error("Step 4 requires Nano Banana JSON (from step 3 or edited)");
  }
  if (!frameBase64) throw new Error("Step 4 requires frame from step 2");

  try {
    JSON.parse(nanoBananaJson);
  } catch {
    throw new Error("Nano Banana prompt must be valid JSON");
  }

  try {
    const imageUrls: string[] = [];
    imageUrls.push(
      await uploadBase64ToWaveSpeed(
        wavespeedKey,
        frameBase64,
        "frame.jpg",
        mimeFromBase64(frameBase64),
      ),
    );
    for (let i = 0; i < refImages.length; i++) {
      const b64 = refImages[i];
      imageUrls.push(
        await uploadBase64ToWaveSpeed(
          wavespeedKey,
          b64,
          `ref-${i + 1}.jpg`,
          mimeFromBase64(b64),
        ),
      );
    }

    const taskId = await submitWaveSpeedTask(
      wavespeedKey,
      "google/nano-banana-pro/edit",
      {
        images: imageUrls,
        prompt: nanoBananaJson,
        aspect_ratio: "9:16",
        resolution: "1k",
        output_format: "png",
      },
    );

    const outputs = await pollWaveSpeedPrediction(wavespeedKey, taskId);
    const nanoBananaImageUrl = outputs[0];
    if (!nanoBananaImageUrl) throw new Error("Nano Banana returned no image URL");

    jobs.set(jobId, { step: 4, label: STEP_LABELS[4], done: true });
    return { step: 4, nanoBananaImageUrl };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    failJob(jobId, 4, msg);
    throw e;
  }
}

async function runStep5(
  jobId: string,
  reelVideoUrl: string,
  geminiPrompt: string,
  geminiExtraAppend: string,
  geminiKey: string,
): Promise<StepResult> {
  if (!reelVideoUrl) throw new Error("Step 5 requires step 1 output (reelVideoUrl)");

  const tmpInput = `/tmp/reel-gemini-${jobId}.mp4`;

  try {
    await wget(reelVideoUrl, tmpInput);
    const b64Video = fs.readFileSync(tmpInput).toString("base64");
    const instruction = buildPrompt(geminiPrompt, geminiExtraAppend);

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${encodeURIComponent(geminiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: "video/mp4", data: b64Video } },
                { text: instruction },
              ],
            },
          ],
        }),
      },
    );
    if (!geminiRes.ok) {
      throw new Error(`Gemini ${geminiRes.status}: ${await geminiRes.text()}`);
    }
    const gemJson = (await geminiRes.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };
    if (gemJson.error?.message) throw new Error(gemJson.error.message);

    const raw =
      gemJson.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    if (!raw) throw new Error("Empty Gemini response");

    const seedanceJson = extractJsonFromModelText(raw);
    JSON.parse(seedanceJson);

    jobs.set(jobId, { step: 5, label: STEP_LABELS[5], done: true });
    return { step: 5, seedanceJson };
  } catch (e) {
    const msg =
      e instanceof SyntaxError
        ? `Gemini returned invalid JSON: ${e.message}`
        : e instanceof Error
          ? e.message
          : String(e);
    failJob(jobId, 5, msg);
    throw new Error(msg);
  } finally {
    safeUnlink(tmpInput);
  }
}

async function runStep6(
  jobId: string,
  seedanceJson: string,
  nanoBananaImageUrl: string,
  seedanceRefImages: string[],
  seedanceExtraAppend: string,
  wavespeedKey: string,
): Promise<StepResult> {
  if (!seedanceJson.trim()) {
    throw new Error("Step 6 requires Seedance JSON (from step 5 or edited)");
  }
  if (!nanoBananaImageUrl) {
    throw new Error("Step 6 requires Nano Banana image URL from step 4");
  }

  try {
    JSON.parse(seedanceJson);
  } catch {
    throw new Error("Seedance prompt must be valid JSON");
  }

  try {
    const extra = seedanceExtraAppend?.trim();
    const prompt = extra
      ? `${seedanceJson}\n\n---\nUSER APPEND:\n${extra}`
      : seedanceJson;

    const extraRefUrls: string[] = [];
    for (let i = 0; i < Math.min(seedanceRefImages.length, 3); i++) {
      const b64 = seedanceRefImages[i];
      extraRefUrls.push(
        await uploadBase64ToWaveSpeed(
          wavespeedKey,
          b64,
          `seedance-ref-${i + 1}.jpg`,
          mimeFromBase64(b64),
        ),
      );
    }

    let fullPrompt = prompt;
    if (extraRefUrls.length) {
      fullPrompt += `\n\nAdditional reference images on WaveSpeed (use @image_2, @image_3, etc.): ${extraRefUrls.join(", ")}`;
    }

    const taskId = await submitWaveSpeedTask(
      wavespeedKey,
      "bytedance/seedance-2.0/image-to-video",
      {
        prompt: fullPrompt,
        image: nanoBananaImageUrl,
        duration: 6,
        aspect_ratio: "9:16",
        resolution: "720p",
        generate_audio: true,
      },
    );

    const outputs = await pollWaveSpeedPrediction(wavespeedKey, taskId);
    const videoUrl = outputs[0];
    if (!videoUrl) throw new Error("Seedance returned no video URL");

    const tmpVideo = `/tmp/seedance-${jobId}.mp4`;
    await wget(videoUrl, tmpVideo);
    const seedanceVideoBase64 = fs.readFileSync(tmpVideo).toString("base64");
    safeUnlink(tmpVideo);

    jobs.set(jobId, { step: 6, label: STEP_LABELS[6], done: true });
    return { step: 6, seedanceVideoBase64 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    failJob(jobId, 6, msg);
    throw e;
  }
}

async function runStep7(
  jobId: string,
  seedanceVideoBase64: string,
  caption: string,
): Promise<StepResult> {
  if (!seedanceVideoBase64) {
    throw new Error("Step 7 requires step 6 output (seedanceVideoBase64)");
  }
  if (!caption.trim()) throw new Error("Caption is required for step 7");

  const tmpSeedance = `/tmp/seedance-cap-${jobId}.mp4`;
  const tmpFont = `/tmp/font-${jobId}.ttf`;
  const tmpFinal = `/tmp/final-${jobId}.mp4`;

  try {
    fs.writeFileSync(tmpSeedance, Buffer.from(seedanceVideoBase64, "base64"));

    const fontSrc = path.join(
      process.cwd(),
      "public",
      "fonts",
      "ProximaNova-Regular.ttf",
    );
    if (!fs.existsSync(fontSrc)) {
      throw new Error(
        `Font not found at ${fontSrc}. Add ProximaNova-Regular.ttf under public/fonts/.`,
      );
    }
    fs.copyFileSync(fontSrc, tmpFont);

    const escapedCaption = escapeDrawtextCaption(caption);
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tmpSeedance)
        .outputOptions([
          `-vf drawtext=fontfile='${tmpFont}':text='${escapedCaption}':x=(w-text_w)/2:y=h-140:fontsize=42:fontcolor=white:shadowcolor=black:shadowx=3:shadowy=3:borderw=2:bordercolor=black`,
        ])
        .output(tmpFinal)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });

    const videoBase64 = fs.readFileSync(tmpFinal).toString("base64");
    jobs.set(jobId, { step: 7, label: STEP_LABELS[7], done: true });
    return { step: 7, videoBase64, mimeType: "video/mp4" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    failJob(jobId, 7, msg);
    throw e;
  } finally {
    safeUnlink(tmpSeedance);
    safeUnlink(tmpFont);
    safeUnlink(tmpFinal);
  }
}
