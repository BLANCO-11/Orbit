'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Monitor, FileText, RefreshCw, ExternalLink, AlertCircle, Maximize2, Minimize2, X } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

type Mode = 'live' | 'file';
interface OpenFile { kind: 'markdown' | 'image' | 'text'; content: string; name: string; language?: string }

const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];

/**
 * PreviewTab — one panel, two modes:
 *   Live — an iframe pointed at a real URL in the system (e.g. a dev server) so
 *          you can watch app/code changes render.
 *   File — render a workspace file (markdown → HTML, images inline, everything
 *          else as text). Reuses /api/workspace/file (sandboxed to ./workspace).
 * Kept as a single tab so previewing doesn't spawn extra UI regions.
 */
export default function PreviewTab() {
  const [mode, setMode] = useState<Mode>('live');
  const [fullscreen, setFullscreen] = useState(false);

  // Escape exits fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // Live
  const [url, setUrl] = useState('http://localhost:3000');
  const [liveSrc, setLiveSrc] = useState('');
  const [frameKey, setFrameKey] = useState(0);
  const loadLive = () => { setLiveSrc(url.trim()); setFrameKey((k) => k + 1); };

  // File
  const [filePath, setFilePath] = useState('/workspace/');
  const [file, setFile] = useState<OpenFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadFile = useCallback(async () => {
    const p = filePath.trim();
    if (!p) return;
    setErr(null); setBusy(true); setFile(null);
    const name = p.split('/').filter(Boolean).pop() || p;
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (IMG_EXT.includes(ext)) {
      // Images can't come back as JSON text; point an <img> at the raw route.
      setFile({ kind: 'image', content: `/api/workspace/file?path=${encodeURIComponent(p)}&raw=1`, name });
      setBusy(false);
      return;
    }
    try {
      const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(p)}`);
      const d = await res.json();
      if (!res.ok || d.success === false) { setErr(d.message || 'Could not open file.'); setBusy(false); return; }
      setFile({ kind: d.language === 'markdown' ? 'markdown' : 'text', content: d.content ?? '', name, language: d.language });
    } catch { setErr('Request failed.'); }
    setBusy(false);
  }, [filePath]);

  const renderMd = (text: string) => {
    try { return { __html: DOMPurify.sanitize(marked.parse(text, { breaks: true }) as string) }; }
    catch { return { __html: '' }; }
  };

  const panel = (
    <div className="flex h-full flex-col">
      {/* Mode toggle + address bar */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-border-soft p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex w-fit rounded-lg border border-border-soft bg-background p-0.5">
            {(['live', 'file'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-semibold capitalize transition-colors ${
                  mode === m ? 'bg-card text-foreground shadow-card' : 'text-faint hover:text-foreground'
                }`}
              >
                {m === 'live' ? <Monitor size={12} /> : <FileText size={12} />}
                {m}
              </button>
            ))}
          </div>
          <button
            onClick={() => setFullscreen((f) => !f)}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen preview'}
            title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>

        {mode === 'live' ? (
          <div className="flex items-center gap-1.5">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadLive()}
              placeholder="http://localhost:3000"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-[11.5px] outline-none focus:border-ring"
            />
            <button onClick={loadLive} aria-label="Load" className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground">
              <RefreshCw size={13} />
            </button>
            {liveSrc && (
              <a href={liveSrc} target="_blank" rel="noreferrer" aria-label="Open in new tab" className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground">
                <ExternalLink size={13} />
              </a>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadFile()}
              placeholder="/workspace/README.md"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-[11.5px] outline-none focus:border-ring"
            />
            <button onClick={loadFile} aria-label="Open file" className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground">
              <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === 'live' ? (
          liveSrc ? (
            <iframe
              key={frameKey}
              src={liveSrc}
              title="Live preview"
              className="h-full w-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          ) : (
            <Empty icon={<Monitor size={22} />} title="Live preview" hint="Enter a URL running in the system (a dev server, a local app) to watch it render here." />
          )
        ) : err ? (
          <div className="flex items-center gap-2 p-4 text-[12.5px] text-destructive"><AlertCircle size={15} /> {err}</div>
        ) : !file ? (
          <Empty icon={<FileText size={22} />} title="File preview" hint="Enter a /workspace path — markdown renders, images show inline, everything else as text." />
        ) : file.kind === 'image' ? (
          <div className="p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={file.content} alt={file.name} className="max-w-full rounded-lg border border-border-soft" />
          </div>
        ) : file.kind === 'markdown' ? (
          <div className="markdown-content p-4 text-[13px]" dangerouslySetInnerHTML={renderMd(file.content)} />
        ) : (
          <pre className="overflow-auto p-4 font-mono text-[11.5px] leading-relaxed text-muted-foreground">{file.content}</pre>
        )}
      </div>
    </div>
  );

  if (!fullscreen) return panel;

  // Fullscreen: dim backdrop + large centered surface. Click the backdrop or
  // the close button (or Esc) to return to the docked panel. Rendered as a
  // single instance (not duplicated behind) so only one iframe mounts.
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm sm:p-8"
      onClick={() => setFullscreen(false)}
    >
      <div
        className="flex h-full w-full max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-float"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border-soft px-3 py-2">
          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground">
            {mode === 'live' ? <Monitor size={13} /> : <FileText size={13} />}
            Preview — {mode === 'live' ? (liveSrc || 'live') : (file?.name || 'file')}
          </span>
          <button
            onClick={() => setFullscreen(false)}
            aria-label="Close fullscreen"
            title="Close (Esc)"
            className="grid size-7 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1">{panel}</div>
      </div>
    </div>
  );
}

function Empty({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <span className="text-faint">{icon}</span>
      <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
      <p className="max-w-[300px] text-xs leading-relaxed text-faint">{hint}</p>
    </div>
  );
}
