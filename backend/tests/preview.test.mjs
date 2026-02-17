import assert from 'node:assert/strict';
import test from 'node:test';
import { getBuiltInLevel } from '../src/builtInLevels.mjs';
import { renderLevelPreviewPng } from '../src/levelPreviewImage.mjs';

test('loads built-in level metadata for preview routes', () => {
  const map0 = getBuiltInLevel('map0');
  assert.ok(map0);
  assert.equal(map0.id, 'map0');
  assert.equal(typeof map0.name, 'string');
  assert.ok(map0.name.length > 0);
  assert.equal(typeof map0.text, 'string');
  assert.ok(map0.text.includes('P'));
});

test('renders a valid PNG preview image buffer', () => {
  const image = renderLevelPreviewPng({
    id: 'map0',
    name: 'Relay Threshold',
    text: `#####\n#P !#\n#####`,
    updatedAt: 0,
  });

  assert.ok(Buffer.isBuffer(image));
  assert.ok(image.length > 1024);
  assert.deepEqual(Array.from(image.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
});
