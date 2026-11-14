/**
 * input.js — keyboard + mouse + pointer lock. Keeps the raw input state
 * in one place; the sim reads it, the render loop consumes mouse deltas.
 */
export function createInput(canvas) {
  const input = {
    keys: new Set(),
    mouseDX: 0,
    mouseDY: 0,
    mouseDown: false,
    locked: false,
    lockedOnce: false,
    onLockChange: null,
    onFirstGesture: null,
  };

  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    input.keys.add(e.code);
    if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => input.keys.clear());

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) input.mouseDown = true;
    if (!input.locked && input.onFirstGesture) input.onFirstGesture();
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.mouseDown = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.mouseDX += e.movementX || 0;
    input.mouseDY += e.movementY || 0;
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (input.locked) input.lockedOnce = true;
    if (input.onLockChange) input.onLockChange(input.locked);
  });
  document.addEventListener('pointerlockerror', () => {
    input.locked = false;
  });

  input.requestLock = () => {
    if (!input.locked) canvas.requestPointerLock();
  };
  input.consumeMouse = () => {
    const dx = input.mouseDX;
    const dy = input.mouseDY;
    input.mouseDX = 0;
    input.mouseDY = 0;
    return { dx, dy };
  };
  input.isDown = (code) => input.keys.has(code);
  return input;
}
