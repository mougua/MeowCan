import { expect, test } from 'bun:test';
import { CanvasSource, Container, Rectangle, Sprite, Text, Texture } from './scene';

test('pooled sprites retain explicit size and contact point when frames change', () => {
  const source = new CanvasSource({ resource: { width: 100, height: 100 } as HTMLCanvasElement });
  const sprite = new Sprite(new Texture({ source, frame: new Rectangle(0, 0, 26, 24) }));
  sprite.anchor.set(.5, 1); sprite.width = 26; sprite.height = 24;
  sprite.texture = new Texture({ source, frame: new Rectangle(0, 24, 26, 12) });
  expect([sprite.width, sprite.height, sprite.anchor.x, sprite.anchor.y]).toEqual([26, 24, .5, 1]);
  sprite.height = 12;
  expect(sprite.scale.y).toBe(1);
});

test('reparenting and disposal preserve draw order and detach children', () => {
  const a = new Container(), b = new Container(), first = new Sprite(), last = new Sprite();
  a.addChild(first, last); b.addChild(first);
  expect(a.children).toEqual([last]); expect(first.parent).toBe(b);
  b.addChildAt(last, 0);
  expect(b.children).toEqual([last, first]); expect(a.children).toEqual([]);
  b.destroy({ children: true });
  expect(first.parent).toBeNull(); expect(last.parent).toBeNull();
});

test('unchanged text styles keep the raster cache valid and edits invalidate it', () => {
  const text = new Text({ text: 'SPEED 8', style: { fill: 0xffffff, fontSize: 10 } });
  const revision = text.style.revision;
  text.style.fill = 0xffffff;
  expect(text.style.revision).toBe(revision);
  text.style.fill = 0xff0000;
  expect(text.style.revision).toBe(revision + 1);
  const width = text.width;
  text.style.fontSize = 20;
  expect(text.width).toBe(width * 2);
});

test('shared atlas storage releases GPU owners once', () => {
  const source = new CanvasSource({ resource: { width: 16, height: 16 } as HTMLCanvasElement });
  const a = new Texture({ source }), b = new Texture({ source });
  let released = 0; source.dispose.add(() => released++);
  a.destroy(false); expect(source.destroyed).toBe(false);
  source.update(); expect(source.revision).toBe(1);
  b.destroy(true); a.destroy(true);
  expect(released).toBe(1); expect(source.dispose.size).toBe(0);
});
