import React from 'react';
import { Terminal, Server, Shield, Plug, Bot, Library, ShieldUser, Volume2, VolumeX, Sun, Moon, Settings, LogOut } from 'lucide-react';

export type RailView = 'console' | 'agents' | 'fleet' | 'connectors' | 'policies' | 'library' | 'admin' | 'settings';

const VIEWS: { id: RailView; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'console', label: 'Console', icon: Terminal },
  { id: 'agents', label: 'Agents — session profiles', icon: Bot },
  { id: 'fleet', label: 'Fleet — harnesses & devices', icon: Server },
  { id: 'connectors', label: 'Connectors — MCP servers', icon: Plug },
  { id: 'library', label: 'Library — prompts & skills', icon: Library },
  { id: 'policies', label: 'Policies', icon: Shield },
];

interface IconRailProps {
  activeView: RailView;
  onViewChange: (view: RailView) => void;
  voiceOn: boolean;
  onToggleVoice: () => void;
  ttsAvailable?: boolean;
  theme?: { mode: 'light' | 'dark' } | any;
  onToggleTheme?: () => void;
  isVisible?: (category: string, id: string) => boolean;
  /** Show the Admin destination — only for admins/superadmins (see useAuth). */
  canAdmin?: boolean;
  /** When set, render a logout control (hidden in dev-mode where there's no session). */
  onLogout?: () => void;
}

/**
 * IconRail — far-left primary navigation (mock: Console / Fleet / Connectors /
 * Policies, with voice status, Theme, and Settings pinned at the bottom).
 */
export default function IconRail({
  activeView,
  onViewChange,
  voiceOn,
  onToggleVoice,
  ttsAvailable = false,
  theme,
  onToggleTheme,
  isVisible,
  canAdmin = false,
  onLogout,
}: IconRailProps) {
  return (
    <nav
      aria-label="Primary"
      className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-border-soft bg-sidebar py-2.5"
    >
      <div className="mb-2 relative grid size-8 place-items-center rounded-[9px] bg-primary text-primary-foreground shadow-sm">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-4 animate-spin-slow"
        >
          <circle cx="12" cy="12" r="8" strokeDasharray="4 4" className="opacity-60" />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
          <circle cx="18" cy="7" r="1.5" fill="currentColor" />
        </svg>
      </div>

      {VIEWS.filter(v => !isVisible || isVisible('rail', v.id)).map(({ id, label, icon: Icon }) => (
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

      {/* Admin — multi-tenant keys, roles, observability, SSO. Admins only. */}
      {canAdmin && (
        <button
          onClick={() => onViewChange('admin')}
          aria-label="Admin — tenants, keys, roles & SSO"
          title="Admin — tenants, keys, roles & SSO"
          aria-current={activeView === 'admin' ? 'page' : undefined}
          className={`grid size-9 place-items-center rounded-[10px] transition-colors ${
            activeView === 'admin'
              ? 'bg-accent text-accent-foreground'
              : 'text-faint hover:bg-muted hover:text-muted-foreground'
          }`}
        >
          <ShieldUser size={17} />
        </button>
      )}

      <div className="flex-1" />

      {/* Theme toggle */}
      {onToggleTheme && (
        <button
          onClick={onToggleTheme}
          aria-label="Toggle theme"
          title="Toggle theme"
          className="grid size-9 place-items-center rounded-[10px] text-faint hover:bg-muted hover:text-muted-foreground transition-colors"
        >
          {theme?.mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      )}

      {/* Voice toggle only when a TTS backend is configured (env or Settings). */}
      {ttsAvailable && (
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
      )}

      {/* Settings toggle */}
      <button
        onClick={() => onViewChange('settings')}
        aria-label="Settings"
        title="Settings"
        className={`grid size-9 place-items-center rounded-[10px] transition-colors ${
          activeView === 'settings'
            ? 'bg-accent text-accent-foreground'
            : 'text-faint hover:bg-muted hover:text-muted-foreground'
        }`}
      >
        <Settings size={16} />
      </button>

      {/* Logout — only when there's a real session (hidden in dev-mode). */}
      {onLogout && (
        <button
          onClick={onLogout}
          aria-label="Sign out"
          title="Sign out"
          className="grid size-9 place-items-center rounded-[10px] text-faint transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut size={16} />
        </button>
      )}
    </nav>
  );
}

