import assert from "node:assert/strict";
import test from "node:test";
import { GroqSpeechProvider, MAX_SPEECH_INPUT_CHARACTERS } from "../src/agent/speech.js";

test("Groq Orpheus synthesis requests short English WAV audio", async () => {
  let request: Record<string, unknown> | undefined;
  const provider = new GroqSpeechProvider({
    audio: {
      speech: {
        async create(input: Record<string, unknown>) {
          request = input;
          return new Response(Buffer.from("wav-audio"));
        }
      }
    }
  } as never);

  assert.deepEqual(await provider.synthesize("  Hello from Homely.  "), Buffer.from("wav-audio"));
  assert.deepEqual(request, {
    model: "canopylabs/orpheus-v1-english",
    voice: "autumn",
    input: "Hello from Homely.",
    response_format: "wav"
  });
});

test("Groq Orpheus rejects empty and over-limit speech before calling the provider", async () => {
  let requests = 0;
  const provider = new GroqSpeechProvider({
    audio: { speech: { async create() { requests++; return new Response(); } } }
  } as never);

  await assert.rejects(provider.synthesize("   "), /required/);
  await assert.rejects(provider.synthesize("a".repeat(MAX_SPEECH_INPUT_CHARACTERS + 1)), /200 characters/);
  await assert.rejects(provider.synthesize("🙂".repeat(201)), /200 characters/);
  assert.equal(requests, 0);
});
