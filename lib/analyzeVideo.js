import { GoogleGenerativeAI } from "@google/generative-ai";
import { VertexAI } from "@google-cloud/vertexai";

const SPEECH_COACH_PROMPT = `You are a professional speech coach. I am going to send you a short up to 10 second sequence of a video speech and ask you to output the following:

1) Transcript: give a transcript of the audio/what was said by the speaker

2) Content: analyze the text and video content and tell if the content is understandable, if it is professional, if it is correct, if it is up to date

3) Face Analysis: if a face is detected in the video analyze how relaxed, animated, appropriate the facial expressions are during the speech.

4) Body Analysis: if a body is detected in the video analyze how relaxed, animated, appropriate the body expressions are during the speech.`;

function vertexResponseText(result) {
  const parts = result.response?.candidates?.[0]?.content?.parts;
  if (!parts?.length) return "";
  return parts.map((p) => p.text ?? "").join("");
}

async function analyzeWithGeminiApi(buffer) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");

  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: "video/mp4",
        data: buffer.toString("base64"),
      },
    },
    { text: SPEECH_COACH_PROMPT },
  ]);

  return result.response.text();
}

async function analyzeWithVertex(buffer) {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION;
  if (!project || !location) {
    throw new Error(
      "Vertex AI requires GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION (and Application Default Credentials, e.g. GOOGLE_APPLICATION_CREDENTIALS)."
    );
  }

  const modelName =
    process.env.GEMINI_MODEL || "gemini-2.0-flash-001";

  const vertexAI = new VertexAI({ project, location });
  const model = vertexAI.getGenerativeModel({ model: modelName });

  const request = {
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "video/mp4",
              data: buffer.toString("base64"),
            },
          },
          { text: SPEECH_COACH_PROMPT },
        ],
      },
    ],
  };

  const result = await model.generateContent(request);
  const text = vertexResponseText(result);
  if (!text) {
    throw new Error("Vertex AI returned no text (check model name, region, and permissions).");
  }
  return text;
}

/**
 * Sends an MP4 buffer to Gemini (Google AI API with API key, or Vertex AI with ADC).
 */
export async function analyzeVideoMp4(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    buffer = Buffer.from(buffer);
  }

  if (process.env.GEMINI_API_KEY) {
    return analyzeWithGeminiApi(buffer);
  }

  if (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_LOCATION) {
    return analyzeWithVertex(buffer);
  }

  throw new Error(
    "Configure GEMINI_API_KEY for the Gemini API, or set GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION (and credentials) for Vertex AI."
  );
}
