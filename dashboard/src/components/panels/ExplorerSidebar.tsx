'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, File, ChevronRight, ChevronDown, RefreshCw, FileText } from 'lucide-react';
import { useOrbitState } from '@/providers/OrbitProvider';

interface FileNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  size?: number;
  modified?: string;
}

interface ExplorerSidebarProps {
  onFileSelect: (path: string) => void;
}

export default function ExplorerSidebar({ onFileSelect }: ExplorerSidebarProps) {
  const { currentSessionId, status, metrics } = useOrbitState();
  const [rootFiles, setRootFiles] = useState<FileNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirContents, setDirContents] = useState<Map<string, FileNode[]>>(new Map());
  const [loading, setLoading] = useState(false);

  const sessionQ = currentSessionId ? `&session=${encodeURIComponent(currentSessionId)}` : '';

  // Fetch the contents of a directory (absolute or relative path mapping to sessionRoot)
  const fetchDirectory = useCallback(async (dirPath: string): Promise<FileNode[]> => {
    try {
      const res = await fetch(`/api/workspace/tree?path=${encodeURIComponent(dirPath)}${sessionQ}`);
      const data = await res.json();
      return data.tree || [];
    } catch {
      return [];
    }
  }, [sessionQ]);

  // Load the root of the session folder
  const loadRoot = useCallback(async () => {
    setLoading(true);
    const files = await fetchDirectory('/workspace');
    setRootFiles(files);
    setLoading(false);
  }, [fetchDirectory]);

  // Reload tree when session changes
  useEffect(() => {
    setExpandedDirs(new Set());
    setDirContents(new Map());
    setRootFiles([]);
    if (currentSessionId) {
      loadRoot();
    }
  }, [currentSessionId, loadRoot]);

  // Auto-refresh when turn ends or tool completes
  const loadRootRef = useRef(loadRoot);
  useEffect(() => {
    loadRootRef.current = loadRoot;
  });
  useEffect(() => {
    loadRootRef.current();
  }, [status, metrics?.toolCalls]);

  // Toggle directory expand/collapse and load content dynamically
  const handleToggleDir = async (dirPath: string) => {
    const nextExpanded = new Set(expandedDirs);
    if (nextExpanded.has(dirPath)) {
      nextExpanded.delete(dirPath);
      setExpandedDirs(nextExpanded);
    } else {
      nextExpanded.add(dirPath);
      setExpandedDirs(nextExpanded);
      // Fetch contents if not loaded yet
      if (!dirContents.has(dirPath)) {
        const contents = await fetchDirectory(dirPath);
        setDirContents(prev => {
          const next = new Map(prev);
          next.set(dirPath, contents);
          return next;
        });
      }
    }
  };

  // Render a single file/directory node recursively
  const renderNode = (node: FileNode, depth: number = 0) => {
    const isDir = node.type === 'directory';
    const isExpanded = expandedDirs.has(node.path);
    const children = dirContents.get(node.path) || [];

    return (
      <div key={node.path} className="select-none">
        {isDir ? (
          <div>
            <div
              onClick={() => handleToggleDir(node.path)}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggleDir(node.path); } }}
              className="flex items-center gap-1.5 py-1 text-[12.5px] font-medium text-muted-foreground hover:bg-muted/60 transition-colors cursor-pointer rounded"
            >
              {isExpanded ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />}
              <Folder size={13} className="text-primary/70 shrink-0" />
              <span className="truncate">{node.name}</span>
            </div>
            {isExpanded && (
              <div className="flex flex-col animate-fade-in origin-top">
                {children.length === 0 ? (
                  <div
                    style={{ paddingLeft: `${(depth + 1) * 12 + 24}px` }}
                    className="py-0.5 text-[11px] text-faint italic"
                  >
                    Empty
                  </div>
                ) : (
                  children.map(child => renderNode(child, depth + 1))
                )}
              </div>
            )}
          </div>
        ) : (
          <div
            onClick={() => onFileSelect(node.path)}
            style={{ paddingLeft: `${depth * 12 + 24}px` }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFileSelect(node.path); } }}
            className="flex items-center gap-1.5 py-1 text-[12.5px] hover:bg-muted/60 transition-colors cursor-pointer rounded text-foreground/80 hover:text-foreground"
          >
            <FileText size={13} className="text-faint shrink-0" />
            <span className="truncate">{node.name}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Explorer header */}
      <div className="flex shrink-0 items-center justify-between px-3.5 py-2.5 border-b border-border-soft">
        <span className="text-[11px] font-bold uppercase tracking-wider text-faint">Session Explorer</span>
        <button
          onClick={loadRoot}
          aria-label="Refresh explorer"
          title="Refresh explorer"
          className="rounded p-1 text-faint hover:bg-muted hover:text-foreground transition-colors"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Explorer files list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-[2px]">
        {loading && rootFiles.length === 0 ? (
          <div className="p-3 text-center text-xs text-faint">Loading explorer...</div>
        ) : rootFiles.length === 0 ? (
          <div className="p-3 text-center text-xs text-faint">No session files.</div>
        ) : (
          rootFiles.map(node => renderNode(node, 0))
        )}
      </div>
    </div>
  );
}
