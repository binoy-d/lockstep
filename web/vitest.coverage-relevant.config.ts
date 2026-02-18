import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'src/app/deathImpact.ts',
        'src/app/gameController.ts',
        'src/core/**/*.ts',
        'src/editor/levelEditorUtils.ts',
        'src/runtime/backingTrackPattern.ts',
        'src/runtime/backendApi.ts',
        'src/runtime/cameraRumble.ts',
        'src/runtime/enemyPathVisuals.ts',
        'src/runtime/inputFocus.ts',
        'src/runtime/levelMeta.ts',
        'src/runtime/levelTransition.ts',
        'src/ui/introTimeline.ts',
      ],
      exclude: ['src/core/index.ts', 'src/core/types.ts'],
    },
  },
});
