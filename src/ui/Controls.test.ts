import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RenderCoordinator } from '../application/renderCoordinator';
import { DEFAULT_DESIGN, DEFAULT_EMOJI_LAYER, DEFAULT_TRANSFORM, type TextLayer } from '../domain/design';
import Controls, { type ControlsProps } from './Controls';

let root: Root | null = null;
afterEach(() => { root?.unmount(); root = null; document.body.replaceChildren(); });

const textLayer: TextLayer = {
  id: 'caption', kind: 'text', name: 'Caption', visible: true, opacity: 1, mask: [],
  transform: DEFAULT_TRANSFORM, bounds: { x: 0.2, y: 0.3, width: 0.6, height: 0.3 },
  text: 'Hello', fontSize: 0.15, color: '#000000', fontFamily: 'sans-serif', align: 'center',
};

const setup = async (overrides: Partial<ControlsProps> = {}) => {
  const props: ControlsProps = {
    design: { ...DEFAULT_DESIGN, layers: [DEFAULT_EMOJI_LAYER, textLayer] },
    selectedLayerIds: ['caption'],
    renderer: { render: vi.fn(() => new Promise(() => undefined)) } as unknown as RenderCoordinator,
    emojiStyles: vi.fn(() => new Promise<never>(() => undefined)),
    proportionsLocked: true, onProportionsLockedChange: vi.fn(), onTransformsChange: vi.fn(),
    onAppearanceChange: vi.fn(), onApplyStyle: vi.fn(), onUpdateLayer: vi.fn(), onCommit: vi.fn(), onReset: vi.fn(),
    ...overrides,
  };
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  root.render(createElement(Controls, props));
  await vi.waitFor(() => expect(container.querySelector('h2')).not.toBeNull());
  return { container, props };
};

const button = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === name)!;

describe('selection-aware Controls', () => {
  it('rotates the selected text and presents only relevant controls', async () => {
    const { container, props } = await setup();
    expect(container.querySelector('h2')?.textContent).toBe('Caption');
    expect(container.textContent).not.toContain('Quick styles');
    expect(container.textContent).not.toContain('Color and edge');
    expect(container.textContent).toContain('Text color');
    button(container, 'Rotate 180°').click();
    expect(props.onTransformsChange).toHaveBeenCalledWith([
      { layerId: 'caption', transform: { ...DEFAULT_TRANSFORM, rotate: 180 } },
    ], undefined);
    button(container, 'Reset selected').click();
    expect(props.onReset).toHaveBeenCalledWith(['caption']);
  });

  it('renders and applies recipes only for the selected emoji, including a non-primary emoji', async () => {
    const second = { ...DEFAULT_EMOJI_LAYER, id: 'emoji-2', name: 'Second emoji' };
    const { container, props } = await setup({
      design: { ...DEFAULT_DESIGN, layers: [DEFAULT_EMOJI_LAYER, second] }, selectedLayerIds: [second.id],
    });
    expect(container.querySelectorAll('.visual-preset canvas')).toHaveLength(4);
    button(container, 'Tilt').click();
    expect(props.onApplyStyle).toHaveBeenCalledWith(second.id,
      { ...DEFAULT_TRANSFORM, rotate: -12 }, second.appearance);
    expect(props.onTransformsChange).not.toHaveBeenCalled();
  });

  it('has an empty-selection state without implicitly targeting the first emoji', async () => {
    const { container } = await setup({ selectedLayerIds: [] });
    expect(container.querySelector('h2')?.textContent).toBe('Canvas');
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).toContain('Select an object');
  });

  it('loads exact controls only after disclosure and keeps their updates on the selected object', async () => {
    const { container, props } = await setup();
    expect(container.querySelector('input[aria-label="Position X slider"]')).toBeNull();
    expect(container.querySelector('input[aria-label="Opacity slider"]')).toBeNull();
    const disclosure = container.querySelector<HTMLDetailsElement>('.more-controls')!;
    disclosure.open = true;
    disclosure.dispatchEvent(new Event('toggle'));
    await vi.waitFor(() => expect(container.querySelector('input[aria-label="Position X slider"]')).not.toBeNull());
    const position = container.querySelector<HTMLInputElement>('input[aria-label="Position X slider"]')!;
    position.value = '0.17';
    position.dispatchEvent(new Event('input', { bubbles: true }));
    expect(props.onTransformsChange).toHaveBeenCalledWith([
      { layerId: textLayer.id, transform: { ...DEFAULT_TRANSFORM, x: 0.17 } },
    ], expect.any(String));
    expect(container.textContent).toContain('Font size');
    expect(container.textContent).not.toContain('Color and edge');
  });

  it('dispatches a size change for the complete selection in one batch', async () => {
    const { container, props } = await setup({ selectedLayerIds: [DEFAULT_EMOJI_LAYER.id, textLayer.id] });
    expect(container.querySelector('h2')?.textContent).toBe('2 objects');
    expect(container.textContent).not.toContain('Quick styles');
    const size = container.querySelector<HTMLInputElement>('input[aria-label="Size slider"]')!;
    size.value = '1.1';
    size.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(props.onTransformsChange).toHaveBeenCalledOnce());
    const updates = vi.mocked(props.onTransformsChange).mock.calls[0]![0];
    expect(updates.map((update) => update.layerId)).toEqual([DEFAULT_EMOJI_LAYER.id, textLayer.id]);
    expect(updates.every((update) => update.transform.scaleX === 1.1)).toBe(true);
    size.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(props.onCommit).toHaveBeenCalledOnce();
  });

  it('discards an unfinished gesture when selection changes and later returns', async () => {
    const selectedLayerIds = [DEFAULT_EMOJI_LAYER.id, textLayer.id];
    const { container, props } = await setup({ selectedLayerIds });
    const size = container.querySelector<HTMLInputElement>('input[aria-label="Size slider"]')!;
    size.value = '1.1';
    size.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(props.onTransformsChange).toHaveBeenCalledOnce());
    // Switching selection can remove a range before its pointer-up is delivered.
    root!.render(createElement(Controls, { ...props, selectedLayerIds: [] }));
    await vi.waitFor(() => expect(container.querySelector('h2')?.textContent).toBe('Canvas'));
    const changedText = { ...textLayer, transform: { ...textLayer.transform, rotate: 65 } };
    root!.render(createElement(Controls, { ...props,
      design: { ...props.design, layers: [DEFAULT_EMOJI_LAYER, changedText] }, selectedLayerIds,
    }));
    await vi.waitFor(() => expect(container.querySelector('h2')?.textContent).toBe('2 objects'));
    const nextSize = container.querySelector<HTMLInputElement>('input[aria-label="Size slider"]')!;
    nextSize.value = '1.2';
    nextSize.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(props.onTransformsChange).toHaveBeenCalledTimes(2));
    const updates = vi.mocked(props.onTransformsChange).mock.calls[1]![0];
    expect(updates.find((update) => update.layerId === textLayer.id)?.transform.rotate).toBe(65);
  });
});
