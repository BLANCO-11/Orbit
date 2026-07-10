// @ts-nocheck
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Folder, File, ChevronRight, ChevronDown, RefreshCw, ExternalLink, Eye, Code } from 'lucide-react';

/**
 * WorkspaceTab — File tree browser + file preview in a resizable split pane.
 */
export default function WorkspaceTab() {
  const [tree, setTree] = useState([]);
  const [rootPath, setRootPath] = useState('/workspace');
  const [activeFile, setActiveFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewMode, setPreviewMode] = useState('preview'); // 'preview' | 'raw'
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [loading, setLoading] = useState(false);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workspace/tree?path=${rootPath}`);
      const data = await res.json();
      setTree(data.tree || []);
    } catch { setTree([]); }
    setLoading(false);
  }, [rootPath]);

  useEffect(() => { fetchTree(); }, [fetchTree]);

  const openFile = useCallback(async (filePath) => {
    setActiveFile(filePath);
    setFileContent(null);
    setPreview(null);
    try {
      const [fileRes, previewRes] = await Promise.all([
        fetch(`/api/workspace/file?path=${filePath}`),
        fetch(`/api/workspace/preview?path=${filePath}`),
      ]);
      setFileContent(await fileRes.json());
      setPreview(await previewRes.json());
    } catch { setFileContent({ error: true }); }
  }, []);

  const toggleDir = (dirPath) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  const openInEditor = async (filePath) => {
    await fetch(`/api/workspace/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[0.73rem] font-semibold">{rootPath}</span>
        <button onClick={fetchTree} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-muted">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* File tree */}
      <div className="max-h-[45%] flex-none overflow-y-auto py-1">
        {loading && tree.length === 0 ? (
          <div className="p-3 text-center text-[0.7rem] text-muted-foreground">Loading...</div>
        ) : tree.length === 0 ? (
          <div className="p-3 text-center text-[0.7rem] text-muted-foreground">No files found.</div>
        ) : (
          tree.map((entry) => (
            <div key={entry.path}>
              {entry.type === 'directory' ? (
                <div
                  onClick={() => toggleDir(entry.path)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDir(entry.path); } }}
                  className="flex cursor-pointer items-center gap-1 px-3 py-0.5 text-[0.73rem] text-muted-foreground hover:bg-muted"
                >
                  {expandedDirs.has(entry.path) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <Folder size={12} className="text-chart-3" />
                  <span>{entry.name}/</span>
                </div>
              ) : (
                <div
                  onClick={() => openFile(entry.path)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFile(entry.path); } }}
                  className={`flex cursor-pointer items-center gap-1 py-0.5 pl-7 pr-3 text-[0.73rem] ${
                    activeFile === entry.path ? 'bg-accent text-primary' : 'hover:bg-muted'
                  }`}
                >
                  <File size={12} />
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{entry.name}</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="h-px shrink-0 bg-border" />

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
