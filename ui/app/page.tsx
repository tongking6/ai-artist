import Link from "next/link";

import { BrandMark } from "@/components/BrandMark";
import { CreateTaskButton } from "@/components/CreateTaskButton";
import { CheckIcon, LockIcon, SparkIcon } from "@/components/Icons";
import { PostcardPreview } from "@/components/PostcardPreview";
import { RuntimeModeBadge, RuntimePrivacyCopy } from "@/components/RuntimeModeBadge";

export default function HomePage() {
  return (
    <main className="start-page">
      <header className="site-header shell">
        <BrandMark />
        <div className="header-actions">
          <Link className="header-link" href="/tasks">My projects</Link>
          <RuntimeModeBadge />
        </div>
      </header>

      <section className="hero shell">
        <div className="hero-copy">
          <p className="eyebrow">
            <span /> A small studio for meaningful moments
          </p>
          <h1>
            Turn your photos into a postcard that <em>feels remembered.</em>
          </h1>
          <p className="hero-lede">
            Bring one to five favorite photos and a few words about the moment.
            AI Artist shapes them into one warm, handmade landscape postcard.
          </p>
          <CreateTaskButton />
          <p className="hero-footnote">
            One style · One 1800 × 1200 PNG · Refine when it is ready
          </p>
        </div>

        <div className="hero-art" aria-label="Illustrated warm handmade postcard preview">
          <PostcardPreview />
        </div>
      </section>

      <section className="process-band">
        <div className="shell process-grid">
          <div className="section-intro">
            <p className="eyebrow"><span /> Your memory, simply made</p>
            <h2>Three gentle steps from camera roll to keepsake.</h2>
          </div>
          <ol className="process-list">
            <li>
              <span className="process-number">01</span>
              <div>
                <h3>Choose the memory</h3>
                <p>Add 1–5 JPEG or PNG photos, plus a title and a short creative note.</p>
              </div>
            </li>
            <li>
              <span className="process-number">02</span>
              <div>
                <h3>Let the scene take shape</h3>
                <p>Your references are composed into one nostalgic, warm-handmade scene.</p>
              </div>
            </li>
            <li>
              <span className="process-number">03</span>
              <div>
                <h3>Download or refine</h3>
                <p>Keep any ready version, or add one focused note to create another.</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section className="promise shell">
        <div className="promise-art">
          <PostcardPreview compact />
        </div>
        <div className="promise-copy">
          <SparkIcon className="promise-icon" />
          <p className="eyebrow"><span /> The first studio style</p>
          <h2>Warm, handmade, and grounded in the scene you lived.</h2>
          <p>
            The visual recipe preserves recognizable people and place anchors while
            allowing a softer composition, organic texture, and nostalgic color.
            Your written note guides the artwork; it is not printed onto the image.
          </p>
          <ul className="check-list">
            <li><CheckIcon /> Landscape postcard composition</li>
            <li><CheckIcon /> Previous ready versions stay available</li>
            <li><CheckIcon /> Fresh private link for every download</li>
          </ul>
        </div>
      </section>

      <section className="privacy-note">
        <div className="shell privacy-note-inner">
          <LockIcon />
          <div>
            <h2>Built for a private first release.</h2>
            <RuntimePrivacyCopy />
          </div>
        </div>
      </section>

      <footer className="site-footer shell">
        <BrandMark />
        <div className="footer-actions">
          <Link href="/tasks">My projects</Link>
          <p>M1 · Memory postcard studio</p>
        </div>
      </footer>
    </main>
  );
}
