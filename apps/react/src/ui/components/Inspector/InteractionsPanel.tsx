// M9 interactivity/scripting authoring UI — project-level panel, mounted in Inspector.tsx's
// `vm.kind === 'empty'` branch (nothing selected). Two independent parts: a declared-variables
// table (addVariable/updateVariable/removeVariable) and the project's global event handlers via
// the shared `BehaviorsSection` (`objectId: null`, `eventKinds` = global kinds only).
import { useState } from 'react';
import type { Behavior } from '@savig/engine';
import { inferVariableInitial } from '@savig/ui-core';
import type { InspectorSceneOptionVM } from '@savig/ui-core';
import { BehaviorsSection, GLOBAL_EVENT_KINDS, type BehaviorsIntents } from './BehaviorsSection';
import styles from './Inspector.module.css';

export interface InteractionsPanelProps {
  variables: Array<{ name: string; initial: number | string | boolean }>;
  handlers: Behavior[];
  scenes: InspectorSceneOptionVM[];
  behaviorTargets: InspectorSceneOptionVM[];
  intents: BehaviorsIntents & {
    addVariable: (name: string, initial: number | string | boolean) => void;
    updateVariable: (name: string, initial: number | string | boolean) => void;
    removeVariable: (name: string) => void;
  };
}

export function InteractionsPanel({ variables, handlers, scenes, behaviorTargets, intents }: InteractionsPanelProps) {
  const [newName, setNewName] = useState('');
  const [newInitial, setNewInitial] = useState('');
  // Per-row draft for the initial-value field, keyed by variable name, so typing doesn't fight
  // the external value while unfocused — same commit-on-blur rationale as elsewhere in Inspector.
  const [initialDrafts, setInitialDrafts] = useState<Record<string, string>>({});

  return (
    <div className={styles.panel}>
      <div className={styles.group}>Variables</div>
      {variables.map((v) => {
        const draft = initialDrafts[v.name] ?? String(v.initial);
        return (
          <div className={styles.row} key={v.name}>
            <span data-testid={`variable-name-${v.name}`}>{v.name}</span>
            <input
              aria-label={`variable ${v.name} initial`}
              data-testid={`variable-initial-${v.name}`}
              type="text"
              value={draft}
              onChange={(e) => setInitialDrafts((d) => ({ ...d, [v.name]: e.target.value }))}
              onBlur={() => {
                const raw = initialDrafts[v.name];
                if (raw === undefined) return;
                intents.updateVariable(v.name, inferVariableInitial(raw));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
            <button
              type="button"
              aria-label={`remove variable ${v.name}`}
              onClick={() => {
                intents.removeVariable(v.name);
                // Drop any leftover draft so a later variable re-added under the same name
                // doesn't inherit a stale in-progress edit.
                setInitialDrafts((d) => {
                  const rest = { ...d };
                  delete rest[v.name];
                  return rest;
                });
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <div className={styles.row}>
        <input
          aria-label="new variable name"
          type="text"
          placeholder="name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <input
          aria-label="new variable initial"
          type="text"
          placeholder="initial value"
          value={newInitial}
          onChange={(e) => setNewInitial(e.target.value)}
        />
        <button
          type="button"
          data-testid="add-variable"
          disabled={!newName}
          onClick={() => {
            intents.addVariable(newName, inferVariableInitial(newInitial));
            setNewName('');
            setNewInitial('');
          }}
        >
          + variable
        </button>
      </div>

      <BehaviorsSection
        objectId={null}
        behaviors={handlers}
        eventKinds={GLOBAL_EVENT_KINDS}
        scenes={scenes}
        targets={behaviorTargets}
        intents={intents}
        heading="Global handlers"
      />
    </div>
  );
}
