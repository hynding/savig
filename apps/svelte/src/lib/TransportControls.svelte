<script lang="ts">
  import { editor, store } from './editor';
  import { transportControlsViewModel, transportControlsIntents } from '@savig/ui-core';

  // The SAME neutral view-model + intents the React TransportControls uses — proving the L1 UI
  // layer drives Svelte. `$editor` reactively yields EditorState; the VM is a pure derivation.
  const intents = transportControlsIntents(store);
  const vm = $derived(transportControlsViewModel($editor));
</script>

<div class="transport" role="group" aria-label="Transport">
  <button onclick={() => intents.setPlaying(!vm.playing)} aria-label={vm.playing ? 'Pause' : 'Play'}>
    {vm.playing ? '❚❚' : '▶'}
  </button>
  <button onclick={() => intents.stepFrame(-1)} aria-label="Step back">◁</button>
  <button onclick={() => intents.stepFrame(1)} aria-label="Step forward">▷</button>
  <button onclick={() => intents.toggleLoop()} aria-pressed={vm.loop} class:active={vm.loop}>loop</button>
  <span class="time" data-testid="time-label">{vm.currentTimeLabel} / {vm.durationLabel}</span>
</div>

<style>
  .transport {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  button {
    padding: var(--space-1) var(--space-2);
    background: var(--color-panel-2);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-1);
    cursor: pointer;
  }
  button.active {
    background: var(--color-accent);
    color: var(--color-accent-contrast);
    border-color: var(--color-accent);
  }
  .time {
    color: var(--color-text-dim);
    font: var(--font-ui);
    font-variant-numeric: tabular-nums;
  }
</style>
