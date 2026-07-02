<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from './lib/editor';
  import { selectEditProject } from '@savig/editor-state';
  import { renderSvgDocument } from '@savig/services/export/renderDocument';
  import { computeFrame, applyFrameToNodes } from '@savig/runtime/frame';
  import { createProject, createSceneObject, createVectorAsset, createKeyframe } from '@savig/engine';
  import type { Project } from '@savig/engine';

  // A demo fixture — a rect whose x animates 0 -> 100 over 1s — so the PoC shows an animated object
  // on load. The @portable e2e replaces it via window.savigLoadProject.
  function demoProject(): Project {
    const asset = createVectorAsset('rect', { id: 'rect' });
    const obj = createSceneObject('rect', {
      id: 'oa',
      tracks: { x: [createKeyframe(0, 0), createKeyframe(1, 100)] },
    });
    obj.shapeBase = { width: 40, height: 30 };
    return { ...createProject({ name: 'Svelte PoC' }), assets: [asset], objects: [obj] };
  }

  let host = $state<HTMLDivElement>();
  const nodes = new Map<string, Element>();
  let renderedProject: Project | null = null; // reference of the last project we rendered SVG for

  // Imperative render — the exact path @savig/runtime's standalone player uses (innerHTML the neutral
  // markup, then query the [data-savig-object] wrappers into a node map). We manage this <div>'s
  // contents directly (Svelte doesn't touch it), so there's no framework/DOM-diffing race.
  function renderStage() {
    if (!host) return;
    const project = selectEditProject(store.getState());
    if (project === renderedProject) return; // only re-render on a PROJECT change, not a time tick
    renderedProject = project;
    host.innerHTML = renderSvgDocument(project);
    nodes.clear();
    host.querySelectorAll('[data-savig-object]').forEach((n) => {
      const id = n.getAttribute('data-savig-object');
      if (id) nodes.set(id, n);
    });
    applyFrameToNodes(nodes, computeFrame(project, store.getState().time)); // paint the current playhead
  }

  // Synchronous seek (no RAF / framework-commit race) so one page.evaluate can seek + read a frame.
  const seek = (t: number) => applyFrameToNodes(nodes, computeFrame(selectEditProject(store.getState()), t));

  onMount(() => {
    store.getState().setProject(demoProject());
    renderStage();
    const unsub = store.subscribe(renderStage); // re-render the SVG when the project changes
    const w = window as unknown as {
      savigSeek: (t: number) => void;
      savigLoadProject: (p: Project) => void;
    };
    w.savigSeek = seek;
    w.savigLoadProject = (p) => store.getState().setProject(p); // -> subscribe -> renderStage
    return unsub;
  });
</script>

<main>
  <header>Savig — Svelte 5 PoC · framework-swappable UI over the neutral <code>@savig/*</code> packages</header>
  <div class="stage" bind:this={host}></div>
</main>

<style>
  main {
    padding: var(--space-3);
  }
  header {
    color: var(--color-text-dim);
    margin-bottom: var(--space-3);
    font: var(--font-ui);
  }
  .stage {
    background: var(--color-stage);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-1);
    display: inline-block;
  }
  .stage :global(svg) {
    display: block;
  }
</style>
