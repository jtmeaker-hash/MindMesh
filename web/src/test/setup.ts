import '@testing-library/jest-dom';

// Polyfill ResizeObserver for jsdom environment (required by React Flow)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

