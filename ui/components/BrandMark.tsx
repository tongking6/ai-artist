import Link from "next/link";

export function BrandMark() {
  return (
    <Link className="brand-mark" href="/" aria-label="AI Artist home">
      <span className="brand-glyph" aria-hidden="true">
        <span />
        <span />
      </span>
      <span>
        <strong>AI ARTIST</strong>
        <small>memory postcard studio</small>
      </span>
    </Link>
  );
}
