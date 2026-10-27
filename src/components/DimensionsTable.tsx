'use client';

import { useI18n } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n';
import type { Dimensions } from '@/lib/dimensions';
import { DIMENSION_COLORS } from './drawDimensions';

/** Text version of the canvas dimension lines (the canvas itself is hidden from assistive tech). */
export function DimensionsTable({ dimensions, mm }: { readonly dimensions: Dimensions; readonly mm: (px: number) => string }) {
  const { t } = useI18n();
  const { image, head, headToImage } = dimensions;
  const edges = (d: { left: number; top: number; right: number; bottom: number }): [MessageKey, string][] => [
    ['dimLeft', mm(d.left)],
    ['dimTop', mm(d.top)],
    ['dimRight', mm(d.right)],
    ['dimBottom', mm(d.bottom)],
  ];
  const groups: { title: MessageKey; color: string; rows: [MessageKey, string][] }[] = [];
  if (image) groups.push({ title: 'dimImage', color: DIMENSION_COLORS.image, rows: [['dimSize', `${mm(image.width)} × ${mm(image.height)}`], ...edges(image)] });
  if (head) groups.push({ title: 'dimHead', color: DIMENSION_COLORS.head, rows: edges(head) });
  if (headToImage) groups.push({ title: 'dimHeadToImage', color: DIMENSION_COLORS.relative, rows: [['dimDx', mm(headToImage.dx)], ['dimDy', mm(headToImage.dy)]] });
  if (groups.length === 0) return null;

  return (
    <section className="dimensions" aria-label={t('dimensionsLabel')}>
      {groups.map((g) => (
        <div key={g.title}>
          <p className="dimensions-title">
            <span aria-hidden="true" className="swatch" style={{ background: g.color }} />
            {t(g.title)}
          </p>
          <dl>
            {g.rows.map(([label, value]) => (
              <div key={label}>
                <dt>{t(label)}</dt>
                <dd>{value} mm</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}
