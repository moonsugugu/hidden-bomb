const BRAND_LINKS = [
  { label: "문수네집 브랜드", href: "https://moonsunezipbrand.vercel.app" },
  { label: "Instagram", href: "https://www.instagram.com/moonsune.zip/" },
  { label: "moonsune.zip", href: "https://moonsunezip.com" },
] as const;

export function MadeBy() {
  return (
    <span className="made-by">
      made by{" "}
      <a
        className="made-by-link"
        href="https://moonsunezipbrand.vercel.app"
        target="_blank"
        rel="noreferrer"
      >
        문수네집
      </a>
    </span>
  );
}

export function BrandLinks() {
  return (
    <nav className="brand-links" aria-label="문수네집 링크">
      {BRAND_LINKS.map((link) => (
        <a
          className="brand-link"
          href={link.href}
          key={link.href}
          target="_blank"
          rel="noreferrer"
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}
