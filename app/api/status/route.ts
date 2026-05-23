export const runtime = "nodejs";

import { jobs } from "@/lib/jobs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");
  if (!jobId) {
    return Response.json({ error: "Missing jobId" }, { status: 400 });
  }
  const state = jobs.get(jobId);
  if (!state) {
    return Response.json(
      { step: 0, label: "Waiting to start…", done: false },
      { status: 200 },
    );
  }
  return Response.json(state);
}
