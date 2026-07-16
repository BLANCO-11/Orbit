// Single source of truth for agent-mode metadata (Workstream D1).
// Previously this was hardcoded three times — ModePrompt.MODE_META,
// ModeSelector.MODES, and ChatMessage's ModeSuggestionCard — which drifted
// (different labels/descriptions/colors). Everything mode-related now reads
// from here.

import { Shield, Edit3, Zap, MessageSquare, type LucideIcon } from 'lucide-react';

export type ModeId = 'chat' | 'plan' | 'edit' | 'yolo';

export interface ModeMeta {
  id: ModeId;
  label: string;
  tagline: string; // short one-liner (chips, badges)
  desc: string;    // longer description (pickers)
  icon: LucideIcon;
  color: string;   // text-* class for the icon / accent
  dot: string;     // bg-* class for the status dot
}

export const MODES: Record<ModeId, ModeMeta> = {
  chat: {
    id: 'chat',
    label: 'Chat',
    tagline: 'Read & answer only',
    desc: 'Answers questions and reads or researches freely, but never writes files or runs commands.',
    icon: MessageSquare,
    color: 'text-muted-foreground',
    dot: 'bg-faint',
  },
  plan: {
    id: 'plan',
    label: 'Plan',
    tagline: 'All actions require approval',
    desc: 'The agent plans its approach, explains what it will do, and asks before every action.',
    icon: Shield,
    color: 'text-info',
    dot: 'bg-info',
  },
  edit: {
    id: 'edit',
    label: 'Edit',
    tagline: 'Reads auto-approved, writes need approval',
    desc: 'Reads files freely, but asks before writing or editing anything.',
    icon: Edit3,
    color: 'text-warning',
    dot: 'bg-warning',
  },
  yolo: {
    id: 'yolo',
    label: 'YOLO',
    tagline: 'Full autonomous execution',
    desc: 'No approval prompts for any action. Full autonomy.',
    icon: Zap,
    color: 'text-destructive',
    dot: 'bg-destructive',
  },
};

// The user-switchable modes (excludes `chat`, which is the default / no-mode
// state), in display order.
export const SWITCHABLE_MODES: ModeMeta[] = [MODES.plan, MODES.edit, MODES.yolo];

export function getMode(id: string | null | undefined): ModeMeta | undefined {
  return id ? MODES[id as ModeId] : undefined;
}
