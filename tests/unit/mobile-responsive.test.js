import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Mobile Responsiveness & Phone Autosizing (Hallmark Standard)', () => {
  const cssPath = path.join(__dirname, '../../web/frontend/css/morphe.css');
  const htmlPath = path.join(__dirname, '../../web/frontend/index.html');
  const authPath = path.join(__dirname, '../../worker/auth.ts');

  const css = fs.readFileSync(cssPath, 'utf8');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const auth = fs.readFileSync(authPath, 'utf8');

  it('contains comprehensive phone & tablet breakpoints (768px, 640px, 400px)', () => {
    assert.ok(css.includes('@media (max-width: 768px)'), 'Missing 768px media query');
    assert.ok(css.includes('@media (max-width: 640px)'), 'Missing 640px mobile media query');
    assert.ok(css.includes('@media (max-width: 400px)'), 'Missing 400px compact phone query');
  });

  it('implements two-row monolith top-chrome with horizontally scrollable nav dock', () => {
    assert.ok(css.includes('.top-chrome {'), 'top-chrome missing');
    assert.ok(css.includes('.nav-dock {'), 'nav-dock missing');
    assert.ok(css.includes('overflow-x: auto'), 'nav-dock missing overflow-x: auto for swipeable mobile tabs');
    assert.ok(css.includes('-webkit-overflow-scrolling: touch'), 'nav-dock missing iOS smooth touch scrolling');
  });

  it('configures bento-card-header and actions to grid on mobile screens', () => {
    assert.ok(html.includes('class="bento-header-actions"'), 'Missing bento-header-actions in HTML');
    assert.ok(css.includes('.bento-header-actions {'), 'Missing bento-header-actions CSS');
    assert.ok(css.includes('grid-template-columns: repeat(2, 1fr)'), 'Missing 2-column mobile button grid');
  });

  it('optimizes app cards with responsive action buttons and truncated package labels', () => {
    assert.ok(css.includes('.app-card-actions {'), 'Missing app-card-actions CSS');
    assert.ok(css.includes('text-overflow: ellipsis'), 'Missing ellipsis on long package strings');
  });

  it('autosizes slide drawer to 100vw bottom/side sheet on phones', () => {
    assert.ok(css.includes('.slide-drawer {'), 'Missing slide drawer style');
    assert.ok(css.includes('width: 100vw'), 'Slide drawer missing 100vw mobile autosizing');
  });

  it('formats modals as responsive native bottom sheets with comfortable touch targets', () => {
    assert.ok(css.includes('.modal-overlay {'), 'Missing modal-overlay style');
    assert.ok(css.includes('.modal-container {'), 'Missing modal-container style');
    assert.ok(css.includes('align-items: flex-end'), 'Modals missing bottom-sheet alignment on phones');
    assert.ok(css.includes('max-height: 92dvh'), 'Modals missing 92dvh height cap on phones');
  });

  it('provides responsive login gateway styles in worker auth', () => {
    assert.ok(auth.includes('@media (max-width: 480px)'), 'Login screen missing mobile media query');
    assert.ok(auth.includes('.card { padding: 28px 20px; }'), 'Login card missing mobile padding');
  });
});
