import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { canAccessModule, modules } from './moduleNavigationConfig';

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

  test('modules with alternative permissions remain visible to authorized reviewers', () => {
    const accounting = modules.find((module) => module.id === 'accounting');
    expect(canAccessModule(accounting, { isSystemAdmin: false, permissions: ['payment-slips.view'] })).toBe(true);
  });
});
