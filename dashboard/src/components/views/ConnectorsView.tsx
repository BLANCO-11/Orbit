'use client';

import React, { useEffect, useState } from 'react';
import { Globe, Plug } from 'lucide-react';

/**
 * ConnectorsView — MCP tool servers registered with the backend. Today that's
 * the lightpanda headless browser; the add-connector registry is Phase 5.
 */
export default function ConnectorsView() {
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => {});
  }, []);

  const mcpOk = health?.mcp === 'connected' || health?.mcp?.status === 'connected' || health?.mcpConnected === true;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-7 py-7">
        <h2 className="text-lg font-semibold">Connectors</h2>
        <p className="mb-5 mt-0.5 text-[13px] text-muted-foreground">
          MCP tool servers. Register once here — every harness session gets the tools, every call
          passes the policy engine and lands in the timeline like any other tool.
        </p>

        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3.5">
            <div className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-border bg-muted text-muted-foreground">
              <Globe size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                lightpanda-browser
                <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${mcpOk ? 'text-success' : 'text-faint'}`}>
                  <i className={`size-[7px] rounded-full ${mcpOk ? 'bg-success' : 'bg-faint'}`} />
                  {mcpOk ? 'connected' : health === null ? 'checking…' : 'disconnected'}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-faint">
                local · mcp-server-lightpanda · headless browsing, screenshots
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-4 text-xs text-faint">
            <Plug size={13} />
            Add connector — npx command, docker image, or remote MCP URL. Registry ships in Phase 5;
            every connector tool will get per-tool allow / ask / block policy.
          </div>
        </div>
      </div>
    </div>
  );
}
