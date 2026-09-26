import { CanvasSource, Rectangle, Texture } from 'pixi.js';

/** Pack isolated, edge-extruded frames once at load time, never during animation. */
export function createPaddedFrames(atlas: Texture, crops: Rectangle[]): Texture[] {
  const padding = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(...crops.map(crop => crop.width)) + padding * 2;
  canvas.height = crops.reduce((height, crop) => height + crop.height + padding * 2, 0);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Cannot prepare note textures');
  context.imageSmoothingEnabled = false;
  const image = atlas.source.resource as CanvasImageSource;
  const frames: Rectangle[] = [];
  let top = 0;
  for (const crop of crops) {
    const x = padding;
    const y = top + padding;
    // A 3x3 copy extends all four edges and corners without mixing neighbours.
    const sourceX = [crop.x, crop.x, crop.x + crop.width - 1];
    const sourceY = [crop.y, crop.y, crop.y + crop.height - 1];
    const widths = [1, crop.width, 1];
    const heights = [1, crop.height, 1];
    const destX = [0, x, x + crop.width];
    const destY = [top, y, y + crop.height];
    const destWidths = [padding, crop.width, padding];
    const destHeights = [padding, crop.height, padding];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        context.drawImage(image, sourceX[col], sourceY[row], widths[col], heights[row],
          destX[col], destY[row], destWidths[col], destHeights[row]);
      }
    }
    frames.push(new Rectangle(x, y, crop.width, crop.height));
    top += crop.height + padding * 2;
  }
  const source = new CanvasSource({ resource: canvas, scaleMode: 'linear', autoGenerateMipmaps: false });
  return frames.map(frame => new Texture({ source, frame }));
}
