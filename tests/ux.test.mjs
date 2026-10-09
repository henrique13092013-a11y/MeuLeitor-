import test from 'node:test';
import assert from 'node:assert/strict';
import { activeMarker, clampZoom, focalDelta, focalRatio } from '../ux.mjs';

test('zoom fica entre 100% e 400%', () => {
  assert.equal(clampZoom(.3), 1);
  assert.equal(clampZoom(2.25), 2.25);
  assert.equal(clampZoom(8), 4);
});

test('marco ativo informa onde começou a divisão', () => {
  const markers = [{ page: 3, value: true }, { page: 9, value: false }, { page: 15, value: true }];
  assert.deepEqual(activeMarker(markers, 2, false), { value: false, start: null });
  assert.deepEqual(activeMarker(markers, 7, false), { value: true, start: 3 });
  assert.deepEqual(activeMarker(markers, 12, false), { value: false, start: 9 });
  assert.deepEqual(activeMarker(markers, 20, false), { value: true, start: 15 });
});

test('ponto focal do zoom permanece estável', () => {
  const before = { left: 10, top: 20, width: 200, height: 300 };
  const ratio = focalRatio(before, 110, 170);
  assert.deepEqual(ratio, { x: .5, y: .5 });
  const after = { left: 10, top: 20, width: 400, height: 600 };
  assert.deepEqual(focalDelta(after, ratio, 110, 170), { x: 100, y: 150 });
});
