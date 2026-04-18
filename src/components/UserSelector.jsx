import React from 'react';

export default function UserSelector({ users = [], onSelectUser }) {
  return (
    <div className="min-h-screen bg-tq-bg flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-heading font-bold text-tq-accent tracking-wide mb-2">
            TRADEQUOTE
          </h1>
          <p className="text-tq-muted text-sm">
            Select your profile to continue
          </p>
        </div>

        <div className="grid gap-4">
          {users.map(user => (
            <button
              key={user.id}
              onClick={() => onSelectUser(user.id)}
              className="bg-tq-surface border border-tq-border rounded p-5 flex items-center gap-4 hover:border-tq-accent hover:bg-tq-card transition-all group"
            >
              <div className="w-12 h-12 rounded-full bg-tq-accent/20 text-tq-accent flex items-center justify-center text-xl font-heading font-bold group-hover:bg-tq-accent group-hover:text-tq-bg transition-colors">
                {(user.name || '').charAt(0).toUpperCase()}
              </div>
              <div className="text-left">
                <div className="text-lg font-heading font-bold text-tq-text">
                  {user.name}
                </div>
                <div className="text-xs text-tq-muted font-mono">
                  {user.id}
                </div>
              </div>
              <div className="ml-auto text-tq-muted group-hover:text-tq-accent transition-colors text-xl">
                &#8250;
              </div>
            </button>
          ))}
        </div>

        <p className="text-center text-tq-muted text-xs mt-6">
          Each user has their own quotes, RAMS, and settings.
        </p>
      </div>
    </div>
  );
}
