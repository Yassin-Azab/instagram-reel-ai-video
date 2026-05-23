const UPLOAD_URL = "https://api.wavespeed.ai/api/v3/media/upload/binary";
const PREDICTIONS_BASE = "https://api.wavespeed.ai/api/v3/predictions";

export type WaveSpeedUploadResult = {
  type: string;
  download_url: string;
  filename: string;
  size: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function uploadToWaveSpeed(
  apiKey: string,
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: mimeType }),
    filename,
  );

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`WaveSpeed upload ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    code?: number;
    message?: string;
    data?: WaveSpeedUploadResult;
  };
  const url = json.data?.download_url;
  if (!url) {
    throw new Error(`WaveSpeed upload missing download_url: ${JSON.stringify(json)}`);
  }
  return url;
}

export async function uploadBase64ToWaveSpeed(
  apiKey: string,
  base64: string,
  filename: string,
  mimeType = "image/jpeg",
): Promise<string> {
  return uploadToWaveSpeed(apiKey, Buffer.from(base64, "base64"), filename, mimeType);
}

export async function pollWaveSpeedPrediction(
  apiKey: string,
  taskId: string,
  intervalMs = 5000,
  maxRetries = 60,
): Promise<string[]> {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(`${PREDICTIONS_BASE}/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`WaveSpeed poll ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data?: {
        status?: string;
        outputs?: string[];
        error?: string;
      };
    };
    const st = json.data?.status;
    if (json.data?.error) throw new Error(json.data.error);
    if (st === "completed") {
      const outputs = json.data?.outputs ?? [];
      if (!outputs.length) throw new Error("WaveSpeed completed with no outputs");
      return outputs;
    }
    if (st === "failed" || st === "canceled" || st === "cancelled") {
      throw new Error(`WaveSpeed status: ${st}`);
    }
    await sleep(intervalMs);
    if (i === maxRetries - 1) {
      throw new Error("WaveSpeed polling exceeded maximum retries");
    }
  }
  throw new Error("WaveSpeed polling failed");
}

export async function submitWaveSpeedTask(
  apiKey: string,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(`https://api.wavespeed.ai/api/v3/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`WaveSpeed submit ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    data?: { id?: string };
    error?: string;
    message?: string;
  };
  if (json.error) throw new Error(json.error);
  const id = json.data?.id;
  if (!id) throw new Error(`WaveSpeed did not return task id: ${JSON.stringify(json)}`);
  return id;
}
