import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { backendFetch } from '@/lib/backend';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireSession() {
  if (process.env.REQUIRE_LOGIN !== '1') return null;
  const session = await getServerSession(authOptions);
  if (!session?.user?.email?.endsWith('@xertica.com')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

function buildPath(segments: string[], search: string): string {
  return `/${segments.join('/')}${search}`;
}

async function proxyMethod(req: NextRequest, params: { path: string[] }, method: string) {
  const guard = await requireSession();
  if (guard) return guard;
  const { search } = new URL(req.url);
  const ct = req.headers.get('content-type') || '';
  const buf = Buffer.from(await req.arrayBuffer());
  const opts: any = { method, headers: { 'content-type': ct }, rawBody: buf };
  if (buf.length === 0) delete opts.rawBody;
  const r = await backendFetch(buildPath(params.path, search), opts);
  const body = await r.text();
  return new NextResponse(body || null, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json' } });
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const guard = await requireSession();
  if (guard) return guard;
  const { search } = new URL(req.url);
  const r = await backendFetch(buildPath(params.path, search));
  const body = await r.text();
  return new NextResponse(body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json' } });
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyMethod(req, params, 'POST');
}

export async function PATCH(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyMethod(req, params, 'PATCH');
}

export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyMethod(req, params, 'DELETE');
}

