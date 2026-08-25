export function PostcardPreview({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "postcard-scene compact" : "postcard-scene"}>
      <div className="postcard-shadow" aria-hidden="true" />
      <div className="postcard-paper" aria-hidden="true">
        <div className="postcard-sun" />
        <div className="postcard-cloud cloud-one" />
        <div className="postcard-cloud cloud-two" />
        <div className="postcard-hill hill-back" />
        <div className="postcard-hill hill-front" />
        <div className="postcard-path" />
        <div className="postcard-house">
          <span />
        </div>
        <div className="postcard-tree tree-one" />
        <div className="postcard-tree tree-two" />
        <div className="postcard-stamp">MEMORY<br />No. 01</div>
        <div className="postcard-caption">
          <span>WARM DAYS</span>
          <small>a travel memory</small>
        </div>
      </div>
      {!compact && (
        <>
          <div className="paper-note note-top" aria-hidden="true">
            1–5 PHOTOS
          </div>
          <div className="paper-note note-bottom" aria-hidden="true">
            ONE KEEPSAKE
          </div>
        </>
      )}
    </div>
  );
}
