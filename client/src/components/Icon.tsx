/**
 * Thin wrapper over Hugeicons so call sites stay terse and consistent. Icons
 * render as SVG that inherits `currentColor`, so they stay token-driven (the
 * surrounding text color is the icon color). Decorative by default — the
 * containing button supplies the accessible label.
 */

import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';

interface Props {
  icon: IconSvgElement;
  size?: number;
  className?: string;
}

export function Icon({ icon, size = 18, className }: Props) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={1.8}
      className={className}
      aria-hidden
      focusable={false}
    />
  );
}
