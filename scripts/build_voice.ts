// Records the auctioneer's voice: one short clip for every name, price, team
// and stock phrase he can say (client/src/voice/clips.ts lists them), written
// to static/voice/ with a manifest. The game then speaks with this one voice
// for every player instead of each device's own.
//
//   npm run voice                       # ElevenLabs (needs ELEVENLABS_API_KEY in .env)
//   npm run voice -- --dry-run          # just count the clips and characters
//   npm run voice -- --provider say     # macOS's built-in voice, to try it out for free
//   npm run voice -- --only fixed       # one group: fixed | amounts | names
//   npm run voice -- --slow             # one clip at a time with a pause, if the provider objects to bursts
//
// Clips that already exist are kept, so a rerun only records what's missing.
// Delete static/voice/ to start again with another voice.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gameData, teamInfo } from "@auction/shared/data";
import { catalogue, type ClipText } from "../client/src/voice/clips";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "static", "voice");
try { process.loadEnvFile(join(root, ".env")); } catch { /* no .env: use the environment */ }

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

interface Provider {
  label: string;
  ext: string;
  /** How many clips to record at once. */
  parallel: number;
  record: (text: string, file: string) => Promise<void>;
}

/** ElevenLabs text-to-speech. The default voice is "George", a warm, mature British man. */
function elevenLabs(): Provider {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    console.error("Set ELEVENLABS_API_KEY in .env (elevenlabs.io > your profile > API keys), or try --provider say.");
    process.exit(1);
  }
  const voice = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";
  const model = process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2";
  return {
    label: `ElevenLabs voice ${voice}`,
    ext: "mp3",
    parallel: 3,
    async record(text, file) {
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_96`, {
          method: "POST",
          headers: { "xi-api-key": key, "content-type": "application/json" },
          body: JSON.stringify({
            text,
            model_id: model,
            // Steady and a little animated: an auctioneer, not a newsreader.
            voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.25 },
          }),
        });
        if (res.ok) {
          writeFileSync(file, Buffer.from(await res.arrayBuffer()));
          return;
        }
        // Rate limits and hiccups: wait and try again. Anything else (bad key, no credit) stops the run.
        if ((res.status === 429 || res.status >= 500) && attempt < 5) {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          continue;
        }
        throw new Error(`ElevenLabs said ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
    },
  };
}

/**
 * macOS's own speech, for trying the system out without an account. Apple's
 * voices are licensed for personal use: don't publish clips made this way.
 */
function macSay(): Provider {
  const voice = process.env.SAY_VOICE ?? "Daniel";
  return {
    label: `macOS voice ${voice}`,
    ext: "m4a",
    parallel: 4,
    async record(text, file) {
      const aiff = join(tmpdir(), `voice-${process.pid}-${Math.random().toString(36).slice(2)}.aiff`);
      execFileSync("say", ["-v", voice, "-r", "185", "-o", aiff, text]);
      execFileSync("afconvert", ["-f", "m4af", "-d", "aac", aiff, file]);
      rmSync(aiff);
    },
  };
}

const GROUPS: Record<string, (key: string) => boolean> = {
  names: (k) => k.startsWith("name-"),
  amounts: (k) => k.startsWith("amount-"),
  fixed: (k) => !k.startsWith("name-") && !k.startsWith("amount-"),
};

async function main() {
  const all = catalogue(gameData, Object.values(teamInfo));
  const only = option("only");
  if (only && !GROUPS[only]) throw new Error(`--only takes one of: ${Object.keys(GROUPS).join(", ")}`);
  const wanted = only ? all.filter((c) => GROUPS[only]!(c.key)) : all;

  const provider = option("provider") === "say" ? macSay : elevenLabs;
  const ext = option("provider") === "say" ? "m4a" : "mp3";
  const have = new Set(existsSync(outDir) ? readdirSync(outDir) : []);
  const other = [...have].find((f) => f !== "manifest.json" && !f.endsWith(`.${ext}`));
  if (other) throw new Error(`static/voice/ holds clips from another voice (${other}). Delete the folder to switch.`);
  const missing = wanted.filter((c) => !have.has(`${c.key}.${ext}`));
  const chars = missing.reduce((n, c) => n + c.text.length, 0);
  console.log(`${all.length} clips in all; ${missing.length} to record (${chars} characters).`);
  if (flag("dry-run")) return;

  let failure: Error | null = null;
  if (missing.length) {
    const p = provider();
    console.log(`Recording with ${p.label}...`);
    mkdirSync(outDir, { recursive: true });
    const queue = [...missing];
    let done = 0;
    const worker = async () => {
      for (let c: ClipText | undefined; (c = queue.shift());) {
        await p.record(c.text, join(outDir, `${c.key}.${ext}`));
        if (flag("slow")) await new Promise((r) => setTimeout(r, 700));
        if (++done % 25 === 0 || done === missing.length) console.log(`  ${done} / ${missing.length}`);
      }
    };
    // If the provider stops us part-way (quota, a blocked account), keep what was recorded.
    await Promise.all(Array.from({ length: flag("slow") ? 1 : p.parallel }, worker)).catch((err: Error) => { failure = err; });
  }

  // The manifest lists what's really there. The game only uses the recordings
  // once the set is usable: every phrase, team and price, and nearly every
  // name. (Half his lines in one voice and half in the browser's would be
  // worse than either; a rare player announced by the browser is fine.)
  const files = new Set(readdirSync(outDir));
  const has = (k: string) => files.has(`${k}.${ext}`);
  const clips = all.map((c) => c.key).filter(has);
  const names = all.filter((c) => GROUPS.names!(c.key));
  const namesMissing = names.filter((c) => !has(c.key));
  const complete = all.every((c) => GROUPS.names!(c.key) || has(c.key)) && namesMissing.length <= names.length * 0.05;
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify({ ext, complete, clips })}\n`);
  console.log(`static/voice/ now has ${clips.length} of ${all.length} clips.`);
  if (!complete) console.log("The game keeps using the browser's voice until the set is usable. Run this again to record the rest.");
  else if (namesMissing.length) console.log(`Still to record: ${namesMissing.map((c) => c.text).join(" ")} (the browser's voice covers them).`);
  if (failure) throw failure;
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
