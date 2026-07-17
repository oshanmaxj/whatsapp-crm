import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { modules } from './moduleNavigationConfig';

describe('module navigation configuration', () => {
  test('every configured icon is defined and renderable', () => {
    const navigationEntries = modules.flatMap((module) => [
      module,
      ...(module.items || [])
    ]);

    navigationEntries.forEach((entry) => {
      expect(entry.icon).toBeDefined();
      expect(React.isValidElement(entry.icon)).toBe(true);
      expect(['function', 'object']).toContain(typeof entry.icon.type);
      expect(() => renderToStaticMarkup(entry.icon)).not.toThrow();
    });
  });
});
