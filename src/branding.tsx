const BRAND_LINKS = [
  { label: "문수네집소개", href: "https://moonsunezipbrand.vercel.app" },
  { label: "문수네집인스타", href: "https://www.instagram.com/moonsune.zip/" },
  { label: "이종대왕인스타", href: "https://www.instagram.com/king.leejong/" },
  { label: "문수네집컨텐츠", href: "https://moonsunezip.com" },
] as const;

export function BrandLinks() {
  return (
    <nav className="brand-links" aria-label="문수네집과 이종대왕 링크">
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
