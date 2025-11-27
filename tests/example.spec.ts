import { test } from '@playwright/test';
import * as fs from 'fs';

const TARGET_URL = 'https://playground.testingmavens.tools';

// Configure what to include/exclude. Adjust these patterns for your target site.
const includePatterns: Array<RegExp> = [/\/api\//i, /graphql/i, /\/v1\//i];
const excludePatterns: Array<RegExp> = [/\.(css|png|jpg|svg|ico)$/i, /google-analytics\.com/i];
const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function matchesAny(url: string, patterns: Array<RegExp>) {
  return patterns.some(p => p.test(url));
}

function shouldSaveRequest(url: string, resourceType: string, method: string) {
  if (!(resourceType === 'xhr' || resourceType === 'fetch' || resourceType === 'other')) return false;
  if (!allowedMethods.has(method.toUpperCase())) return false;
  if (matchesAny(url, excludePatterns)) return false;
  if (includePatterns.length > 0) return matchesAny(url, includePatterns);
  return true;
}

test('API crawling and export', async ({ page }) => {

  const captured: Array<any> = [];
  let idCounter = 1;

  // 🟢 Ensure export directory exists
  fs.mkdirSync('ExportApi', { recursive: true });

  page.on('request', (req) => {
    try {
      const url = req.url();
      const method = req.method();
      const rtype = req.resourceType();
      if (!shouldSaveRequest(url, rtype, method)) return;

      const entry = {
        id: `req-${idCounter++}`,
        url,
        method,
        resourceType: rtype,
        requestHeaders: req.headers(),
        postData: req.postData() || undefined,
        timestamp: new Date().toISOString(),
        response: undefined as any
      };
      captured.push(entry);
      console.log('Captured request:', method, url);
    } catch (e) {
      console.error('Error in request handler', e);
    }
  });

  page.on('response', async (res) => {
    try {
      const url = res.url();
      const method = res.request().method();

      const entry = captured.find(e => e.url === url && e.method === method && !e.response);
      if (!entry) return;

      const headers = res.headers();
      let body: string | undefined = undefined;

      try {
        const buffer = await res.body();
        const text = buffer.toString('utf8');
        body = /\x00/.test(text) ? buffer.toString('base64') : text;
      } catch (e) {
        body = undefined;
      }

      entry.response = {
        status: res.status(),
        statusText: res.statusText(),
        headers,
        body
      };

      console.log('Attached response:', entry.method, entry.url, 'status', entry.response.status);
    } catch (e) {
      console.error('Error in response handler', e);
    }
  });

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  // 🟢 Save raw captured entries
  const outPath = 'ExportApi/saved_api_requests.json';
  fs.writeFileSync(outPath, JSON.stringify(captured, null, 2));
  console.log(`✓ Saved ${captured.length} API requests to ${outPath}`);

  // 🟢 Prepare Postman collection
  const collection = {
    info: {
      name: 'Discovered API Requests',
      description: `Captured on ${new Date().toISOString()}`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: captured.map((e: any) => ({
      name: `${e.method} ${e.url}`,
      request: {
        method: e.method,
        header: Object.entries(e.requestHeaders || {}).map(([k, v]) => ({ key: k, value: String(v) })),
        body: e.postData ? { mode: 'raw', raw: e.postData } : undefined,
        url: e.url
      }
    }))
  };

  fs.writeFileSync('ExportApi/postman_api_requests.json', JSON.stringify(collection, null, 2));
  console.log('✓ Wrote Postman collection to ExportApi/postman_api_requests.json');
});
