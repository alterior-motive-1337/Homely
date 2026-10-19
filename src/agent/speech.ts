import OpenAI from "openai";

export const MAX_SPEECH_INPUT_CHARACTERS = 200;
const SPEECH_MODEL = "canopylabs/orpheus-v1-english";
const SPEECH_VOICE = "autumn";

type GroqSpeechClient = Pick<OpenAI, "audio">;

export class GroqSpeechProvider {
  constructor(private readonly client: GroqSpeechClient) {}

  async synthesize(text: string): Promise<Buffer> {
    const input = text.trim();
    if (!input) throw new Error("Speech text is required.");
    if ([...input].length > MAX_SPEECH_INPUT_CHARACTERS) {
      throw new Error(`Speech text cannot exceed ${MAX_SPEECH_INPUT_CHARACTERS} characters.`);
    }
    const response = await this.client.audio.speech.create({
      model: SPEECH_MODEL,
      voice: SPEECH_VOICE,
      input,
      response_format: "wav"
    });
    return Buffer.from(await response.arrayBuffer());
  }
}
