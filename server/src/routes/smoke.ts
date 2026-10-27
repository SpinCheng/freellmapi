/**
 * Latest model smoke-test verdicts for dashboard surfaces.
 *
 * tools/catalog-builder/check-models.mjs merges its recent runs into the
 * settings row `smoke_latest` (a model counts as verified when ANY of the
 * last 3 runs within 14 days served it ok — single runs get rate-limit
 * false negatives, the union is the steadier reachability signal). This
 * endpoint exposes that snapshot read-only so UIs like the Keys page
 * model-name quick reference can list only models actually verified
 * reachable, instead of everything merely configured.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';

export const smokeRouter = Router();

const EMPTY = { testedAt: null, okCount: 0, ok: [] as string[], lastStatus: {} as Record<string, string> };

smokeRouter.get('/', (_req: Request, res: Response) => {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'smoke_latest'").get() as { value: string } | undefined;
  if (!row) {
    res.json(EMPTY);
    return;
  }
  try {
    const parsed = JSON.parse(row.value) as typeof EMPTY;
    res.json({
      testedAt: parsed.testedAt ?? null,
      okCount: parsed.okCount ?? 0,
      ok: Array.isArray(parsed.ok) ? parsed.ok : [],
      lastStatus: parsed.lastStatus ?? {},
    });
  } catch {
    res.json(EMPTY);
  }
});
