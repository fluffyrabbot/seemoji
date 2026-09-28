/** "slightly edited emoji": "edited" wears the canvas selection box, the "o" is a tilted emoji. */
export default function Wordmark() {
  return (
    <h1 className="wordmark" aria-label="slightly edited emoji">
      <span aria-hidden="true">
        slightly{' '}
        <span className="wordmark-selection">
          edited
          <i className="wordmark-handle nw" /><i className="wordmark-handle ne" />
          <i className="wordmark-handle sw" /><i className="wordmark-handle se" />
        </span>
        {' '}em
        <span className="wordmark-o" />
        ji
      </span>
    </h1>
  );
}
