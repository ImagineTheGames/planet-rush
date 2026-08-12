import { describe, it } from 'vitest';
import { BUILD_BUTTON_LABEL, roundLabelHalfWidth, BUILD_BUTTON_RADIUS, BUILD_BUTTON_RIM } from './build-button';
import { textHeight, textWidth } from './font-metrics';
import { wheelRadius } from './hud-geometry';
import { wheelMetrics } from '../art/materials';
import { buildWheelModel, WHEEL_ORDER, segmentAngle } from './build-wheel';
import { buildWedgeLines, wedgeStackBoxes, fitWedgeStack } from './wheel-stack';

const WORST = { requested: true, docked: true, shipAlive: true, stationAlive: true, cargo: 0, banked: 999, turrets: 4, shields: 2, satellites: 1, coreHp: 40, maxCoreHp: 100, repairGate: 15 } as never;

describe('scratch', () => {
  it('dumps', () => {
    for (const l of BUILD_BUTTON_LABEL) {
      const spec = { face: l.face, size: l.size, tracking: l.tracking };
      const h = textHeight(l.text, spec);
      const w = textWidth(l.text, spec);
      const avail = 2 * roundLabelHalfWidth(BUILD_BUTTON_RADIUS, BUILD_BUTTON_RIM, Math.abs(l.centreY) + h / 2);
      console.log(`SCRATCH BTN ${l.text.padEnd(11)} size=${l.size} w=${w.toFixed(2)} avail=${avail.toFixed(2)} headroom=${((1 - w / avail) * 100).toFixed(1)}%`);
    }
    for (const { name, vp } of [{ name: 'iphone/landscape', vp: { width: 844, height: 390 } }, { name: 'desktop', vp: { width: 1280, height: 800 } }, { name: 'small/landscape', vp: { width: 568, height: 320 } }]) {
      const outer = wheelRadius(vp.width, vp.height);
      const m = wheelMetrics(outer);
      for (const selected of [false, true]) {
        for (const [i, seg] of buildWheelModel(WORST).segments.entries()) {
          const lines = buildWedgeLines(seg, m, selected);
          const angle = segmentAngle(i);
          const fit = fitWedgeStack(lines, outer, m, angle, WHEEL_ORDER.length);
          const design = wedgeStackBoxes(lines, outer, m, angle).centreRadius;
          if (design - fit.radius > 0.05 || fit.nameScale < 1)
            console.log(`SCRATCH ${name.padEnd(17)}${selected ? 'SEL ' : '    '}${seg.id.padEnd(10)} moved=${(design - fit.radius).toFixed(1).padStart(5)} nameScale=${fit.nameScale.toFixed(3)}`);
        }
      }
    }
  });
});
