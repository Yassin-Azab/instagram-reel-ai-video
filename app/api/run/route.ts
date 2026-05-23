export const maxDuration = 300;
export const runtime = "nodejs";

/*
SETUP GUIDE:

Push this project to a GitHub repo → import on vercel.com
API keys are now provided through the website UI (no environment variables needed).
Place ProximaNova-Regular.ttf in public/fonts/ before deploying.
To run locally: npm install → npm run dev → http://localhost:3000

WaveSpeed: all images/videos sent to Nano Banana & Seedance are uploaded first via
POST https://api.wavespeed.ai/api/v3/media/upload/binary (see lib/wavespeed.ts).
*/

import { runPipelineStep } from "@/lib/pipeline";
import type { RunStepBody } from "@/lib/pipeline-types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RunStepBody;
    const step = Number(body.step);
    const jobId = body.jobId?.trim() ?? crypto.randomUUID();

    if (!Number.isInteger(step) || step < 1 || step > 7) {
      return Response.json(
        { success: false, error: "step must be an integer from 1 to 7" },
        { status: 400 },
      );
    }

    if (step === 1 && !body.reelUrl?.trim()) {
      return Response.json(
        { success: false, error: "reelUrl is required for step 1" },
        { status: 400 },
      );
    }
    if (step === 7 && !body.caption?.trim()) {
      return Response.json(
        { success: false, error: "caption is required for step 7" },
        { status: 400 },
      );
    }

    // Validate that all required API keys are provided
    const requiredKeys = {
      apifyToken: body.apifyToken?.trim(),
      openaiKey: body.openaiKey?.trim(),
      geminiKey: body.geminiKey?.trim(),
      wavespeedKey: body.wavespeedKey?.trim(),
    };
    if (!requiredKeys.apifyToken || !requiredKeys.openaiKey || !requiredKeys.geminiKey || !requiredKeys.wavespeedKey) {
      return Response.json(
        { success: false, error: "Missing required API keys (apifyToken, openaiKey, geminiKey, wavespeedKey)" },
        { status: 400 },
      );
    }

    const result = await runPipelineStep(step, jobId, {
      reelUrl: body.reelUrl?.trim(),
      apifyDelaySeconds: body.apifyDelaySeconds,
      chatgptPrompt: body.chatgptPrompt,
      chatgptExtraAppend: body.chatgptExtraAppend?.trim() ?? "",
      geminiPrompt: body.geminiPrompt,
      geminiExtraAppend: body.geminiExtraAppend?.trim() ?? "",
      seedanceExtraAppend: body.seedanceExtraAppend?.trim() ?? "",
      caption: body.caption?.trim(),
      nanoBananaJson: body.nanoBananaJson,
      seedanceJson: body.seedanceJson,
      nanoBananaRefImages: body.nanoBananaRefImages,
      seedanceRefImages: body.seedanceRefImages,
      prior: body.prior,
      apiKeys: requiredKeys as { apifyToken: string; openaiKey: string; geminiKey: string; wavespeedKey: string },
    });

    return Response.json({ success: true, jobId, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}
