import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AppearanceModal } from '../components/modals/AppearanceModal';
import { AppBackground } from '../components/background/AppBackground';
import App from '../App';
import {
  applyPreset,
  CONNECTION_BRIGHTNESS_RANGE,
  CONNECTION_CONTRAST_RANGE,
  getDefaultAppearance,
} from '../services/appearance';
import { AppearanceSettings } from '../types/appearance';

const IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

/**
 * Mirrors how App owns the appearance state: the modal is fully controlled, so
 * edits must round-trip through the parent before the next edit is applied.
 */
function renderModal(appearance: AppearanceSettings = getDefaultAppearance()) {
  const onChange = vi.fn();

  const Harness: React.FC = () => {
    const [current, setCurrent] = useState(appearance);
    return (
      <AppearanceModal
        isOpen
        onClose={() => {}}
        appearance={current}
        onChange={(next) => {
          onChange(next);
          setCurrent(next);
        }}
      />
    );
  };

  render(<Harness />);
  return onChange;
}

/** Latest appearance emitted by a mocked onChange handler. */
function lastEmitted(onChange: ReturnType<typeof vi.fn>): AppearanceSettings {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1][0] as AppearanceSettings;
}

describe('AppearanceModal', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('lists the Aqua, Orange and Matrix themes and applies one', () => {
    const onChange = renderModal();

    expect(screen.getByText('Aqua')).toBeDefined();
    expect(screen.getByText('Orange')).toBeDefined();
    expect(screen.getByText('Matrix')).toBeDefined();
    expect(screen.getByText('includes code rain')).toBeDefined();

    fireEvent.click(screen.getByText('Aqua'));

    expect(onChange).toHaveBeenCalledTimes(1);
    const applied = onChange.mock.calls[0][0] as AppearanceSettings;
    expect(applied.themeId).toBe('aqua');
    expect(applied.nodeColors.root).toBe('#22d3ee');
    expect(applied.connectionColorMode).toBe('custom');
  });

  it('lets the user switch the code rain off after the Matrix theme enabled it', () => {
    const matrix = applyPreset(getDefaultAppearance(), 'matrix');
    const onChange = renderModal(matrix);

    // Open the code rain tab and flip the switch
    fireEvent.click(screen.getByRole('button', { name: 'Code Rain' }));
    const toggle = screen.getByRole('switch', { name: 'Matrix falling code' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);

    const updated = onChange.mock.calls[0][0] as AppearanceSettings;
    expect(updated.matrix.enabled).toBe(false);
    expect(updated.matrix.color).toBe(matrix.matrix.color);
    expect(updated.nodeColors.root).toBe('#00ff41');
  });

  it('switches the background between black, white, void and photo', () => {
    const onChange = renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Background' }));
    fireEvent.click(screen.getByText('White'));

    expect(lastEmitted(onChange).background.kind).toBe('white');

    fireEvent.click(screen.getByText('Void'));
    expect(lastEmitted(onChange).background.kind).toBe('void');

    fireEvent.click(screen.getByText('Black'));
    expect(lastEmitted(onChange).background.kind).toBe('black');
  });

  it('exposes persisted 3D quality and motion controls', () => {
    const onChange = renderModal();

    fireEvent.click(screen.getByRole('button', { name: '3D Depth' }));
    const quality = screen.getByRole('group', { name: '3D effect quality' });
    expect(quality).toBeDefined();
    fireEvent.click(screen.getByText('High'));
    fireEvent.click(screen.getByRole('switch', { name: 'Orbit gestures' }));

    const updated = lastEmitted(onChange);
    expect(updated.threeD.level).toBe('high');
    expect(updated.threeD.graphRotation).toBe(false);
  });

  it('exposes the graph camera controls, including reduced motion', () => {
    const onChange = renderModal();

    fireEvent.click(screen.getByRole('button', { name: '3D Depth' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Invert horizontal orbit' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Invert vertical orbit' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Reduce camera motion' }));

    const updated = lastEmitted(onChange);
    expect(updated.threeD.invertRotation).toBe(true);
    expect(updated.threeD.invertOrbitY).toBe(true);
    expect(updated.threeD.reducedMotion).toBe(true);
    // Camera inertia ships with a sensible default rather than an off/on cliff.
    expect(updated.threeD.cameraInertia).toBeGreaterThan(0);
    // The retired auto-focus toggle no longer claims behaviour it does not have.
    expect(screen.queryByRole('switch', { name: 'Auto-focus selected nodes' })).toBeNull();
  });

  it('edits node colours and connection colours independently', () => {
    const onChange = renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Nodes & Lines' }));
    fireEvent.click(screen.getByText('Custom palette'));
    fireEvent.click(screen.getByText('Custom lines'));

    const customPalette = lastEmitted(onChange);
    expect(customPalette.nodeColorMode).toBe('custom');
    expect(customPalette.connectionColorMode).toBe('custom');

    fireEvent.change(screen.getByLabelText('Root → category branches'), { target: { value: '#123456' } });
    const withLine = lastEmitted(onChange);
    expect(withLine.connectionColors.branch).toBe('#123456');
    expect(withLine.nodeColorMode).toBe('custom');
  });

  it('exposes separate live connection brightness and contrast sliders', () => {
    const onChange = renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Nodes & Lines' }));
    const brightness = screen.getByLabelText('Connection brightness') as HTMLInputElement;
    const contrast = screen.getByLabelText('Connection contrast') as HTMLInputElement;

    // Both sliders cover their full supported range.
    expect(brightness.min).toBe(String(CONNECTION_BRIGHTNESS_RANGE.min));
    expect(brightness.max).toBe(String(CONNECTION_BRIGHTNESS_RANGE.max));
    expect(contrast.min).toBe(String(CONNECTION_CONTRAST_RANGE.min));
    expect(contrast.max).toBe(String(CONNECTION_CONTRAST_RANGE.max));

    fireEvent.change(brightness, { target: { value: '1.6' } });
    expect(lastEmitted(onChange).connectionBrightness).toBeCloseTo(1.6);

    // Changing contrast leaves the chosen brightness untouched.
    fireEvent.change(contrast, { target: { value: '0.8' } });
    const updated = lastEmitted(onChange);
    expect(updated.connectionContrast).toBeCloseTo(0.8);
    expect(updated.connectionBrightness).toBeCloseTo(1.6);
  });

  it('rejects non-image files when importing a background photo', () => {
    const onChange = renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Background' }));
    const input = screen.getByLabelText('Import background image');
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText('Please choose an image file.')).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes an existing background image and falls back to a solid background', () => {
    const withImage: AppearanceSettings = {
      ...getDefaultAppearance(),
      background: {
        ...getDefaultAppearance().background,
        kind: 'image',
        image: { ...getDefaultAppearance().background.image, dataUrl: IMAGE_DATA_URL },
      },
    };
    const onChange = renderModal(withImage);

    fireEvent.click(screen.getByRole('button', { name: 'Background' }));
    fireEvent.click(screen.getByLabelText('Remove background image'));

    const updated = onChange.mock.calls[0][0] as AppearanceSettings;
    expect(updated.background.image.dataUrl).toBeUndefined();
    expect(updated.background.kind).toBe('default');
  });

  it('resets appearance back to defaults', () => {
    const aqua = applyPreset(getDefaultAppearance(), 'aqua');
    const onChange = renderModal(aqua);

    fireEvent.click(screen.getByText('Reset appearance to defaults'));

    const reset = onChange.mock.calls[0][0] as AppearanceSettings;
    expect(reset).toEqual(getDefaultAppearance());
  });
});

describe('AppBackground layers', () => {
  it('never blocks pointer input', () => {
    render(<AppBackground appearance={getDefaultAppearance()} />);
    const layer = screen.getByTestId('app-background');
    expect(layer.style.pointerEvents).toBe('none');
    expect(layer.getAttribute('data-background-kind')).toBe('default');
  });

  it('renders the imported photo with the chosen fit and opacity', () => {
    const appearance: AppearanceSettings = {
      ...getDefaultAppearance(),
      background: {
        ...getDefaultAppearance().background,
        kind: 'image',
        image: { dataUrl: IMAGE_DATA_URL, fit: 'contain', position: 'top', opacity: 0.6, blur: 8 },
      },
    };
    render(<AppBackground appearance={appearance} />);

    const img = screen.getByTestId('background-image') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(IMAGE_DATA_URL);
    expect(img.style.objectFit).toBe('contain');
    expect(img.style.objectPosition).toBe('top');
    expect(img.style.opacity).toBe('0.6');
    expect(img.style.filter).toContain('blur(8px)');
  });

  it('only mounts the code rain canvas when the effect is enabled', () => {
    const off = getDefaultAppearance();
    const { unmount } = render(<AppBackground appearance={off} />);
    expect(screen.queryByTestId('matrix-rain')).toBeNull();
    unmount();

    const on: AppearanceSettings = {
      ...getDefaultAppearance(),
      matrix: { ...getDefaultAppearance().matrix, enabled: true },
    };
    render(<AppBackground appearance={on} />);
    expect(screen.getByTestId('matrix-rain')).toBeDefined();
  });

  it('renders the atmospheric void backdrop', () => {
    const voided: AppearanceSettings = {
      ...getDefaultAppearance(),
      background: { ...getDefaultAppearance().background, kind: 'void' },
    };
    render(<AppBackground appearance={voided} />);
    expect(screen.getByTestId('app-background').getAttribute('data-background-kind')).toBe('void');
  });
});

describe('Appearance inside the app shell', () => {
  beforeEach(() => {
    localStorage.clear();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('exposes Appearance & Theme from the options menu and persists the choice', async () => {
    render(<App />);

    fireEvent.click(screen.getByTitle('Options'));
    const entry = screen.getByText('Appearance & Theme');
    expect(entry).toBeDefined();

    fireEvent.click(entry);

    expect(screen.getByText('Themes, node colours, backgrounds & code rain')).toBeDefined();

    fireEvent.click(screen.getByText('Orange'));

    await waitFor(() => {
      const raw = localStorage.getItem('mindmesh_state_v2');
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!).appearance.themeId).toBe('orange');
      expect(JSON.parse(raw!).appearance.nodeColors.root).toBe('#fb923c');
    });
  });

  it('restores a persisted appearance on load', () => {
    const matrix = applyPreset(getDefaultAppearance(), 'matrix');
    localStorage.setItem(
      'mindmesh_state_v2',
      JSON.stringify({ version: 5, categories: [], reminders: [], nodePositions: {}, appearance: matrix })
    );

    render(<App />);
    expect(screen.getByTestId('app-background').getAttribute('data-background-kind')).toBe('black');
    expect(screen.getByTestId('matrix-rain')).toBeDefined();
  });
});
