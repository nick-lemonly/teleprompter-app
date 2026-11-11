// Keyboard shortcuts, shared by controllers and the display (Bluetooth keyboard).
import * as cmd from './rig/commands.js';
import { isTypingTarget } from './ui.js';
import { RANGES } from './config.js';

export function attachShortcuts() {
  const onKey = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target) || document.querySelector('.modal-backdrop')) return;
    const step = e.shiftKey ? RANGES.speed.bigStep : 1;
    let handled = true;
    switch (e.key) {
      case ' ':
      case 'Spacebar':
        cmd.togglePlay();
        break;
      case 'ArrowUp':
        cmd.bumpSpeed(step);
        break;
      case 'ArrowDown':
        cmd.bumpSpeed(-step);
        break;
      case 'ArrowLeft':
        cmd.back(); // no-op while playing
        break;
      case 'ArrowRight':
        cmd.forward();
        break;
      case 'Home':
        cmd.toTop();
        break;
      case '+':
      case '=':
        cmd.changeFontSize(1);
        break;
      case '-':
      case '_':
      case '−':
        cmd.changeFontSize(-1);
        break;
      case '[':
        cmd.changeLineHeight(-1);
        break;
      case ']':
        cmd.changeLineHeight(1);
        break;
      case 'v':
      case 'V':
        cmd.toggleFlipV();
        break;
      case 'h':
      case 'H':
        cmd.toggleFlipH();
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
