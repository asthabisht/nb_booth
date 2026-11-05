// POST { imageBase64, name }  ->  { url: "https://<public-base>/<key>.jpg" }
// Uploads the final composite to Cloudflare R2 (S3-compatible) using aws4fetch —
// a tiny zero-dependency signer, so installs are reliable (no @aws-sdk tree).
// R2 keys stay server-side as env vars.

import { AwsClient } from "aws4fetch";

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_BASE, // e.g. https://pub-xxxx.r2.dev  OR  https://photos.yourdomain.com  (no trailing slash)
} = process.env;

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

const slug = (s) => (s || "guest").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "guest";

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_PUBLIC_BASE)
    return json(500, { error: "R2 env not configured" });

  let imageBase64, name;
  try { ({ imageBase64, name } = JSON.parse(event.body || "{}")); }
  catch { return json(400, { error: "bad JSON body" }); }
  if (!imageBase64) return json(400, { error: "imageBase64 required" });

  const day = new Date().toISOString().slice(0, 10);
  const key = `new-balance/${day}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${slug(name)}.jpg`;
  const body = Buffer.from(imageBase64, "base64");
  const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${encodeURIComponent(key).replace(/%2F/g, "/")}`;

  const aws = new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });

  try {
    const res = await aws.fetch(endpoint, {
      method: "PUT",
      body,
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000" },
    });
    if (!res.ok) return json(502, { error: "upload failed", detail: (await res.text()).slice(0, 300) });
    return json(200, { url: `${R2_PUBLIC_BASE.replace(/\/+$/, "")}/${key}` });
  } catch (e) {
    return json(502, { error: "upload failed", detail: String(e).slice(0, 300) });
  }
}
