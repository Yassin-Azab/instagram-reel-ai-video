import fs from "node:fs";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

/** Stream-download a URL to a local file (Vercel /tmp friendly). */
export async function wget(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error("Download failed: empty response body");
  }
  const fileStream = fs.createWriteStream(outputPath);
  await finished(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(fileStream));
}
