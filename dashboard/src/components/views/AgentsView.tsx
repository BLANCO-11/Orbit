'use client';

import React, { useState } from 'react';
import ProfilesView from './ProfilesView';
import ChannelsView from './ChannelsView';

/**
 * AgentsView — the "Agents" rail destination: profiles (reusable session
 * setups) and channels (triggers that run a profile unattended). One tab,
 * two related surfaces.
 */
export default function AgentsView() {
  const [tab, setTab] = useState<'profiles' | 'channels'>('profiles');

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-7 py-7">
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-lg font-semibold">Agents</h2>
          <div className="inline-flex rounded-lg border border-border-soft bg-background p-0.5">
            {(['profiles', 'channels'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 text-[12px] font-semibold capitalize transition-colors ${tab === t ? 'bg-card text-foreground shadow-card' : 'text-faint hover:text-foreground'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        {tab === 'profiles' ? (
          <>
            <p className="mb-5 text-[13px] text-muted-foreground">
              Reusable session setups — harness, mode, effort, prompt, skills, and which tools are on.
              Pick one from the composer in a click; the chips still override it per session.
            </p>
            <ProfilesView embedded />
          </>
        ) : (
          <>
            <p className="mb-5 text-[13px] text-muted-foreground">
              Triggers that run a profile <span className="font-semibold">unattended</span> — on a schedule, or from a
              verified webhook. Every run lands in the session list with its full timeline.
            </p>
            <ChannelsView />
          </>
        )}
      </div>
    </div>
  );
}
