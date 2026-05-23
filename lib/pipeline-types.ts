export type PipelineOutputs = {
  reelVideoUrl?: string;
  frameBase64?: string;
  nanoBananaJson?: string;
  nanoBananaImageUrl?: string;
  seedanceJson?: string;
  seedanceVideoBase64?: string;
};

export type StepResult =
  | { step: 1; reelVideoUrl: string }
  | { step: 2; frameBase64: string }
  | { step: 3; nanoBananaJson: string }
  | { step: 4; nanoBananaImageUrl: string }
  | { step: 5; seedanceJson: string }
  | { step: 6; seedanceVideoBase64: string }
  | { step: 7; videoBase64: string; mimeType: string };

export type RunStepBody = {
  step: number;
  jobId?: string;
  reelUrl?: string;
  apifyDelaySeconds?: number;
  chatgptPrompt?: string;
  chatgptExtraAppend?: string;
  geminiPrompt?: string;
  geminiExtraAppend?: string;
  seedanceExtraAppend?: string;
  caption?: string;
  /** Edited JSON text passed to Nano Banana (from step 3 output). */
  nanoBananaJson?: string;
  /** Edited JSON text passed to Seedance (from step 5 output). */
  seedanceJson?: string;
  /** Reference images for ChatGPT + Nano Banana (base64, no data: prefix). */
  nanoBananaRefImages?: string[];
  /** Extra reference images for Seedance only (base64). */
  seedanceRefImages?: string[];
  prior?: PipelineOutputs;
  /** API keys provided by user */
  apifyToken?: string;
  openaiKey?: string;
  geminiKey?: string;
  wavespeedKey?: string;
};
