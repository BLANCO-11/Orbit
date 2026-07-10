'use client';

import React from 'react';
import { Terminal, Server, Shield, Plug, Cog, Volume2, VolumeX } from 'lucide-react';

export type RailView = 'console' | 'fleet' | 'connectors' | 'policies' | 'settings';

const VIEWS: { id: RailView; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'console', label: 'Console', icon: Terminal },
  { id: 'fleet', label: 'Fleet — harnesses & devices', icon: Server },
  { id: 'connectors', label: 'Connectors — MCP servers', icon: Plug },
  { id: 'policies', label: 'Policies', icon: Shield },
];

interface IconRailProps {
  activeView: RailView;
  onViewChange: (view: RailView) => void;
  voiceOn: boolean;
  onToggleVoice: () => void;
}

/**
 * IconRail — far-left primary navigation (mock: Console / Fleet / Connectors /
 * Policies, with voice status + Settings pinned at the bottom).
 */
export default function IconRail({ activeView, onViewChange, voiceOn, onToggleVoice }: IconRailProps) {
  return (
    <nav
      aria-label="Primary"
      className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-border-soft bg-sidebar py-2.5"
    >
      <div className="mb-2 grid size-8 place-items-center rounded-[9px] bg-primary text-[15px] font-bold text-primary-foreground">
        A
      </div>

      {VIEWS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onViewChange(id)}
          aria-label={label}
          title={label}
          aria-current={activeView === id ? 'page' : undefined}
          className={`grid size-9 place-items-center rounded-[10px] transition-colors ${
            activeView === id
              ? 'bg-accent text-accent-foreground'
              : 'text-faint hover:bg-muted hover:text-muted-foreground'
          }`}
        >
          <Icon size={17} />
        </button>
      ))}

      <div className="flex-1" />

      <button
        onClick={onToggleVoice}
        aria-label={voiceOn ? 'Voice responses on' : 'Voice responses off'}
        title={voiceOn ? 'Voice: on' : 'Voice: off'}
        className={`relative grid size-9 place-items-center rounded-[10px] transition-colors ${
          voiceOn ? 'text-accent-foreground' : 'text-faint hover:text-muted-foreground'
        } hover:bg-muted`}
      >
        {voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
        {voiceOn && (
          <span className="absolute right-1.5 top-1.5 size-[7px] rounded-full border-2 border-sidebar bg-success" />
        )}
      </button>

      <button
        onClick={() => onViewChange('settings')}
        aria-label="Settings"
        title="Settings"
        aria-current={activeView === 'settings' ? 'page' : undefined}
        className={`grid size-9 place-items-center rounded-[10px] transition-colors ${
          activeView === 'settings'
            ? 'bg-accent text-accent-foreground'
            : 'text-faint hover:bg-muted hover:text-muted-foreground'
        }`}
      >
        <Cog size={17} />
      </button>
    </nav>
  );
}
