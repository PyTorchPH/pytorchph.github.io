import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

if (process.env.PYTORCH_PH_ENV !== "showcase" || process.env.PYTORCH_PH_SHOWCASE_SEED !== "1") {
  throw new Error("Refusing to seed storage: set PYTORCH_PH_ENV=showcase and PYTORCH_PH_SHOWCASE_SEED=1.");
}
if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed while NODE_ENV=production.");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const root = path.resolve(import.meta.dirname, "..");
const user = "00000000-0000-4000-8000-000000000001";
const fixtures = ["ml-showcase.webp", "workshop-facilitation.webp", "hackathon-team.webp"];

for (const filename of fixtures) {
  const contents = await readFile(path.join(root, "public", "demo", "evidence", filename));
  const { error } = await client.storage.from("career-evidence-media").upload(`${user}/${filename}`, contents, {
    contentType: "image/webp",
    upsert: true,
  });
  if (error) throw new Error(`Failed to upload ${filename}: ${error.message}`);
}

console.log(`Uploaded ${fixtures.length} synthetic evidence photos to the showcase bucket.`);
