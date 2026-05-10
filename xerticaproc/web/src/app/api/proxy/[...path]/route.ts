/**
 * Proxy route — forwards all requests to the FastAPI backend,
 * injecting the Firebase ID-token from the Authorization header.
 *
 * /api/proxy/proc/contratacoes → BACKEND_URL/proc/contratacoes
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  const incomingCT = req.headers.get("content-type") ?? "application/json";
  const headers: Record<string, string> = {
    "Authorization": authHeader,
  };

  const accept = req.headers.get("accept");
  if (accept) headers["Accept"] = accept;

  const isMultipart = incomingCT.toLowerCase().startsWith("multipart/");
  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  let upstreamBody: BodyInit | undefined;
  const debugInfo: Record<string, string> = {};

  if (hasBody) {
    if (isMultipart) {
      // Reparseia via Web FormData e reconstrói para fetch gerar boundary novo.
      // NÃO setar Content-Type — fetch o coloca com boundary correto.
      try {
        const incoming = await req.formData();
        const fd = new FormData();
        const fields: string[] = [];
        for (const [key, value] of incoming.entries()) {
          if (typeof value === "object" && value !== null && "arrayBuffer" in value) {
            const blob = value as Blob & { name?: string };
            const filename = blob.name || "anexo";
            fd.append(key, blob, filename);
            fields.push(`${key}=<file:${filename}:${blob.size}>`);
          } else {
            fd.append(key, String(value));
            fields.push(`${key}=${String(value).slice(0, 50)}`);
          }
        }
        debugInfo["x-proxy-mp-fields"] = fields.join("|").slice(0, 500);
        debugInfo["x-proxy-mp-incoming-ct"] = incomingCT.slice(0, 200);
        upstreamBody = fd;
      } catch (e) {
        const msg = String(e);
        debugInfo["x-proxy-mp-error"] = msg.slice(0, 500);
        return NextResponse.json(
          { detail: `proxy multipart parse failed: ${msg}` },
          { status: 500, headers: debugInfo },
        );
      }
    } else {
      const buf = await req.arrayBuffer();
      upstreamBody = Buffer.from(buf);
      headers["Content-Type"] = incomingCT;
    }
  } else {
    headers["Content-Type"] = incomingCT;
  }

  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: upstreamBody,
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
  const respHeaders: Record<string, string> = { "content-type": contentType, ...debugInfo };
  return new NextResponse(data, {
    status: upstream.status,
    headers: respHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
