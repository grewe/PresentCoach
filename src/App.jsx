import { useCallback, useEffect, useRef, useState } from "react";
import { segmentCountFromDuration } from "./segmentMath.js";
import "./App.css";

export default function App() {
  // Refs for file input, video object URL, and file data
  const fileInputRef = useRef(null);
  const objectUrlRef = useRef(null);
  const fileRef = useRef(null);
  
  // Track upload sessions and abort split operations
  const uploadIdRef = useRef(0);
  const splitAbortRef = useRef(null);
  
  // Cache segment URLs and track metadata upload
  const segmentUrlsRef = useRef([]);
  const lastMetadataUploadIdRef = useRef(-1);

  // UI state
  const [videoSrc, setVideoSrc] = useState(null);
  const [segments, setSegments] = useState([]);
  const [splitStatus, setSplitStatus] = useState("idle");
  const [splitError, setSplitError] = useState(null);
  const [analysisBySeq, setAnalysisBySeq] = useState({});
  const [geminiConfigured, setGeminiConfigured] = useState(null);

  const missingCredMessage = (seq) =>
    `Sequence ${seq} can not be analyzed as the .env specifying Google Credentials was not set properly.`;

  // Check if Gemini API is configured on mount
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

  // Revoke all segment blob URLs
  const revokeSegmentUrls = useCallback(() => {
    segmentUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    segmentUrlsRef.current = [];
  }, []);

  // Revoke main video blob URL
  const revokeCurrentUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  // Cleanup blob URLs on unmount
  useEffect(
    () => () => {
      revokeSegmentUrls();
      revokeCurrentUrl();
    },
    [revokeCurrentUrl, revokeSegmentUrls]
  );

  // Trigger file input dialog
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // Handle video file selection and validation
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isMp4 =
      file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
    if (!isMp4) {
      e.target.value = "";
      return;
    }

    // Cancel previous split operation and reset state
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

  //************************************************************* */
  // Process video metadata and split into segments
  const handleMainVideoLoadedMetadata = async (e) => {
    // Capture current upload session ID to detect cancellations
    const uploadId = uploadIdRef.current;
    const file = fileRef.current;
    const duration = e.target.duration;

    // Abort if file is missing or upload session has changed
    if (!file || uploadIdRef.current !== uploadId) return;

    // Prevent duplicate processing of the same metadata event
    if (lastMetadataUploadIdRef.current === uploadId) return;
    lastMetadataUploadIdRef.current = uploadId;

    // Validate video duration is available and positive
    if (!Number.isFinite(duration) || duration <= 0) {
      setSplitError("Could not read video duration.");
      setSplitStatus("error");
      return;
    }

    // Calculate how many segments the video should be split into
    const count = segmentCountFromDuration(duration);

    // Handle invalid video length
    if (count === 0) {
      setSplitError("Invalid video length.");
      setSplitStatus("error");
      return;
    }

    // Single segment: no need to split, use original video
    if (count === 1) {
      if (uploadIdRef.current !== uploadId) return;
      setSegments([{ seq: 1, url: objectUrlRef.current }]);
      setSplitStatus("ready");
      return;
    }

    // Get abort signal for cancelling split operation
    const signal = splitAbortRef.current?.signal;
    if (!signal) {
      setSplitStatus("error");
      return;
    }

    setSplitStatus("loading");

    try {
      // Dynamically import split function and process video
      const { splitVideoSegments } = await import("./splitVideoSegments.js");
      const list = await splitVideoSegments(file, duration, signal);

      // Clean up if upload was cancelled while processing
      if (uploadIdRef.current !== uploadId) {
        list.forEach((s) => URL.revokeObjectURL(s.url));
        return;
      }

      // Cache segment URLs and update state with segments
      segmentUrlsRef.current = list.map((s) => s.url);
      setSegments(list);
      setSplitStatus("ready");
    } catch (err) {
      // Ignore errors from cancelled uploads or aborted operations
      if (uploadIdRef.current !== uploadId) return;
      if (err?.name === "AbortError") return;
      
      // Display error message to user
      setSplitError(err instanceof Error ? err.message : "Split failed.");
      setSplitStatus("error");
    }
  };

  // Send segment to Gemini API for analysis
  const handleAnalyze = async (seq, url) => {
    // Check if Gemini API is configured; if not, show error
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

    // Set loading state while waiting for API response
    setAnalysisBySeq((prev) => ({
      ...prev,
      [seq]: { status: "loading" },
    }));
    
    try {
      // Fetch video blob from the segment URL
      const blob = await fetch(url).then((r) => r.blob());
      
      // Prepare FormData with video file
      const fd = new FormData();
      fd.append("video", blob, `sequence-${seq}.mp4`);
      
      // Send video to analysis API endpoint
      const res = await fetch("/api/analyze", {
        method: "POST",
        body: fd,
      });
      
      // Parse response JSON, default to empty object if parsing fails
      const data = await res.json().catch(() => ({}));
      
      // Handle missing Google credentials error
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
      
      // Check for general request errors
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      
      // Validate response contains analysis text
      if (typeof data.text !== "string") {
        throw new Error("Invalid response from server.");
      }
      
      // Store successful analysis result
      setAnalysisBySeq((prev) => ({
        ...prev,
        [seq]: { status: "done", text: data.text },
      }));
    } catch (e) {
      // Handle and display any errors that occurred during analysis
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
        {/* Upload and video playback section */}
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

        {/* Analysis results section */}
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
