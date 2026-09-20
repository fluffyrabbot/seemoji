import { fitText, textLayout, type MeasureText } from '../domain/textBubble';
import type { TextLayer } from '../domain/design';

const measure = (layer: TextLayer): MeasureText => {
  const context = document.createElement('canvas').getContext('2d')!;
  return (text, fontSize) => {
    context.font = `${fontSize * 1024}px ${layer.fontFamily}`;
    return context.measureText(text).width / 1024;
  };
};
export const fitCanvasText = (layer: TextLayer) => fitText(layer, measure(layer));
export const canvasTextLayout = (layer: TextLayer) => textLayout(layer, measure(layer));
