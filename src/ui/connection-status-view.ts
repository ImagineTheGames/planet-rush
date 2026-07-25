/**
 * src/ui/connection-status-view.ts — the Pixi view for the connection overlay.
 * OWNER: UI Engineer.
 *
 * The drawing half of {@link ./connection-status}. Severity picks the accent —
 * plasma while there is hope (connecting / reconnecting), threat red once the
 * connection is genuinely lost, which is the one moment on this overlay that is
 * real danger and so the one moment red is earned (style-guide §2).
 */

import { Container, Graphics, Text } from 'pixi.js';
import { PALETTE } from '@render/index';
import type { AnchorSpec, LayoutEntry, Viewport } from '@platform/layout-registry';
import { FONT_BODY, FONT_HEADING, TEXT_DIM, TEXT_PRIMARY } from './typography';
import {
  CONNECTION_STATUS_ID,
  connectionStatusHitTest,
  connectionStatusLayout,
} from './connection-status';
import type {
  ConnectionSeverity,
  ConnectionStatusLayout,
  ConnectionStatusModel,
  ConnectionTarget,
} from './connection-status';
import type { Insets } from './menu-geometry';

export const CONNECTION_STATUS_ANCHOR: AnchorSpec = { region: 'center' };

/**
 * The connection overlay. Add once, {@link resize} on viewport changes,
 * {@link update} each frame with a {@link ConnectionStatusModel}. It manages its
 * own visibility from the model, so the caller can leave it added and let it
 * appear and vanish with the connection.
 */
export class ConnectionStatusView extends Container {
  private readonly scrim = new Graphics();
  private readonly card = new Graphics();
  private readonly headline: Text;
  private readonly detail: Text;
  private readonly actionBody = new Graphics();
  private readonly actionLabel: Text;

  private layout: ConnectionStatusLayout;
  private viewport: Viewport;
  private insets: Insets | undefined;
  private model: ConnectionStatusModel | null = null;

  constructor(screenWidth: number, screenHeight: number, insets?: Insets) {
    super();
    this.viewport = { width: screenWidth, height: screenHeight };
    this.insets = insets;
    this.layout = connectionStatusLayout(this.viewport, this.insets ? { insets: this.insets } : {});
    this.headline = makeText('', FONT_HEADING, 22, TEXT_PRIMARY);
    this.headline.anchor.set(0.5, 0.5);
    this.detail = makeText('', FONT_BODY, 13, TEXT_DIM);
    this.detail.anchor.set(0.5, 0.5);
    this.actionLabel = makeText('', FONT_HEADING, 13, TEXT_PRIMARY);
    this.actionLabel.anchor.set(0.5, 0.5);
    this.addChild(this.scrim, this.card, this.headline, this.detail, this.actionBody, this.actionLabel);
  }

  resize(width: number, height: number, insets = this.insets): void {
    this.viewport = { width, height };
    this.insets = insets;
    this.layout = connectionStatusLayout(this.viewport, insets ? { insets } : {});
  }

  hitTest(x: number, y: number): ConnectionTarget | null {
    if (!this.model) return null;
    return connectionStatusHitTest(this.layout, x, y, this.model);
  }

  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible) return [];
    return [{ id: CONNECTION_STATUS_ID, anchor: CONNECTION_STATUS_ANCHOR, bounds: { ...this.layout.panel } }];
  }

  update(model: ConnectionStatusModel): void {
    this.model = model;
    this.visible = model.visible;
    if (!model.visible) return;

    const accent = severityColor(model.severity);
    const { panel, action } = this.layout;

    // A dim scrim over the whole viewport, so the overlay reads as modal — taps
    // behind it are caught by the caller, not leaked to the game.
    this.scrim.clear();
    this.scrim
      .rect(-this.viewport.width, -this.viewport.height, this.viewport.width * 3, this.viewport.height * 3)
      .fill({ color: PALETTE.vacuum, alpha: 0.7 });

    this.card.clear();
    this.card
      .roundRect(panel.x, panel.y, panel.width, panel.height, 10)
      .fill({ color: PALETTE.vacuum, alpha: 0.98 })
      .roundRect(panel.x, panel.y, panel.width, panel.height, 10)
      .stroke({ width: 2, color: accent, alpha: 0.85 });

    this.headline.text = model.headline;
    this.headline.style.fill = accent;
    this.headline.x = panel.x + panel.width / 2;
    this.headline.y = panel.y + panel.height * 0.32;

    this.detail.text = model.detail;
    this.detail.x = panel.x + panel.width / 2;
    this.detail.y = panel.y + panel.height * 0.52;

    const showAction = model.action !== null;
    setVisible(showAction, this.actionBody, this.actionLabel);
    if (showAction) {
      this.actionBody
        .clear()
        .roundRect(action.x, action.y, action.width, action.height, 6)
        .fill({ color: accent, alpha: 0.16 })
        .roundRect(action.x, action.y, action.width, action.height, 6)
        .stroke({ width: 2, color: accent, alpha: 0.85 });
      this.actionLabel.text = model.action ?? '';
      this.actionLabel.x = action.x + action.width / 2;
      this.actionLabel.y = action.y + action.height / 2;
    }
  }
}

/** Plasma while there is hope; threat red once the connection is truly lost. */
function severityColor(severity: ConnectionSeverity): number {
  return severity === 'error' ? PALETTE.threatRed : PALETTE.plasma;
}

function setVisible(visible: boolean, ...nodes: Array<Graphics | Text>): void {
  for (const node of nodes) node.visible = visible;
}

function makeText(text: string, fontFamily: string, fontSize: number, fill: number): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, letterSpacing: 0.5, align: 'center' } });
}
