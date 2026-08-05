import { useEditor } from './store/store';

/** Gate for actions that discard the current project (New, template load): true when the
 *  project is pristine (nothing to lose) or the user confirms. Content = any objects or
 *  assets; one autosave debounce after the replacement the old project is gone for good. */
export function confirmReplaceProject(message: string): boolean {
  const p = useEditor.getState().history.present;
  const hasContent = p.objects.length > 0 || p.assets.length > 0;
  return !hasContent || window.confirm(message);
}

/** The one "New project" behavior every entry point shares (toolbar button, palette command):
 *  confirm when there is content to lose, then reset. */
export function requestNewProject(): void {
  if (confirmReplaceProject('Starting a new project replaces your current one. Continue?')) {
    useEditor.getState().newProject();
  }
}
