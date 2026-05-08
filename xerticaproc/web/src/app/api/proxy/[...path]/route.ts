/**
 * Proxy route — forwards all requests to the FastAPI backend,
 * injecting the Firebase ID-token from the Authorization header.
 *
 * /api/proxy/proc/contratacoes → BACKEND_URL/proc/contratacoes
 */
import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const resolvedParams = await params;
  const backendPath = "/" + resolvedParams.path.join("/");
  const search = req.nextUrl.search ?? "";
  const targetUrl = `${BACKEND}${backendPath}${search}`;

  const headers: Record<string, string> = {
    "Content-Type": req.headers.get("content-type") ?? "application/json",
    "Authorization": authHeader,
  };

  const accept = req.headers.get("accept");
  if (accept) headers["Accept"] = accept;

  const body =
    req.method !== "GET" && req.method !== "HEAD"
      ? await req.text()
      : undefined;

  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers,
    body,
  });

  const contentType = upstream.headers.get("content-type") ?? "application/json";

  // Streaming passthrough (SSE)
  if (contentType.includes("text/event-stream") && upstream.body) {
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
        connection: "keep-alive",
      },
    });
  }

  const data = await upstream.arrayBuffer();
  return new NextResponse(data, {
    status: upstream.status,
    headers: { "content-type": contentType },
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
