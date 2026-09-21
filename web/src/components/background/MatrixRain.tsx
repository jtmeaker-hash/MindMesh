import React, { useEffect, useRef } from 'react';

interface MatrixRainProps {
  color: string;
  fontSize: number;
  speed: number;
  opacity: number;
  density: number;
  /** Light backgrounds need dark "head" glyphs to stay visible */
  lightBackground?: boolean;
}

const GLYPHS = 'アカサタナハマヤラワイキシチニヒミリウクスツヌフムユルエケセテネヘメレオコソトノホモヨロ0123456789ABCDEF<>{}[]/*+-=:;';

/**
 * Purely decorative falling-code layer.
 *
 * Performance notes:
 * - Single canvas, no React state updates while animating (no re-renders).
 * - `destination-out` fade keeps the layer transparent so it composites over
 *   the MindMesh background instead of painting a black box.
 * - Pauses when the document is hidden and renders a single static frame when
 *   the user asks for reduced motion.
 */
export const MatrixRain: React.FC<MatrixRainProps> = ({
  color,
  fontSize,
  speed,
  opacity,
  density,
  lightBackground = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headColor = lightBackground ? '#0f172a' : '#ffffff';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // jsdom / very old browsers: silently skip the animation
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    let width = 0;
    let height = 0;
    let columnWidth = Math.max(8, fontSize);
    let columns = 0;
    let heads: number[] = [];
    let speeds: number[] = [];
    let active: boolean[] = [];
    let rafId = 0;
    let lastStep = 0;
    let disposed = false;

    const stepMs = Math.max(24, 90 / Math.max(0.25, speed));

    const randomGlyph = () => GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));

    const setup = () => {
      const parent = canvas.parentElement;
      width = Math.max(1, Math.floor(parent?.clientWidth || window.innerWidth));
      height = Math.max(1, Math.floor(parent?.clientHeight || window.innerHeight));
      columnWidth = Math.max(8, fontSize);
      columns = Math.max(1, Math.min(60, Math.floor(width / columnWidth)));

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${fontSize}px "Courier New", monospace`;
      ctx.textBaseline = 'top';
      ctx.clearRect(0, 0, width, height);

      heads = new Array(columns).fill(0).map(() => Math.floor(Math.random() * -40));
      speeds = new Array(columns).fill(0).map(() => 0.6 + Math.random() * 0.9);
      active = new Array(columns).fill(0).map(() => Math.random() < density);
    };

    const drawFrame = () => {
      // Erase a slice of the previous frame so trails persist without darkening the app background
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';

      ctx.font = `${fontSize}px "Courier New", monospace`;
      ctx.fillStyle = color;

      const rowHeight = fontSize * 1.05;

      for (let i = 0; i < columns; i += 1) {
        if (!active[i]) {
          // Re-roll inactive columns so density stays roughly constant
          if (Math.random() < 0.02) active[i] = Math.random() < density;
          continue;
        }

        const x = i * columnWidth;
        const y = heads[i] * rowHeight;

        if (y > -rowHeight && y < height) {
          ctx.fillStyle = i % 7 === 0 ? headColor : color;
          ctx.fillText(randomGlyph(), x, y);
        }

        heads[i] += speeds[i];

        if (y > height && Math.random() < 0.06) {
          heads[i] = Math.floor(Math.random() * -20);
          speeds[i] = 0.6 + Math.random() * 0.9;
          active[i] = Math.random() < density;
        }
      }
    };

    const loop = (timestamp: number) => {
      if (disposed) return;
      rafId = window.requestAnimationFrame(loop);
      if (timestamp - lastStep < stepMs) return;
      lastStep = timestamp;
      drawFrame();
    };

    setup();

    if (prefersReducedMotion) {
      // Draw one static composition and never schedule frames
      ctx.fillStyle = color;
      const rows = Math.max(1, Math.floor(height / (fontSize * 1.05)));
      for (let i = 0; i < columns; i += 1) {
        const x = i * columnWidth;
        const startRow = Math.abs(heads[i]) % rows;
        for (let k = 0; k < 3; k += 1) {
          ctx.globalAlpha = 0.65 - k * 0.2;
          ctx.fillText(randomGlyph(), x, (startRow + k) * fontSize * 1.05);
        }
      }
      ctx.globalAlpha = 1;
    } else if (typeof window.requestAnimationFrame === 'function') {
      rafId = window.requestAnimationFrame(loop);
    }

    const handleVisibility = () => {
      if (prefersReducedMotion) return;
      if (document.hidden) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      } else if (!rafId) {
        lastStep = 0;
        rafId = window.requestAnimationFrame(loop);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        setup();
      });
      if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
    }

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', handleVisibility);
      resizeObserver?.disconnect();
    };
  }, [color, fontSize, speed, density, headColor]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="matrix-rain"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity,
        pointerEvents: 'none',
      }}
    />
  );
};

MatrixRain.displayName = 'MatrixRain';
