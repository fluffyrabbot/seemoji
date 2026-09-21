import { useRef } from 'react';
import type { DesignDocument, TextLayer } from '../domain/design';
import { detachBubble } from '../domain/bubbleAttachment';

export default function BubbleSpeaker({ layer, design, onChange }: {
  readonly layer: TextLayer;
  readonly design: DesignDocument;
  readonly onChange: (layer: TextLayer) => void;
}) {
  const picker = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const speakers = design.layers.filter((candidate) => candidate.kind === 'emoji');
  const attached = speakers.find((candidate) => candidate.id === layer.bubble?.speakerId);
  const close = () => {
    if (picker.current) picker.current.open = false;
    trigger.current?.focus();
  };
  return <div className="bubble-speaker" data-speaker-id={attached?.id ?? ''}>
    <div className="speaker-actions">
      <details ref={picker} className="speaker-picker" onKeyDown={(event) => {
        if (event.key === 'Escape' && picker.current?.open) {
          event.preventDefault(); event.stopPropagation(); close();
        } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && picker.current) {
          event.preventDefault(); event.stopPropagation();
          picker.current.open = true;
          const choices = [...picker.current.querySelectorAll('button')];
          const index = choices.findIndex((choice) => choice === document.activeElement);
          const next = event.key === 'ArrowDown' ? index + 1 : index < 0 ? choices.length - 1 : index - 1;
          choices[(next + choices.length) % choices.length]?.focus();
        }
      }}>
        <summary ref={trigger} aria-label={attached ? `Change speaker: ${attached.name}` : 'Choose speaker'}>
          {attached ? <><span aria-hidden="true">{attached.source.grapheme}</span> <span>{attached.name}{attached.visible ? '' : ' (hidden)'}</span></> : 'Choose speaker'}
        </summary>
        <div className="speaker-choices" role="group" aria-label="Choose speaker">
          {speakers.map((speaker) => <button key={speaker.id} type="button" aria-label={`Attach to ${speaker.name}`}
            aria-pressed={speaker.id === attached?.id} onClick={() => {
              close();
              if (speaker.id !== attached?.id) onChange({ ...layer, bubble: { ...layer.bubble!,
                speakerId: speaker.id, speakerAnchor: { x: 0.5, y: 0.62 } } });
            }}><span aria-hidden="true">{speaker.source.grapheme}</span> {speaker.name}{speaker.visible ? '' : ' (hidden)'}</button>)}
        </div>
      </details>
      {attached && <button type="button" aria-label="Detach speaker" onClick={() => {
        close(); onChange(detachBubble(layer));
      }}>Detach</button>}
    </div>
    {!attached && <small>Drag the tail onto an emoji to attach.</small>}
  </div>;
}
