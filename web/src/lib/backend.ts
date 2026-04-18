import { GoogleAuth } from 'google-auth-library';

const BACKEND_URL = process.env.BACKEND_URL || '';

let cachedClient: any = null;

async function getClient() {
  if (!BACKEND_URL) throw new Error('BACKEND_URL não configurado');
  if (cachedClient) return cachedClient;
  const auth = new GoogleAuth();
  cachedClient = await auth.getIdTokenClient(BACKEND_URL);
  return cachedClient;
}

export async function backendFetch(path: string, init?: RequestInit & { rawBody?: BodyInit }): Promise<Response> {
  if (!BACKEND_URL) throw new Error('BACKEND_URL não configurado');
  const client = await getClient();
  const headers = await client.getRequestHeaders();
  const url = `${BACKEND_URL}${path}`;
  const finalHeaders: Record<string, string> = { ...headers };
  if (init?.headers) {
    for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
      finalHeaders[k] = v;
    }
  }
  return fetch(url, {
    method: init?.method || 'GET',
    headers: finalHeaders,
    body: init?.rawBody ?? init?.body,
    // @ts-ignore — Next.js extension
    duplex: 'half',
  });
}
