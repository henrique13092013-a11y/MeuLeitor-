import test from 'node:test';
import assert from 'node:assert/strict';
import { compactMarkers, migrateLegacyRotation, migrateLegacySplit, readingPosition, setMarker, valueAt } from '../state.mjs';

test('rotação vale da página marcada até nova marcação', () => {
  let markers = [];
  markers = setMarker(markers, 3, 90, 0);
  assert.equal(valueAt(markers, 2, 0), 0);
  assert.equal(valueAt(markers, 3, 0), 90);
  assert.equal(valueAt(markers, 72, 0), 90);
  markers = setMarker(markers, 10, 180, 0);
  assert.equal(valueAt(markers, 9, 0), 90);
  assert.equal(valueAt(markers, 10, 0), 180);
  assert.equal(valueAt(markers, 72, 0), 180);
});

test('divisão vale da página marcada até ser interrompida', () => {
  let markers = [];
  markers = setMarker(markers, 3, true, false);
  assert.equal(valueAt(markers, 2, false), false);
  assert.equal(valueAt(markers, 3, false), true);
  assert.equal(valueAt(markers, 37, false), true);
  markers = setMarker(markers, 20, false, false);
  assert.equal(valueAt(markers, 19, false), true);
  assert.equal(valueAt(markers, 20, false), false);
  assert.equal(valueAt(markers, 37, false), false);
});

test('contador de leitura considera metades', () => {
  const markers = [{ page: 3, value: true }, { page: 5, value: false }];
  assert.deepEqual(readingPosition(6, 3, 1, markers), { current: 3, total: 8 });
  assert.deepEqual(readingPosition(6, 3, 2, markers), { current: 4, total: 8 });
  assert.deepEqual(readingPosition(6, 5, 0, markers), { current: 7, total: 8 });
});

test('migração compacta regras antigas por página', () => {
  const split = migrateLegacySplit([
    { page: 3, mode: 'split' }, { page: 4, mode: 'split' }, { page: 5, mode: 'split' },
    { page: 6, mode: 'whole' }, { page: 7, mode: 'whole' }
  ]);
  assert.deepEqual(split, [{ page: 3, value: true }, { page: 6, value: false }]);
  const rotation = migrateLegacyRotation({ 1: 90, 2: 90, 3: 90, 4: 180, 5: 180 });
  assert.deepEqual(rotation, [{ page: 1, value: 90 }, { page: 4, value: 180 }]);
});

test('compactação remove marcas redundantes', () => {
  const result = compactMarkers([
    { page: 2, value: false }, { page: 3, value: true }, { page: 4, value: true }, { page: 8, value: false }
  ], false);
  assert.deepEqual(result, [{ page: 3, value: true }, { page: 8, value: false }]);
});
