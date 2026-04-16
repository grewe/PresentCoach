# PresentCoach: Google credentials and environment configuration

This app can call **Gemini** in two ways. Configure **either** Option **A** or Option **B** in your project root `.env` file. Only one path is used at a time (see precedence below).

## Which option runs?

| Priority | When it is used |
|----------|-----------------|
| **1** | If `GEMINI_API_KEY` is set → **Option A** (Gemini API, API key) |
| **2** | Else if `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` are set → **Option B** (Vertex AI) |
| **3** | Else → analysis is disabled until you configure credentials |

Restart the Node server after changing `.env`.

---

## Option A — Gemini API (API key: `GEMINI_API_KEY`)

Use this when you want the **Google AI (Generative Language) API** with a **browser/Cloud API key**. The Node server calls `@google/generative-ai`, which uses the **non-Vertex** Gemini endpoint.

### What to put in `.env`

```env
GEMINI_API_KEY=AIza...your-key-here
GEMINI_MODEL=gemini-2.0-flash
```

- **`GEMINI_API_KEY`** (required for Option A): The secret key string (often starts with `AIza`).
- **`GEMINI_MODEL`** (optional): Defaults to `gemini-2.0-flash` in code if omitted. Use a model ID that your key supports in your region.

Leave **unset** if you are using Option B only: do not set `GEMINI_API_KEY`, or Option A will take precedence even if you also set Vertex variables.

### Google Cloud Console (Option A)

1. **Select or create a project** in [Google Cloud Console](https://console.cloud.google.com/).

2. **Enable billing** for that project (Gemini API usage is billed; free tiers may apply depending on Google’s current offers).

3. **Enable the Generative Language API** (sometimes labeled **Gemini API** or **Google AI API** in the marketplace):
   - Open **APIs & Services → Library**.
   - Search for **Generative Language API**.
   - Click **Enable**.

4. **Create an API key**:
   - Go to **APIs & Services → Credentials**.
   - **Create credentials → API key**.
   - Copy the key into `GEMINI_API_KEY` in `.env`.

5. **Restrict the key** (recommended for production):
   - Edit the key and under **API restrictions**, restrict to **Generative Language API**.
   - Under **Application restrictions**, limit to your server IPs or use an appropriate restriction for where this Node app runs.

6. **IAM**: No service account is required for Option A if you only use the API key (the key is enough for the Gemini developer API path used by this app).

### Notes for Option A

- This is **not** the Vertex AI HTTP API; billing and quotas follow the **Gemini / Generative Language API** product.
- Inline video payloads are subject to current Gemini request size limits; very large segments may need a different upload strategy later.

---

## Option B — Vertex AI (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, credentials)

Use this when you want **Vertex AI** in your GCP project. The server uses **`@google-cloud/vertexai`**. Authentication is **not** the same as Option A’s API key: you use **Application Default Credentials** (ADC), usually a **service account JSON key file**.

### Preconditions for Option B in this app

- **Do not set `GEMINI_API_KEY`** if you want Option B to be used. If `GEMINI_API_KEY` is present, the app always chooses Option A first.

### What to put in `.env`

```env
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_CLOUD_LOCATION=us-central1
GEMINI_MODEL=gemini-2.0-flash-001
```

- **`GOOGLE_CLOUD_PROJECT`** (required): Your GCP **Project ID** (not necessarily the display name).
- **`GOOGLE_CLOUD_LOCATION`** (required): A supported Vertex **region** for Gemini (examples: `us-central1`, `europe-west4`). Must match where you use Vertex models.
- **`GEMINI_MODEL`** (optional): A model ID available in that region on Vertex (examples may include `gemini-2.0-flash-001`; names change over time—check current Vertex documentation for your region).

**Credentials for the server process** (pick one common approach):

```env
GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account-key.json
```

- On Windows, use a path to the downloaded JSON key file (escape backslashes or use forward slashes if your shell allows).
- On Linux/macOS, use `/path/to/key.json`.

Alternatively, run the app on a machine that already has ADC (GCE/GKE workload identity, `gcloud auth application-default login` for local dev, etc.) without setting `GOOGLE_APPLICATION_CREDENTIALS`.

### Google Cloud Console (Option B)

1. **Select the same project** whose ID you put in `GOOGLE_CLOUD_PROJECT`.

2. **Enable billing** if not already enabled.

3. **Enable the Vertex AI API**:
   - **APIs & Services → Library** → search **Vertex AI API** → **Enable**.

4. **Service account** (typical for a Node server with a JSON key):
   - **IAM & Admin → Service Accounts → Create service account**.
   - Grant a role that allows calling Vertex generative models, for example:
     - **Vertex AI User** (`roles/aiplatform.user`), or
     - A custom role that includes the minimum permissions your organization allows for `aiplatform` generateContent in your region.
   - **Keys → Add key → Create new key → JSON** and download the file.
   - Set `GOOGLE_APPLICATION_CREDENTIALS` in `.env` to that JSON path (or use ADC as above).

5. **Region**: Pick a region where **Gemini** is available on Vertex (see Google’s current Vertex documentation). Set `GOOGLE_CLOUD_LOCATION` to that region.

6. **Model access**: Some models require explicit enablement or access in the console; if a call fails with permission or “model not found” errors, verify the model ID and region in the Vertex AI / Model Garden documentation.

### Notes for Option B

- This path uses **Vertex AI** endpoints and **project/region** billing, not the standalone Generative Language API key path.
- The code sends the video as **inline base64** to the model; limits follow Vertex/Gemini inline payload rules.

---

## Quick verification

- With the server running, open `GET /api/health`. The response includes `geminiConfigured: true` when either Option A or Option B is satisfied.
- The app also checks this before analyzing, but the server always enforces configuration on `POST /api/analyze`.

## Viewing this file from the running app

With the Node server up (including behind the Vite dev proxy), you can open **`/api/docs/readme`** in the browser to read this markdown file as served by the server.
