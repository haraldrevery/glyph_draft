import { useEffect, useState } from "react";
import { marked } from "marked";
import aboutMd from "../../content/about.md?raw";
import licenceMd from "../../content/licence.md?raw";
import legalMd from "../../content/legal.md?raw";
import userGuideMd from "../../content/user-guide.md?raw";

/**
 * The Information window: About / Licence / Legal / User guide in one modal with a
 * sidebar. Each section is a Markdown file under `src/content/` (imported `?raw`),
 * rendered with `marked` — so the copy is easy to edit and can grow long.
 *
 * The markdown is OUR OWN bundled content (trusted), so its HTML is injected directly.
 * If untrusted/user-supplied content is ever shown here, run it through a sanitiser
 * (e.g. DOMPurify) first.
 */

export type InfoSection = "about" | "licence" | "legal" | "userGuide";

const DOCS: { id: InfoSection; label: string; md: string }[] = [
  { id: "about", label: "About", md: aboutMd },
  { id: "licence", label: "Licence", md: licenceMd },
  { id: "legal", label: "Legal", md: legalMd },
  { id: "userGuide", label: "User guide", md: userGuideMd },
];

interface Props {
  open: boolean;
  section: InfoSection;
  onClose: () => void;
}

export function InfoModal({ open, section, onClose }: Props) {
  const [active, setActive] = useState<InfoSection>(section);

  // Open to whichever section the menu item requested.
  useEffect(() => {
    if (open) setActive(section);
  }, [open, section]);

  // Esc closes (capture phase, so it doesn't also reach the canvas behind it).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const doc = DOCS.find((d) => d.id === active) ?? DOCS[0]!;
  const html = marked.parse(doc.md) as string;

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="info-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Information"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <nav className="info-nav" aria-label="Information sections">
          {DOCS.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`info-nav-item${d.id === active ? " is-active" : ""}`}
              aria-current={d.id === active}
              onClick={() => setActive(d.id)}
            >
              {d.label}
            </button>
          ))}
        </nav>
        <div className="info-body">
          <div className="info-content" dangerouslySetInnerHTML={{ __html: html }} />
          <div className="info-actions">
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
