/**
 * Proxy route — forwards all requests to the FastAPI backend,
 * injecting the Google ID-token from the NextAuth session.
 *
 * /api/proxy/proc/contratacoes → BACKEND_URL/proc/contratacoes
 */
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = (await getServerSession(authOptions)) as
    | (Awaited<ReturnType<typeof getServerSession>> & { idToken?: string })
    | null;

  if (!session) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const resolvedParams = await params;
  const backendPath = "/" + resolvedParams.path.join("/");
  const search = req.nextUrl.search ?? "";
  const targetUrl = `${BACKEND}${backendPath}${search}`;

  const headers: Record<string, string> = {
    "Content-Type": req.headers.get("content-type") ?? "application/json",
  };
  if (session.idToken) {
    headers["Authorization"] = `Bearer ${session.idToken}`;
  }

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
