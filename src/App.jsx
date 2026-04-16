import { useCallback, useEffect, useRef, useState } from "react";
import { segmentCountFromDuration } from "./segmentMath.js";
import "./App.css";

export default function App() {
  const fileInputRef = useRef(null);
  const objectUrlRef = useRef(null);
  const fileRef = useRef(null);
  const uploadIdRef = useRef(0);
  const splitAbortRef = useRef(null);
  const segmentUrlsRef = useRef([]);
  const lastMetadataUploadIdRef = useRef(-1);

  const [videoSrc, setVideoSrc] = useState(null);
  const [segments, setSegments] = useState([]);
  const [splitStatus, setSplitStatus] = useState("idle");
  const [splitError, setSplitError] = useState(null);
  const [analysisBySeq, setAnalysisBySeq] = useState({});
  const [geminiConfigured, setGeminiConfigured] = useState(null);

  const missingCredMessage = (seq) =>
    `Sequence ${seq} can not be analyzed as the .env specifying Google Credentials was not set properly.`;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) setGeminiConfigured(Boolean(data?.geminiConfigured));
      })
      .catch(() => {
        if (!cancelled) setGeminiConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const revokeSegmentUrls = useCallback(() => {
    segmentUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    segmentUrlsRef.current = [];
  }, []);

  const revokeCurrentUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      revokeSegmentUrls();
      revokeCurrentUrl();
    },
    [revokeCurrentUrl, revokeSegmentUrls]
  );

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isMp4 =
      file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
    if (!isMp4) {
      e.target.value = "";
      return;
    }

    splitAbortRef.current?.abort();
    splitAbortRef.current = new AbortController();

    uploadIdRef.current += 1;
    revokeSegmentUrls();
    revokeCurrentUrl();

    fileRef.current = file;
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setVideoSrc(url);
    setSegments([]);
    setSplitError(null);
    setSplitStatus("loading");
    setAnalysisBySeq({});

    e.target.value = "";
  };

  const handleMainVideoLoadedMetadata = async (e) => {
    const uploadId = uploadIdRef.current;
    const file = fileRef.current;
    const duration = e.target.duration;

    if (!file || uploadIdRef.current !== uploadId) return;

    if (lastMetadataUploadIdRef.current === uploadId) return;
    lastMetadataUploadIdRef.current = uploadId;

    if (!Number.isFinite(duration) || duration <= 0) {
      setSplitError("Could not read video duration.");
      setSplitStatus("error");
      return;
    }

    const count = segmentCountFromDuration(duration);

    if (count === 0) {
      setSplitError("Invalid video length.");
      setSplitStatus("error");
      return;
    }

    if (count === 1) {
      if (uploadIdRef.current !== uploadId) return;
      setSegments([{ seq: 1, url: objectUrlRef.current }]);
      setSplitStatus("ready");
      return;
    }

    const signal = splitAbortRef.current?.signal;
    if (!signal) {
      setSplitStatus("error");
      return;
    }

    setSplitStatus("loading");

    try {
      const { splitVideoSegments } = await import("./splitVideoSegments.js");
      const list = await splitVideoSegments(file, duration, signal);

      if (uploadIdRef.current !== uploadId) {
        list.forEach((s) => URL.revokeObjectURL(s.url));
        return;
      }

      segmentUrlsRef.current = list.map((s) => s.url);
      setSegments(list);
      setSplitStatus("ready");
    } catch (err) {
      if (uploadIdRef.current !== uploadId) return;
      if (err?.name === "AbortError") return;
      setSplitError(err instanceof Error ? err.message : "Split failed.");
      setSplitStatus("error");
    }
  };

  const handleAnalyze = async (seq, url) => {
    if (geminiConfigured === false) {
      setAnalysisBySeq((prev) => ({
        ...prev,
        [seq]: {
          status: "error",
          error: missingCredMessage(seq),
          credError: true,
        },
      }));
      return;
    }

    setAnalysisBySeq((prev) => ({
      ...prev,
      [seq]: { status: "loading" },
    }));
    try {
      const blob = await fetch(url).then((r) => r.blob());
      const fd = new FormData();
      fd.append("video", blob, `sequence-${seq}.mp4`);
      const res = await fetch("/api/analyze", {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503 && data?.code === "MISSING_GOOGLE_CREDENTIALS") {
        setAnalysisBySeq((prev) => ({
          ...prev,
          [seq]: {
            status: "error",
            error: missingCredMessage(seq),
            credError: true,
          },
        }));
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      if (typeof data.text !== "string") {
        throw new Error("Invalid response from server.");
      }
      setAnalysisBySeq((prev) => ({
        ...prev,
        [seq]: { status: "done", text: data.text },
      }));
    } catch (e) {
      setAnalysisBySeq((prev) => ({
        ...prev,
        [seq]: {
          status: "error",
          error: e instanceof Error ? e.message : "Analysis failed.",
        },
      }));
    }
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Present Coach</h1>
      </header>

      <main className="app__main">
        <section className="app__panel app__panel--actions" aria-label="Actions">
          <input
            ref={fileInputRef}
            type="file"
            className="app__file-input"
            accept="video/mp4,.mp4"
            aria-hidden
            tabIndex={-1}
            onChange={handleFileChange}
          />
          <button type="button" className="app__btn">
            Record
          </button>
          <button type="button" className="app__btn" onClick={handleUploadClick}>
            Upload
          </button>

          {videoSrc ? (
            <div className="app__video-block">
              <div className="app__video-frame">
                <video
                  className="app__video"
                  src={videoSrc}
                  controls
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={handleMainVideoLoadedMetadata}
                >
                  Your browser does not support embedded video.
                </video>
              </div>
            </div>
          ) : null}
        </section>

        <section className="app__panel app__panel--analysis" aria-label="Analysis">
          <h2 className="app__analysis-title">Analysis</h2>
          <div className="app__table-wrap">
            <table className="app__table">
              <thead>
                <tr>
                  <th scope="col">Sequence</th>
                  <th scope="col">Analysis</th>
                </tr>
              </thead>
              <tbody>
                {!videoSrc ? (
                  <tr>
                    <td colSpan={2} className="app__table-placeholder">
                      Upload a video to see sequences.
                    </td>
                  </tr>
                ) : splitStatus === "loading" ? (
                  <tr>
                    <td colSpan={2} className="app__table-placeholder">
                      Preparing sequences…
                    </td>
                  </tr>
                ) : splitStatus === "error" ? (
                  <tr>
                    <td colSpan={2} className="app__table-placeholder app__table-placeholder--error">
                      {splitError ?? "Something went wrong."}
                    </td>
                  </tr>
                ) : (
                  segments.map(({ seq, url }) => {
                    const row = analysisBySeq[seq];
                    const loading = row?.status === "loading";
                    const done = row?.status === "done";
                    const err = row?.status === "error";
                    const credError = Boolean(row?.credError);

                    return (
                      <tr key={seq}>
                        <td>
                          <div className="app__seq-cell">
                            <span className="app__seq-label">Sequence {seq}</span>
                            <div className="app__seq-video-wrap">
                              <video
                                className="app__seq-video"
                                src={url}
                                controls
                                playsInline
                                preload="metadata"
                              />
                            </div>
                          </div>
                        </td>
                        <td className="app__analysis-cell">
                          <div className="app__analysis-stack">
                            <button
                              type="button"
                              className="app__btn app__btn--analyze"
                              disabled={loading}
                              onClick={() => handleAnalyze(seq, url)}
                            >
                              {loading ? "Analyzing…" : "Analyze"}
                            </button>
                            {loading ? (
                              <p className="app__analysis-hint">Calling Gemini…</p>
                            ) : null}
                            {done && row?.text ? (
                              <pre className="app__analysis-text">{row.text}</pre>
                            ) : null}
                            {err && row?.error ? (
                              <>
                                <p className="app__analysis-error">{row.error}</p>
                                {credError ? (
                                  <a
                                    className="app__doc-link"
                                    href="/api/docs/readme"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    Open setup documentation (docs/README.md)
                                  </a>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
