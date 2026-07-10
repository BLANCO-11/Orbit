'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Folder, File, ChevronRight, ChevronDown, RefreshCw, ExternalLink, Eye, Code } from 'lucide-react';

/**
 * WorkspaceTab — File tree browser + file preview in a resizable split pane.
 */
export default function WorkspaceTab({ }) {
  const [tree, setTree] = useState([]);
  const [rootPath, setRootPath] = useState('/workspace');
  const [activeFile, setActiveFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewMode, setPreviewMode] = useState('preview'); // 'preview' | 'raw'
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [loading, setLoading] = useState(false);

  // Fetch file tree
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

  // Fetch file content
  const openFile = useCallback(async (filePath) => {
    setActiveFile(filePath);
    setFileContent(null);
    setPreview(null);
    try {
      const [fileRes, previewRes] = await Promise.all([
        fetch(`/api/workspace/file?path=${filePath}`),
        fetch(`/api/workspace/preview?path=${filePath}`),
      ]);
      const fileData = await fileRes.json();
      const previewData = await previewRes.json();
      setFileContent(fileData);
      setPreview(previewData);
    } catch { setFileContent({ error: true }); }
  }, []);

  // Toggle directory
  const toggleDir = (dirPath) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  // Open in system editor
  const openInEditor = async (filePath) => {
    await fetch(`/api/workspace/open`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <span style={{ fontSize: '0.73rem', fontWeight: '600', color: 'var(--text-primary)' }}>
          📁 {rootPath}
        </span>
        <button onClick={fetchTree} style={{
          background: 'none', border: '1px solid var(--border-subtle)', borderRadius: '4px',
          cursor: 'pointer', color: 'var(--text-tertiary)', padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '4px',
        }}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* File tree */}
      <div style={{ flex: '0 0 auto', maxHeight: '45%', overflowY: 'auto', padding: 'var(--space-1) 0' }}>
        {loading && tree.length === 0 ? (
          <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.7rem' }}>Loading...</div>
        ) : tree.length === 0 ? (
          <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.7rem' }}>No files found.</div>
        ) : (
          tree.map(entry => (
            <div key={entry.path}>
              {entry.type === 'directory' ? (
                <div>
                  <div onClick={() => toggleDir(entry.path)} style={{
                    display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 12px',
                    cursor: 'pointer', fontSize: '0.73rem', color: 'var(--text-secondary)',
                  }}>
                    {expandedDirs.has(entry.path) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <Folder size={12} style={{ color: 'var(--accent-info)' }} />
                    <span>{entry.name}/</span>
                  </div>
                </div>
              ) : (
                <div onClick={() => openFile(entry.path)} style={{
                  display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 12px 3px 28px',
                  cursor: 'pointer', fontSize: '0.73rem',
                  color: activeFile === entry.path ? 'var(--accent-primary)' : 'var(--text-primary)',
                  background: activeFile === entry.path ? 'var(--accent-primary-muted)' : 'transparent',
                }}>
                  <File size={12} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.name}
                  </span>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Divider */}
      <div style={{ height: '1px', background: 'var(--border-subtle)', flexShrink: 0 }} />

      {/* File preview */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {activeFile ? (
          <>
            {/* Preview toolbar */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
            }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {activeFile}
              </span>
              <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                <button onClick={() => setPreviewMode('preview')} style={{
                  background: previewMode === 'preview' ? 'var(--surface-elevated)' : 'none',
                  border: '1px solid var(--border-subtle)', borderRadius: '3px', cursor: 'pointer',
                  color: 'var(--text-secondary)', padding: '2px 6px', fontSize: '0.62rem', display: 'flex', alignItems: 'center', gap: '3px',
                }}><Eye size={10} /> Preview</button>
                <button onClick={() => setPreviewMode('raw')} style={{
                  background: previewMode === 'raw' ? 'var(--surface-elevated)' : 'none',
                  border: '1px solid var(--border-subtle)', borderRadius: '3px', cursor: 'pointer',
                  color: 'var(--text-secondary)', padding: '2px 6px', fontSize: '0.62rem', display: 'flex', alignItems: 'center', gap: '3px',
                }}><Code size={10} /> Raw</button>
                <button onClick={() => openInEditor(activeFile)} style={{
                  background: 'none', border: '1px solid var(--border-subtle)', borderRadius: '3px', cursor: 'pointer',
                  color: 'var(--text-secondary)', padding: '2px 6px', fontSize: '0.62rem', display: 'flex', alignItems: 'center', gap: '3px',
                }}><ExternalLink size={10} /> Open</button>
              </div>
            </div>

            {/* Preview content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
              {!fileContent ? (
                <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.7rem', padding: '20px' }}>Loading...</div>
              ) : fileContent.error ? (
                <div style={{ textAlign: 'center', color: 'var(--accent-danger)', fontSize: '0.7rem', padding: '20px' }}>Failed to load file.</div>
              ) : previewMode === 'raw' ? (
                <pre style={{
                  fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5, margin: 0,
                }}>{fileContent.content}</pre>
              ) : (
                <div
                  className="markdown-content"
                  style={{ fontSize: '0.78rem' }}
                  dangerouslySetInnerHTML={{ __html: preview?.html || '' }}
                />
              )}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text-tertiary)', fontSize: '0.73rem' }}>
            Select a file to preview
          </div>
        )}
      </div>
    </div>
  );
}
