// SPDX-License-Identifier: AGPL-3.0-or-later
/** Keyboard and pointer shortcuts the editor shell and canvas respond to, for the shortcut viewer and tooltips. */
export interface ShortcutEntry {
  keys: string[];
  action: string;
}
export interface ShortcutGroup {
  title: string;
  entries: ShortcutEntry[];
}

/** Platform label for the primary modifier: Cmd on Apple devices, Ctrl elsewhere. */
export function primaryModifier(platform: string = globalThis.navigator?.platform ?? ''): string {
  return /mac|iphone|ipad|ipod/i.test(platform) ? 'Cmd' : 'Ctrl';
}
/** Replaces the `Mod` placeholder with the platform modifier so one table serves every OS. */
export const shortcutLabel = (keys: string, modifier: string = primaryModifier()): string =>
  keys.replace(/\bMod\b/g, modifier);

export const editorShortcuts: ShortcutGroup[] = [
  {
    title: 'History',
    entries: [
      { keys: ['Mod+Z'], action: 'Undo' },
      { keys: ['Mod+Shift+Z', 'Mod+Y'], action: 'Redo' },
    ],
  },
  {
    title: 'Selection and clipboard',
    entries: [
      { keys: ['Mod+A'], action: 'Select all elements' },
      { keys: ['Mod+C'], action: 'Copy the selection' },
      { keys: ['Mod+V'], action: 'Paste' },
      { keys: ['Delete', 'Backspace'], action: 'Delete the selection' },
      { keys: ['Mod+G'], action: 'Group the selection' },
      { keys: ['Mod+Shift+G'], action: 'Ungroup the selected groups' },
      { keys: ['Arrow keys'], action: 'Nudge the selection by 0.1 mm' },
      { keys: ['Shift+Arrow keys'], action: 'Nudge the selection by 1 mm' },
      { keys: ['Mod+Arrow keys'], action: 'Resize the selection by 0.1 mm' },
      { keys: ['Mod+Shift+Arrow keys'], action: 'Resize the selection by 1 mm' },
      { keys: ['[', ']'], action: 'Rotate the element by 15 degrees' },
      { keys: ['Shift+[', 'Shift+]', 'Mod+Alt+Arrow keys'], action: 'Rotate the element by 1 degree' },
    ],
  },
  {
    title: 'Canvas pointer',
    entries: [
      { keys: ['Click'], action: 'Select an element, or the group it belongs to' },
      { keys: ['Double-click'], action: 'Select one element inside its group' },
      { keys: ['Mod+Click'], action: 'Select one element inside its group directly' },
      { keys: ['Shift+Click'], action: 'Add an element to the selection' },
      { keys: ['Shift while resizing'], action: 'Toggle keeping the aspect ratio' },
      { keys: ['Shift while rotating'], action: 'Rotate in 15 degree steps' },
      { keys: ['Alt while dragging'], action: 'Disable snapping' },
      { keys: ['Mod while dragging'], action: 'Snap to other elements only' },
      { keys: ['Shift while dragging'], action: 'Snap to the grid only' },
      { keys: ['Shift+Click a tool'], action: 'Arm the tool; the next drag on the label draws it to size' },
      { keys: ['R', 'E', 'T', 'L'], action: 'Arm the rectangle, ellipse, text or line tool' },
      { keys: ['Esc'], action: 'Put the armed tool away' },
    ],
  },
  {
    title: 'View',
    entries: [
      { keys: ['Wheel'], action: 'Zoom around the pointer' },
      { keys: ['Shift+Wheel'], action: 'Pan horizontally' },
      { keys: ['Mod+Wheel'], action: 'Pan vertically' },
      { keys: ['Pinch'], action: 'Zoom and pan on touch screens' },
      { keys: ['Shift+1'], action: 'Fit the label to the window' },
      { keys: ['Mod+0'], action: 'Zoom to 100%' },
      { keys: ['Shift+2'], action: 'Zoom to 200%' },
      { keys: ['Mod+=', 'Mod+-'], action: 'Zoom in and out' },
      { keys: ['?'], action: 'Show this shortcut list' },
      { keys: ['Esc'], action: 'Close the open dialog' },
    ],
  },
];
