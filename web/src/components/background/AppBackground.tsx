import React from 'react';
import { AppearanceSettings } from '../../types/appearance';
import { BACKGROUND_DEFAULT_COLOR, isLightBackground } from '../../services/appearance';
import { MatrixRain } from './MatrixRain';

interface AppBackgroundProps {
  appearance: AppearanceSettings;
}

/**
 * Decorative background stack. Layer order (bottom → top):
 *   1. base colour / void atmosphere
 *   2. imported photo
 *   3. dimming overlay
 *   4. Matrix falling code
 * The whole stack is `pointer-events: none`, so it can never block node
 * dragging, panning, tapping or menu interaction.
 */
export const AppBackground: React.FC<AppBackgroundProps> = React.memo(function AppBackground({ appearance }) {
  const { background, matrix } = appearance;

  const baseColor =
    background.kind === 'black'
      ? '#000000'
      : background.kind === 'white'
      ? '#ffffff'
      : background.kind === 'image'
      ? '#05070c'
      : background.color || BACKGROUND_DEFAULT_COLOR;

  const showVoid = background.kind === 'void';
  const showImage = background.kind === 'image' && Boolean(background.image.dataUrl);
  const lightBackground = isLightBackground(appearance);

  return (
    <div
      aria-hidden="true"
      data-testid="app-background"
      data-background-kind={background.kind}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        backgroundColor: baseColor,
      }}
    >
      {/* VOID: original atmospheric cyberspace backdrop (no external assets) */}
      {showVoid && (
        <div style={{ position: 'absolute', inset: 0 }}>
          <div
            className={background.voidAnimated ? 'void-background__drift' : undefined}
            style={{
              position: 'absolute',
              inset: '-12%',
              background:
                'radial-gradient(58% 46% at 22% 18%, rgba(56, 189, 248, 0.13) 0%, rgba(2, 6, 23, 0) 65%), radial-gradient(52% 44% at 78% 76%, rgba(99, 102, 241, 0.14) 0%, rgba(2, 6, 23, 0) 62%), radial-gradient(70% 60% at 50% 110%, rgba(14, 165, 233, 0.08) 0%, rgba(2, 6, 23, 0) 70%)',
              filter: 'blur(2px)',
            }}
          />
          {/* Faint abstract digital structure */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0.5,
              backgroundImage:
                'linear-gradient(rgba(56, 189, 248, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(56, 189, 248, 0.04) 1px, transparent 1px)',
              backgroundSize: '88px 88px, 88px 88px',
              maskImage: 'radial-gradient(120% 90% at 50% 20%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.25) 70%, transparent 100%)',
              WebkitMaskImage: 'radial-gradient(120% 90% at 50% 20%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.25) 70%, transparent 100%)',
            }}
          />
          {/* Very faint drifting particles */}
          <div
            className={background.voidAnimated ? 'void-background__drift' : undefined}
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0.35,
              backgroundImage:
                'radial-gradient(rgba(148, 163, 184, 0.45) 0.8px, transparent 0.9px), radial-gradient(rgba(56, 189, 248, 0.35) 0.8px, transparent 0.9px)',
              backgroundSize: '46px 46px, 74px 74px',
              backgroundPosition: '0 0, 23px 31px',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'radial-gradient(130% 100% at 50% 50%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.72) 100%)',
            }}
          />
        </div>
      )}

      {/* IMPORTED PHOTO */}
      {showImage && (
        <img
          src={background.image.dataUrl}
          alt=""
          data-testid="background-image"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: background.image.fit,
            objectPosition: background.image.position,
            opacity: background.image.opacity,
            filter: background.image.blur > 0 ? `blur(${background.image.blur}px)` : undefined,
            transform: background.image.blur > 0 ? 'scale(1.04)' : undefined,
          }}
        />
      )}

      {/* DIMMING OVERLAY */}
      {background.dim > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: `rgba(0, 0, 0, ${background.dim})`,
          }}
        />
      )}

      {/* MATRIX FALLING CODE */}
      {matrix.enabled && (
        <div style={{ position: 'absolute', inset: 0 }}>
          <MatrixRain
            color={matrix.color}
            fontSize={matrix.fontSize}
            speed={matrix.speed}
            opacity={matrix.opacity}
            density={matrix.density}
            lightBackground={lightBackground}
          />
        </div>
      )}
    </div>
  );
});

AppBackground.displayName = 'AppBackground';
