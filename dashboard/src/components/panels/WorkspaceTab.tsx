// @ts-nocheck
'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, File, ChevronRight, ChevronDown, RefreshCw, ExternalLink, Eye, Code } from 'lucide-react';
import { useOrbitState } from '@/providers/OrbitProvider';

/**
 * WorkspaceTab — File tree browser + file preview in a resizable split pane.
 */
export default function WorkspaceTab() {
  const { currentSessionId, status, metrics } = useOrbitState();
  const [tree, setTree] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewMode, setPreviewMode] = useState('preview'); // 'preview' | 'raw'
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [dirContents, setDirContents] = useState(new Map());
  const [loading, setLoading] = useState(false);

  // The explorer is scoped to the CURRENT session's tree (~/.orbit/sessions/<id>/).
  const sessionQ = currentSessionId ? `&session=${encodeURIComponent(currentSessionId)}` : '';

  const expandedDirsRef = useRef(expandedDirs);
  const dirContentsRef = useRef(dirContents);
  useEffect(() => {
    expandedDirsRef.current = expandedDirs;
    dirContentsRef.current = dirContents;
  });

  const fetchDirectory = useCallback(async (dirPath) => {
    try {
      const res = await fetch(`/api/workspace/tree?path=${encodeURIComponent(dirPath)}${sessionQ}`);
      const data = await res.json();
      return data.tree || [];
    } catch {
      return [];
    }
  }, [sessionQ]);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workspace/tree?path=/workspace${sessionQ}`);
      const data = await res.json();
      setTree(data.tree || []);

      // Also refresh any currently expanded directories
      const currentExpanded = expandedDirsRef.current;
      if (currentExpanded.size > 0) {
        const nextContents = new Map(dirContentsRef.current);
        for (const dirPath of currentExpanded) {
          const contents = await fetch(`/api/workspace/tree?path=${encodeURIComponent(dirPath)}${sessionQ}`)
            .then(r => r.json())
            .then(d => d.tree || [])
            .catch(() => []);
          nextContents.set(dirPath, contents);
        }
        setDirContents(nextContents);
      }
    } catch { setTree([]); }
    setLoading(false);
  }, [sessionQ]);

  // Reset to the session root + reload when the active session changes.
  useEffect(() => {
    setActiveFile(null);
    setFileContent(null);
    setPreview(null);
    setExpandedDirs(new Set());
    setDirContents(new Map());
  }, [currentSessionId]);

  useEffect(() => {
    if (currentSessionId) {
      fetchTree();
    }
  }, [currentSessionId, fetchTree]);

  // Live refresh: agent-written files should appear without a manual Refresh.
  const fetchRef = useRef(fetchTree);
  useEffect(() => {
    fetchRef.current = fetchTree;
  });
  // Refetch when the agent finishes a turn (status → done) or a tool completes
  // (toolCalls bumps) — this fires on agent_end / tool_end WS events.
  useEffect(() => {
    if (currentSessionId) {
      fetchRef.current();
    }
  }, [status, metrics?.toolCalls, currentSessionId]);

  // Fallback: debounced ~4s poll while the Workspace tab is mounted (visible).
  useEffect(() => {
    const id = setInterval(() => {
      if (currentSessionId) {
        fetchRef.current();
      }
    }, 4000);
    return () => clearInterval(id);
  }, [currentSessionId]);

  const openFile = useCallback(async (filePath) => {
    setActiveFile(filePath);
    setFileContent(null);
    setPreview(null);
    try {
      const [fileRes, previewRes] = await Promise.all([
        fetch(`/api/workspace/file?path=${filePath}${sessionQ}`),
        fetch(`/api/workspace/preview?path=${filePath}${sessionQ}`),
      ]);
      setFileContent(await fileRes.json());
      setPreview(await previewRes.json());
    } catch { setFileContent({ error: true }); }
  }, [sessionQ]);

  const toggleDir = async (dirPath) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });

    if (!dirContents.has(dirPath)) {
      const contents = await fetchDirectory(dirPath);
      setDirContents((prev) => {
        const next = new Map(prev);
        next.set(dirPath, contents);
        return next;
      });
    }
  };

  const openInEditor = async (filePath) => {
    await fetch(`/api/workspace/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, session: currentSessionId }),
    });
  };

  // Render a single file/directory node recursively
  const renderNode = (entry, depth = 0) => {
    const isDir = entry.type === 'directory';
    const isExpanded = expandedDirs.has(entry.path);
    const children = dirContents.get(entry.path) || [];

    return (
      <div key={entry.path}>
        {isDir ? (
          <div>
            <div
              onClick={() => toggleDir(entry.path)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDir(entry.path); } }}
              style={{ paddingLeft: `${depth * 12 + 12}px` }}
              className="flex cursor-pointer items-center gap-1.5 px-3 py-1 text-[0.73rem] text-muted-foreground hover:bg-muted"
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Folder size={12} className="text-chart-3 shrink-0" />
              <span className="truncate">{entry.name}/</span>
            </div>
            {isExpanded && (
              <div className="flex flex-col">
                {children.length === 0 ? (
                  <div
                    style={{ paddingLeft: `${(depth + 1) * 12 + 28}px` }}
                    className="py-0.5 text-[0.7rem] text-muted-foreground/60 italic"
                  >
                    Empty
                  </div>
                ) : (
                  children.map((child) => renderNode(child, depth + 1))
                )}
              </div>
            )}
          </div>
        ) : (
          <div
            onClick={() => openFile(entry.path)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFile(entry.path); } }}
            style={{ paddingLeft: `${depth * 12 + 28}px` }}
            className={`flex cursor-pointer items-center gap-1.5 py-1 pr-3 text-[0.73rem] ${
              activeFile === entry.path ? 'bg-accent text-primary' : 'hover:bg-muted text-foreground/80'
            }`}
          >
            <File size={12} className="shrink-0 text-muted-foreground/75" />
            <span className="truncate">{entry.name}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[0.73rem] font-semibold">/workspace</span>
        <button onClick={fetchTree} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-muted">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* File tree */}
      <div className="max-h-[45%] flex-none overflow-y-auto py-1 border-b border-border">
        {loading && tree.length === 0 ? (
          <div className="p-3 text-center text-[0.7rem] text-muted-foreground">Loading...</div>
        ) : tree.length === 0 ? (
          <div className="p-3 text-center text-[0.7rem] text-muted-foreground">No files found.</div>
        ) : (
          tree.map((entry) => renderNode(entry, 0))
        )}
      </div>

      {/* File preview */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeFile ? (
          <>
            <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1">
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.7rem] text-muted-foreground">
                {activeFile}
              </span>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => setPreviewMode('preview')}
                  className={`flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[0.62rem] text-muted-foreground ${previewMode === 'preview' ? 'bg-muted' : ''}`}
                >
                  <Eye size={10} /> Preview
                </button>
                <button
                  onClick={() => setPreviewMode('raw')}
                  className={`flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[0.62rem] text-muted-foreground ${previewMode === 'raw' ? 'bg-muted' : ''}`}
                >
                  <Code size={10} /> Raw
                </button>
                <button onClick={() => openInEditor(activeFile)} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[0.62rem] text-muted-foreground">
                  <ExternalLink size={10} /> Open
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {!fileContent ? (
                <div className="p-5 text-center text-[0.7rem] text-muted-foreground">Loading...</div>
              ) : fileContent.error ? (
                <div className="p-5 text-center text-[0.7rem] text-destructive">Failed to load file.</div>
              ) : previewMode === 'raw' ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-[0.7rem] leading-normal">{fileContent.content}</pre>
              ) : (
                <div className="markdown-content text-[0.78rem]" dangerouslySetInnerHTML={{ __html: preview?.html || '' }} />
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-[0.73rem] text-muted-foreground">
            Select a file to preview
          </div>
        )}
      </div>
    </div>
  );
}
