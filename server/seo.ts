import { Router, Request, Response, NextFunction } from 'express';
import { SITE_URL, isAdminPathname } from '../src/config/brand.js';

// robots.txt, sitemap.xml and crawler headers (tracker 6.4). The public site and the admin
// console are the same Node app on one origin; the console lives at ADMIN_PATH (update.md D-11).
// robots.txt and sitemap.xml are the public ones everywhere and never name the admin path:
// listing it in robots.txt would publish it. The noindex header below keeps it out of search.

// The site uses hash routing (#/services, #/track/…). Search engines drop everything after "#",
// so the home URL is the only page they can index on its own; hash URLs don't belong in a sitemap.
const SITEMAP_PATHS = ['/'];

export const seoRouter = Router();

// Belt and braces for the admin path: a header works before any HTML or JS runs, and also covers
// its redirect and 404s (App.tsx adds the matching robots meta tag at runtime).
seoRouter.use((req: Request, res: Response, next: NextFunction) => {
  if (isAdminPathname(req.path)) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

seoRouter.get('/robots.txt', (req: Request, res: Response) => {
  res.type('text/plain');
  res.send(`User-agent: *\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
});

seoRouter.get('/sitemap.xml', (req: Request, res: Response) => {
  const urls = SITEMAP_PATHS
    .map((p) => `  <url>\n    <loc>${SITE_URL}${p}</loc>\n  </url>`)
    .join('\n');
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
});
